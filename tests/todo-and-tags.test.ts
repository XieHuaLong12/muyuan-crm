import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { todoReasons, type TodoFacts } from '../lib/todo';
import { TAG_COLOR_KEYS, TAG_COLORS } from '../lib/customer-tags';
import { inboxConversations, inboxThread } from '../services/inbox-service';
import { clearTodo, markTodo, todoCount } from '../services/todo-service';
import { deleteTag, tagCustomer, tagLibrary, untagCustomer, updateTag } from '../services/customer-tag-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = new Date('2026-10-30T06:00:00Z'); // 14:00 in Beijing
const END = new Date('2026-10-30T16:00:00Z'); // the end of that day in Beijing
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const facts = (overrides: Partial<TodoFacts> = {}): TodoFacts => ({
  stage: 'CONTACTED', legacy: false, leadGrade: '', aiIntent: 'UNKNOWN', bestReplyQuality: '',
  firstContactDueAt: null, firstContactAt: null, contactedAt: null, lastInboundAt: null, lastOutboundAt: null, lastFollowUpAt: null, lastContactAt: null,
  nextFollowUpAt: null, task: null, staleQuoteSentAt: null, mark: null, ...overrides,
});
const judge = (overrides: Partial<TodoFacts>) => todoReasons(facts(overrides), NOW, END, 'Asia/Shanghai', 2);

test('待处理: which customers come in, why, and under which group', () => {
  assert.equal(judge({}), null);
  // 1. A / B first contact overdue; a C lead stays in 待首联 only.
  assert.deepEqual(judge({ stage: 'NEW', leadGrade: 'A', firstContactDueAt: ago(25 * MIN) }), { group: 'LATE', reasons: ['A 级 · 首联已超时 25 分钟'] });
  assert.equal(judge({ stage: 'NEW', leadGrade: 'C', firstContactDueAt: ago(25 * MIN) }), null);
  assert.equal(judge({ stage: 'NEW', leadGrade: 'A', firstContactDueAt: ago(25 * MIN), lastOutboundAt: ago(MIN) }), null, 'someone already wrote');
  // 2. Waiting for our answer: A / B or high intent, late after the hot-reply hours.
  assert.deepEqual(judge({ leadGrade: 'B', lastOutboundAt: ago(20 * HOUR), lastInboundAt: ago(3 * HOUR) }), { group: 'LATE', reasons: ['B 级 · 客户在等你回复 3 小时'] });
  assert.deepEqual(judge({ leadGrade: 'C', bestReplyQuality: 'HIGH', lastInboundAt: ago(40 * MIN) }), { group: 'TODAY', reasons: ['高意向 · 客户在等你回复 40 分钟'] });
  assert.deepEqual(judge({ leadGrade: 'A', aiIntent: 'HIGH', lastInboundAt: ago(10 * MIN) })?.reasons, ['A 级 · 高意向 · 客户在等你回复 10 分钟']);
  assert.equal(judge({ leadGrade: 'C', lastInboundAt: ago(5 * HOUR) }), null, 'a C customer waiting is in 待我回复, not here');
  assert.equal(judge({ leadGrade: 'A', lastInboundAt: ago(2 * HOUR), lastOutboundAt: ago(HOUR) }), null, 'answered');
  assert.equal(judge({ leadGrade: 'A', lastInboundAt: ago(2 * HOUR), lastFollowUpAt: ago(HOUR) }), null, 'answered by phone');
  // 3. A follow-up or task a person set, due today or earlier.
  assert.deepEqual(judge({ nextFollowUpAt: new Date('2026-10-30T07:00:00Z') }), { group: 'TODAY', reasons: ['约好今天 15:00 跟进'] });
  assert.deepEqual(judge({ nextFollowUpAt: ago(DAY) }), { group: 'LATE', reasons: ['约好的跟进已过 1 天'] });
  assert.equal(judge({ nextFollowUpAt: new Date(END.getTime() + HOUR) }), null, 'tomorrow');
  assert.deepEqual(judge({ task: { title: '发样品', dueDate: new Date('2026-10-30T08:00:00Z') } }), { group: 'TODAY', reasons: ['任务「发样品」今天 16:00 到期'] });
  assert.deepEqual(judge({ task: { title: '发样品', dueDate: ago(HOUR) } })?.reasons, ['任务「发样品」已过期']);
  // 4. A quote gone quiet for three days.
  assert.deepEqual(judge({ stage: 'QUOTED', staleQuoteSentAt: ago(4 * DAY), lastContactAt: ago(4 * DAY) }), { group: 'TODAY', reasons: ['报价发出 4 天没回音'] });
  assert.equal(judge({ stage: 'QUOTED', staleQuoteSentAt: ago(4 * DAY), lastContactAt: ago(DAY) }), null, 'contacted since');
  // 5. A hand mark, from its time on; it alone also covers closed and old customers.
  assert.deepEqual(judge({ mark: { note: '今天发正式报价', dueAt: ago(MIN) } }), { group: 'MINE', reasons: ['提醒：今天发正式报价'] });
  assert.equal(judge({ mark: { note: '', dueAt: new Date(NOW.getTime() + HOUR) } }), null, 'not yet');
  assert.deepEqual(judge({ stage: 'WON', nextFollowUpAt: ago(DAY), mark: { note: '', dueAt: ago(MIN) } }), { group: 'MINE', reasons: ['你标记的待处理'] });
  assert.equal(judge({ stage: 'LOST', nextFollowUpAt: ago(DAY) }), null);
  assert.equal(judge({ legacy: true, leadGrade: 'A', lastInboundAt: ago(5 * HOUR) }), null, '旧客户 stay out of the work queues');
  // Late reasons come first and decide the group.
  assert.deepEqual(judge({ leadGrade: 'B', lastInboundAt: ago(30 * MIN), nextFollowUpAt: ago(HOUR), mark: { note: '报价', dueAt: ago(MIN) } }),
    { group: 'LATE', reasons: ['约好的跟进已过 1 小时', 'B 级 · 客户在等你回复 30 分钟', '提醒：报价'] });
});

test('tag colours are eight light backgrounds with dark text', () => {
  assert.equal(TAG_COLOR_KEYS.length, 8);
  // WCAG relative luminance contrast of each pair.
  const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (const key of TAG_COLOR_KEYS) {
    const { bg, ink } = TAG_COLORS[key];
    const ratio = (lum(bg) + 0.05) / (lum(ink) + 0.05);
    assert.ok(ratio >= 4.5, `${key}: ${ratio.toFixed(2)}`);
  }
});

test('待处理 list, hand marks and tags in the message center', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), now = new Date();
  const seller = await db.user.create({ data: { name: `Seller ${tag}`, email: `todo-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const sales = { id: seller.id, name: seller.name, email: seller.email, role: 'SALES' };
  const marker = await db.customerTag.create({ data: { name: `测试-${tag}`, color: 'blue', createdBy: admin.id } });
  const make = async (name: string, data: object) => {
    const c = await db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, inquiryAt: now, stage: 'CONTACTED', ...data } });
    await db.customerTagLink.create({ data: { customerId: c.id, tagId: marker.id, createdBy: admin.id } });
    return c;
  };
  const at = (ms: number) => new Date(now.getTime() - ms);
  try {
    await make('FirstContact', { stage: 'NEW', leadGrade: 'A', assignedAt: at(HOUR), firstContactDueAt: at(30 * MIN) });
    const waiting = await make('Waiting', { stage: 'REPLIED', isQualified: true, leadGrade: 'B', lastOutboundAt: at(20 * HOUR), lastInboundAt: at(3 * HOUR) });
    const high = await make('High', { leadGrade: 'C', bestReplyQuality: 'HIGH', lastOutboundAt: at(5 * HOUR), lastInboundAt: at(MIN) });
    const followUp = await make('FollowUp', { leadGrade: 'C', nextFollowUpAt: at(2 * HOUR) });
    const quoted = await make('Quoted', { stage: 'QUOTED', isQualified: true, lastContactAt: at(4 * DAY) });
    await db.quotation.create({ data: { customerId: quoted.id, quoteNumber: `Q-${tag}`, product: 'Sofa', quantity: 1, unitPrice: 1, currency: 'USD', incoterm: 'FOB', notes: '', status: 'SENT', sentAt: at(4 * DAY), createdBy: admin.id } });
    const plain = await make('Plain', { leadGrade: 'C', lastOutboundAt: at(5 * HOUR), lastInboundAt: at(HOUR) });
    const automated = await make('Automated', { leadGrade: 'C' });
    await db.task.create({ data: { title: '回复客户', description: '', customerId: automated.id, dueDate: at(HOUR), createdBy: admin.id, automationKey: `test:${tag}` } });
    const lost = await make('Lost', { stage: 'LOST', nextFollowUpAt: at(DAY) });
    const legacy = await make('Legacy', { leadGrade: 'A', inquiryAt: new Date('2026-09-01T00:00:00Z'), lastInboundAt: at(5 * HOUR) });

    const list = (extra: object = {}) => inboxConversations(actor, { filter: 'todo', tagId: marker.id, ...extra });
    let page = await list();
    const groups = (p: typeof page) => Object.fromEntries(p.todo.map(item => [item.name.replace(` ${tag}`, ''), item.group]));
    assert.deepEqual(groups(page), { FirstContact: 'LATE', Waiting: 'LATE', FollowUp: 'LATE', High: 'TODAY', Quoted: 'TODAY' });
    assert.deepEqual(page.todo.map(item => item.group), ['LATE', 'LATE', 'LATE', 'TODAY', 'TODAY'], 'grouped in order');
    assert.equal(page.todo.find(item => item.id === followUp.id)!.reasons[0], '约好的跟进已过 2 小时');
    assert.equal(page.todo[0].tags[0].name, `测试-${tag}`);
    assert.ok(page.todoTotal >= 5, 'the chip counts every 待处理 customer, whatever the tag filter');
    assert.equal(await todoCount({ AND: [{ deletedAt: null }, { tagLinks: { some: { tagId: marker.id } } }] }), 5, 'the count uses the same rules as the list');
    for (const id of [plain.id, automated.id, lost.id, legacy.id]) assert.ok(!page.todo.some(item => item.id === id));

    // Hand marks: a time ahead keeps the customer out until then; now puts them in under 我标记的; 处理完 takes them out.
    await markTodo({ customerId: plain.id, note: '明天给报价', dueAt: new Date(now.getTime() + DAY).toISOString() }, actor);
    assert.ok(!(await list()).todo.some(item => item.id === plain.id));
    await markTodo({ customerId: legacy.id, note: '老客户复购' }, actor);
    page = await list();
    assert.deepEqual(page.todo.filter(item => item.group === 'MINE').map(item => [item.id, item.reasons, item.marked]), [[legacy.id, ['提醒：老客户复购'], true]]);
    assert.deepEqual((await inboxThread(actor, { customerId: legacy.id })).pendingMark?.note, '老客户复购');
    await clearTodo({ customerId: legacy.id }, actor);
    assert.ok(!(await list()).todo.some(item => item.id === legacy.id));
    assert.equal(await db.pendingMark.count({ where: { customerId: legacy.id } }), 0);
    await assert.rejects(markTodo({ customerId: plain.id, dueAt: new Date(now.getTime() + 400 * DAY).toISOString() }, actor), (e: unknown) => e instanceof HttpError && e.status === 400);
    // A salesperson sees only their own customers, and cannot mark someone else's.
    assert.equal((await inboxConversations(sales, { filter: 'todo', tagId: marker.id })).todo.length, 0);
    await assert.rejects(markTodo({ customerId: waiting.id }, sales), (e: unknown) => e instanceof HttpError && e.status === 404);

    // Tags: a new name creates the tag once; the same name again reuses it.
    const first = await tagCustomer({ customerId: high.id, name: `样品-${tag}`, color: 'orange' }, actor);
    const again = await tagCustomer({ customerId: quoted.id, name: `样品-${tag}`, color: 'red' }, actor);
    assert.equal(again.tag.id, first.tag.id);
    assert.equal(again.tag.color, 'orange', 'the existing colour wins');
    assert.deepEqual(first.tags.map(t => t.name), [`测试-${tag}`, `样品-${tag}`]);
    await tagCustomer({ customerId: high.id, tagId: first.tag.id }, actor);
    assert.equal(await db.customerTagLink.count({ where: { tagId: first.tag.id } }), 2, 'attaching twice changes nothing');
    assert.equal((await tagLibrary(actor)).tags.find(t => t.id === first.tag.id)?.count, 2);
    assert.equal((await tagLibrary(sales)).tags.find(t => t.id === first.tag.id)?.count, 0, 'counts cover only the customers one can see');
    await assert.rejects(tagCustomer({ customerId: high.id, name: `x-${tag}`, color: 'pink' }, actor));
    await assert.rejects(tagCustomer({ customerId: high.id, tagId: first.tag.id }, sales), (e: unknown) => e instanceof HttpError && e.status === 404);

    // The conversation list: tags on each row, the tag filter, and search by tag name.
    await db.whatsAppMessage.create({ data: { customerId: high.id, direction: 'INBOUND', sentAt: at(MIN), content: 'Je veux 2 conteneurs', raw: '{}', status: 'RECEIVED' } });
    const tagged = await inboxConversations(actor, { tagId: first.tag.id });
    assert.deepEqual(tagged.conversations.map(c => c.id), [high.id]);
    assert.deepEqual(tagged.conversations[0].tags.map(t => t.name), [`测试-${tag}`, `样品-${tag}`]);
    assert.ok((await inboxConversations(actor, { q: `样品-${tag}` })).conversations.some(c => c.id === high.id), 'search finds the tag name');
    assert.deepEqual((await inboxThread(actor, { customerId: high.id })).tags.map(t => t.name), [`测试-${tag}`, `样品-${tag}`]);

    // Administrators manage the shared library; renaming to a taken name is refused; deleting takes it off everyone.
    await assert.rejects(updateTag(first.tag.id, { color: 'green' }, sales), (e: unknown) => e instanceof HttpError && e.status === 403);
    await assert.rejects(updateTag(first.tag.id, { name: `测试-${tag}` }, actor), (e: unknown) => e instanceof HttpError && e.status === 409);
    assert.deepEqual((await updateTag(first.tag.id, { name: `要样品-${tag}`, color: 'purple' }, actor)).tag, { id: first.tag.id, name: `要样品-${tag}`, color: 'purple' });
    assert.deepEqual((await untagCustomer({ customerId: quoted.id, tagId: first.tag.id }, actor)).tags.map(t => t.name), [`测试-${tag}`]);
    await assert.rejects(deleteTag(first.tag.id, sales), (e: unknown) => e instanceof HttpError && e.status === 403);
    await deleteTag(first.tag.id, actor);
    assert.equal(await db.customerTagLink.count({ where: { tagId: first.tag.id } }), 0);
    await assert.rejects(deleteTag(first.tag.id, actor), (e: unknown) => e instanceof HttpError && e.status === 404);
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.customerTag.deleteMany({ where: { name: { endsWith: tag } } });
    await db.user.delete({ where: { id: seller.id } });
    await db.$disconnect();
  }
});
