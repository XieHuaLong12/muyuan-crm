import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { ruleGrade, type GradeInput } from '../lib/lead-grade';
import { createScript, updateScript } from '../services/outreach-script-service';
import { outreachNextView, outreachSendGuard, processOutreach, reconcileOutreach } from '../services/outreach-engine-service';
import { correctReply, correctTouch, decideGrade, reviewList } from '../services/outreach-review-service';
import { deliverWeeklyScriptReport, outreachDashboard } from '../services/outreach-analytics-service';
import { listTemplates, sendTemplateMessage } from '../services/whatsapp-template-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const business = '+19195550606';
const HOUR = 3_600_000;

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('lead grade: the Canton Fair makes a lead A, sofa sets count from 6', () => {
  const base: GradeInput = { answers: [], purchaseType: 'OTHER', quantity: null, productInterest: '', country: '', hasPhone: true, hasEmail: false, testLead: false };
  const fair = { question: 'will you visit the canton fair?', answer: 'yes,_phase_2' };
  assert.equal(ruleGrade({ ...base, answers: [fair] }).grade, 'A', 'coming to the fair is a trade buyer');
  assert.match(ruleGrade({ ...base, answers: [fair] }).reason, /会来广交会/);
  assert.equal(ruleGrade({ ...base, answers: [fair, { question: 'what type of business are you?', answer: 'personal_use' }] }).grade, 'C', 'unless they buy for themselves');
  assert.equal(ruleGrade({ ...base, answers: [{ question: 'will you visit the canton fair?', answer: 'no' }] }).grade, 'C');
  const sets = (answer: string) => ruleGrade({ ...base, purchaseType: 'RETAILER', answers: [{ question: 'how many sets for your first order?', answer }] });
  assert.equal(sets('6–19_sets').grade, 'A');
  assert.match(sets('6–19_sets').reason, /采购 6–19 套/);
  assert.equal(sets('1–5_sets').grade, 'B');
  assert.equal(ruleGrade({ ...base, purchaseType: 'RETAILER', quantity: 15 }).grade, 'B', 'pieces keep the 20-piece line');
});

test('outreach: rotation, BOS template touches, replies on time and late, locking, review, stop', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), marker = `Outreach${tag}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true, outreachConfig: true } });
  await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: new Date('2026-01-01T00:00:00Z'), outreachConfig: {} } });
  const [admin, sales] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }),
    db.user.create({ data: { name: `${marker} Seller`, email: `${marker.toLowerCase()}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } }),
  ]);
  const boss = actorOf(admin), me = actorOf(sales);
  let n = 0;
  const lead = async (data: Record<string, unknown> = {}) => {
    const phone = `+336${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;
    return db.customer.create({ data: { name: `${marker} Lead${n}`, ownerId: sales.id, source: 'FACEBOOK', sourceDetail: 'Sofa_FR_Oct', country: 'France', leadGrade: 'A',
      whatsapp: phone, phone, phoneE164: phone, whatsappNormalized: phone.slice(1), contactKeysAt: new Date(), assignedAt: new Date(), ...data } });
  };
  const message = (customerId: string, direction: 'INBOUND' | 'OUTBOUND', hoursAgo: number, content: string, extra: Record<string, unknown> = {}) =>
    db.whatsAppMessage.create({ data: { customerId, direction, content, sentAt: new Date(Date.now() - hoursAgo * HOUR), raw: '{}', source: 'gupshup',
      status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT', ...extra } });
  const bosTemplate = (customerId: string, hoursAgo: number, name: string) => message(customerId, 'OUTBOUND', hoursAgo, `Hi there — ${name}`,
    { messageType: 'TEMPLATE', requestId: randomUUID(), sentById: sales.id, status: 'ENQUEUED', raw: JSON.stringify({ template: { id: `id-${name}`, name, language: 'en' } }) });

  const content = 'Hi {客户名}! We make compressed sofas in Foshan. Do you sell in {国家} through stores or online?';
  const s1 = await createScript({ code: `T0-ZT${tag}1`, position: 'T0', grades: ['A', 'B'], language: 'en', content, templateName: `zt_${tag.toLowerCase()}_a` }, boss);
  const s2 = await createScript({ code: `T0-ZT${tag}2`, position: 'T0', grades: ['A', 'B'], language: 'en', content: 'Hello {客户名}, which market do you sell to?',
    templateName: `zt_${tag.toLowerCase()}_b`, buttonQualities: { 'Get a quote': 'HIGH', 'Not interested': 'REJECT' } }, boss);
  try {
    await assert.rejects(createScript({ code: `T0-ZT${tag}1`, position: 'T0', grades: ['A'], language: 'en', content: 'x' }, boss), (e: { status?: number }) => e.status === 409);
    await assert.rejects(createScript({ code: `T1-ZT${tag}9`, position: 'T0', grades: ['A'], language: 'en', content: 'x' }, boss), /须以触达位置 T0- 开头/);
    await assert.rejects(createScript({ code: `T0-ZT${tag}9`, position: 'T0', grades: ['A'], language: 'en', content: 'x' }, me), (e: { status?: number }) => e.status === 403);

    // Ten new A leads in a row: the two scripts under test alternate, 5:5.
    const ten: Awaited<ReturnType<typeof lead>>[] = [];
    for (let i = 0; i < 10; i++) ten.push(await lead());
    const assigned: (string | undefined)[] = [];
    for (const c of ten) assigned.push((await outreachNextView({ customerId: c.id }, me)).script?.code);
    assert.deepEqual(assigned, Array.from({ length: 10 }, (_, i) => i % 2 ? s2.code : s1.code));
    const first = await outreachNextView({ customerId: ten[0].id }, me);
    assert.deepEqual([first.state, first.next, first.script?.code], ['ICEBREAK', 'T0', s1.code]);
    assert.equal(first.script?.rendered, `Hi ${marker}! We make compressed sofas in Foshan. Do you sell in France through stores or online?`);

    // T0 sent from BOS as the assigned template: the touch is written at once with the code, the sender and the time.
    await withEnv({ GUPSHUP_SOURCE_NUMBER: business, GUPSHUP_APP_NAME: 'OUTREACH_TEST', GUPSHUP_API_KEY: 'outreach-key', GUPSHUP_APP_ID: `app-${tag}` }, async () => {
      t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
        const url = String(input);
        if (url === `https://api.gupshup.io/wa/app/app-${tag}/template`) return Response.json({ status: 'success', templates: [
          { id: 'tpl-a', elementName: `zt_${tag.toLowerCase()}_a`, languageCode: 'en', category: 'MARKETING', status: 'APPROVED', templateType: 'TEXT', data: 'Hi {{1}}! We make compressed sofas in Foshan. Do you sell in {{2}} through stores or online?' },
          { id: 'tpl-b', elementName: `zt_${tag.toLowerCase()}_b`, languageCode: 'en', category: 'MARKETING', status: 'APPROVED', templateType: 'TEXT', data: 'Hello {{1}}, which market do you sell to?' }] });
        if (url === 'https://api.gupshup.io/wa/api/v1/template/msg') return Response.json({ status: 'submitted', messageId: `gs-${randomUUID()}` });
        return new Response('unexpected', { status: 500 });
      });
      const list = await listTemplates(me, { customerId: ten[0].id, refresh: '1' });
      assert.deepEqual([list.suggestion?.templateId, 'outreach' in list ? list.outreach?.scriptCode : null], ['tpl-a', s1.code], 'the rotation picks the template, not the salesperson');
      const sent = await sendTemplateMessage({ customerId: ten[0].id, templateId: 'tpl-a', params: [marker, 'France'], requestId: randomUUID() }, me);
      const touch = await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[0].id } });
      assert.deepEqual([touch.code, touch.kind, touch.scriptId, touch.matchType, touch.channel, touch.senderId, touch.judgeStatus, touch.windowOpen, touch.grade],
        ['T0', 'ICEBREAK', s1.id, 'EXACT', 'BOS_TEMPLATE', sales.id, 'DONE', false, 'A']);
      assert.equal(touch.sentAt.getTime(), sent.message.sentAt.getTime());
      assert.equal((await db.outreachAssignment.findFirstOrThrow({ where: { customerId: ten[0].id, position: 'T0' } })).touchId, touch.id);
      // A second template right away is refused: 24 hours between touches outside the window.
      await assert.rejects(sendTemplateMessage({ customerId: ten[0].id, templateId: 'tpl-a', params: [marker, 'France'], requestId: randomUUID() }, me), /不足 24 小时/);
    });

    // The script went out: its words are locked; notes and status can still change.
    assert.ok((await db.outreachScript.findUniqueOrThrow({ where: { id: s1.id } })).firstSentAt);
    await assert.rejects(updateScript(s1.id, { content: 'Hi {客户名}, new opening?' }, boss), /内容已锁定/);
    await updateScript(s1.id, { versionNote: '开场先问销售市场' }, boss);
    await updateScript(s2.id, { content: 'Hello {客户名}, which market do you sell to today?' }, boss);
    await updateScript(s2.id, { content: 'Hello {客户名}, which market do you sell to?' }, boss);

    // Answered 2 hours after T0: a 24-hour reply, the conversation starts, the reply script is recorded.
    await db.whatsAppMessage.updateMany({ where: { customerId: ten[0].id }, data: { sentAt: new Date(Date.now() - 5 * HOUR) } });
    await message(ten[0].id, 'INBOUND', 3, 'We have 2 stores in Lyon, send the catalog');
    await processOutreach(ten[0].id, { ai: false });
    const answered = await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[0].id } });
    assert.deepEqual([answered.replied24h, answered.lateReply, answered.replyQuality], [true, false, 'ENGAGED']);
    const c0 = await db.customer.findUniqueOrThrow({ where: { id: ten[0].id } });
    assert.deepEqual([c0.outreachState, c0.outreachNext, c0.replyScriptCode, c0.bestReplyQuality], ['CONVERSING', '', s1.code, 'ENGAGED']);

    // An auto-reply is not a reply; the real answer 30 hours later is late. A template button is judged by the library.
    await bosTemplate(ten[1].id, 40, `zt_${tag.toLowerCase()}_b`);
    await message(ten[1].id, 'INBOUND', 39.99, 'Thank you for contacting Maison Jean. We will get back to you as soon as possible.');
    await message(ten[1].id, 'INBOUND', 10, 'Get a quote');
    await processOutreach(ten[1].id, { ai: false });
    const late = await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[1].id } });
    assert.deepEqual([late.scriptId, late.replied24h, late.lateReply, late.replyQuality], [s2.id, false, true, 'HIGH']);
    const replies = await db.outreachReply.findMany({ where: { customerId: ten[1].id }, orderBy: { receivedAt: 'asc' } });
    assert.deepEqual(replies.map(r => [r.quality, r.judgedBy, r.touchId]), [['INVALID', 'RULE', null], ['HIGH', 'BUTTON', late.id]]);

    // No reply after a day: T1 is due on day 1 after T0, with a follow-up task naming the assigned script.
    await bosTemplate(ten[2].id, 30, `zt_${tag.toLowerCase()}_a`);
    await processOutreach(ten[2].id, { ai: false });
    const waiting = await db.customer.findUniqueOrThrow({ where: { id: ten[2].id } });
    assert.deepEqual([waiting.outreachState, waiting.outreachNext], ['ICEBREAK', 'T1']);
    const task = await db.task.findFirstOrThrow({ where: { customerId: ten[2].id, automationKey: `outreach:${ten[2].id}:0:T1`, status: { not: 'DONE' } } });
    assert.equal(task.dueDate.getTime(), (await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[2].id } })).sentAt.getTime() + 24 * HOUR);
    assert.equal((await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[2].id } })).replied24h, false);

    // Phone sends: the script word for word is matched by the rules; anything else waits for DeepSeek, or a person here.
    await message(ten[3].id, 'OUTBOUND', 4, `Hi ${marker}! We make compressed sofas in Foshan. Do you sell in France through stores or online?`);
    await message(ten[4].id, 'OUTBOUND', 4, 'Hello, we are a sofa factory, are you still interested?');
    await processOutreach(ten[3].id, { ai: false });
    await processOutreach(ten[4].id, { ai: false });
    const exact = await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[3].id } });
    assert.deepEqual([exact.scriptId, exact.matchType, exact.channel, exact.senderId, exact.judgedBy], [s1.id, 'EXACT', 'PHONE', sales.id, 'RULE'], 'the shared company number is credited to the owner');
    const unsure = await db.outreachTouch.findFirstOrThrow({ where: { customerId: ten[4].id } });
    assert.equal(unsure.judgeStatus, 'REVIEW');
    const review = await reviewList(me, { tab: 'touches' });
    assert.ok(review.touches.some(r => r.id === unsure.id));
    await assert.rejects(correctTouch(unsure.id, { scriptId: s2.id, matchType: 'HEAVY' }, me), /请选择修改原因/);
    await correctTouch(unsure.id, { scriptId: s2.id, matchType: 'HEAVY', reason: 'AI_WRONG', note: '开场改了' }, me);
    const fixed = await db.outreachTouch.findUniqueOrThrow({ where: { id: unsure.id }, include: { overrides: true } });
    assert.deepEqual([fixed.scriptId, fixed.matchType, fixed.judgeStatus, fixed.judgedBy, fixed.humanEdited], [s2.id, 'HEAVY', 'DONE', 'HUMAN', true]);
    assert.deepEqual(fixed.overrides.map(o => [o.field, o.oldValue, o.newValue, o.reason]).sort(), [['MATCH_TYPE', '', 'HEAVY', 'AI_WRONG'], ['SCRIPT', '', s2.code, 'AI_WRONG']]);

    // A photo reply goes to a person; the correction is logged and the numbers follow it.
    await message(ten[4].id, 'INBOUND', 2, '[图片]', { messageType: 'IMAGE' });
    await processOutreach(ten[4].id, { ai: false });
    const photo = await db.outreachReply.findFirstOrThrow({ where: { customerId: ten[4].id } });
    assert.deepEqual([photo.needsHuman, photo.judgeStatus, photo.signals], [true, 'REVIEW', ['NEEDS_HUMAN']]);
    assert.ok((await reviewList(me, { tab: 'replies' })).replies.some(r => r.id === photo.id));
    await correctReply(photo.id, { quality: 'HIGH', signals: ['ASK_PRICE', 'NEEDS_HUMAN'], reason: 'VOICE_IMAGE' }, me);
    assert.equal((await db.outreachTouch.findUniqueOrThrow({ where: { id: unsure.id } })).replyQuality, 'HIGH');
    assert.equal(await db.outreachOverride.count({ where: { replyId: photo.id } }), 2);

    // Grades: a person's grade is kept; a suggestion is confirmed with one click.
    await db.outreachReply.update({ where: { id: photo.id }, data: { gradeSuggestion: 'B', gradeSuggestionStatus: 'PENDING', reason: '客户自称零售店' } });
    assert.equal((await reviewList(me, { tab: 'grades' })).replies.some(r => r.id === photo.id), true);
    await decideGrade({ action: 'ACCEPT', replyId: photo.id }, me);
    const graded = await db.customer.findUniqueOrThrow({ where: { id: ten[4].id } });
    assert.deepEqual([graded.leadGrade, graded.leadGradeSource], ['B', 'HUMAN']);
    await assert.rejects(decideGrade({ action: 'ACCEPT', replyId: photo.id }, me), (e: { status?: number }) => e.status === 409);
    await decideGrade({ action: 'SET', customerId: ten[4].id, grade: 'A', note: '见面确认是批发商' }, me);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: ten[4].id } })).leadGrade, 'A');

    // A stop request: the conversation stops, the customer is opted out, BOS sends nothing more.
    await bosTemplate(ten[5].id, 3, `zt_${tag.toLowerCase()}_b`);
    await message(ten[5].id, 'INBOUND', 1, 'Stop');
    await processOutreach(ten[5].id, { ai: false });
    const stopped = await db.customer.findUniqueOrThrow({ where: { id: ten[5].id } });
    assert.deepEqual([stopped.outreachState, stopped.whatsappOptInStatus], ['STOPPED', 'OPTED_OUT']);
    await assert.rejects(outreachSendGuard(ten[5].id, 'FREE'), /停止联系/);
    await assert.rejects(outreachSendGuard(ten[5].id, 'TEMPLATE'), /停止联系/);

    // The dashboard: both scripts listed, too few sends to compare yet.
    const board = await outreachDashboard(boss, { position: 'T0', range: '30' });
    const rows = board.ranking.filter(r => r.code.startsWith(`T0-ZT${tag}`));
    assert.deepEqual(rows.map(r => r.suggestion), ['INSUFFICIENT', 'INSUFFICIENT']);
    assert.ok(board.cards.sent >= 6);
    const mine = rows.find(r => r.id === s1.id)!;
    assert.deepEqual([mine.sent, mine.matured, mine.replied], [3, 2, 1], 'T0 by BOS, the waiting lead, and the phone copy still inside its 24 hours');
    assert.equal(rows.find(r => r.id === s2.id)!.sent, 2, 'the heavy rewrite is not counted for its script');

    // Monday conclusion: written once per week.
    await db.outreachReport.deleteMany({});
    assert.equal((await deliverWeeklyScriptReport()).generated, true);
    assert.equal((await deliverWeeklyScriptReport()).generated, false);

    // Reconciling twice changes nothing: records are keyed by their first message.
    const before = await db.outreachTouch.count({ where: { customer: { name: { startsWith: marker } } } });
    for (const c of ten) await reconcileOutreach(c.id);
    assert.equal(await db.outreachTouch.count({ where: { customer: { name: { startsWith: marker } } } }), before);
  } finally {
    await db.outreachReport.deleteMany({});
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.outreachScript.deleteMany({ where: { code: { startsWith: `T0-ZT${tag}` } } });
    await db.user.deleteMany({ where: { id: sales.id } });
    await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: setting.outreachStartedAt, outreachConfig: setting.outreachConfig === null ? Prisma.DbNull : setting.outreachConfig } });
  }
});

test('outreach with DeepSeek: phone messages matched, unsure ones reviewed, replies judged, a stop request stops, an outage waits', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), marker = `OutreachAi${tag}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true, outreachConfig: true } });
  await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: new Date('2026-01-01T00:00:00Z'), outreachConfig: {} } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const boss = actorOf(admin);
  const script = await createScript({ code: `T0-ZT${tag}1`, position: 'T0', grades: ['A', 'B', 'C'], language: 'en', content: 'Hi {客户名}, which market do you sell to, stores or online?' }, boss);
  const lead = (n: number, grade = 'B') => db.customer.create({ data: { name: `${marker} Lead${n}`, ownerId: admin.id, leadGrade: grade, source: 'FACEBOOK' } });
  const message = (customerId: string, direction: 'INBOUND' | 'OUTBOUND', hoursAgo: number, content: string) =>
    db.whatsAppMessage.create({ data: { customerId, direction, content, sentAt: new Date(Date.now() - hoursAgo * HOUR), raw: '{}', source: 'gupshup', status: direction === 'INBOUND' ? 'RECEIVED' : 'SENT' } });
  const asked: string[] = [];
  let down = false;
  try {
    await withEnv({ DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: 'https://deepseek.test' }, async () => {
      t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
        if (String(input) !== 'https://deepseek.test/chat/completions') return new Response('unexpected', { status: 500 });
        if (down) return Response.json({ error: { message: 'overloaded' } }, { status: 503 });
        const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        const system = body.messages[0].content, user = body.messages[1].content;
        asked.push(system.includes('话术识别') ? 'match' : 'reply');
        const answer = system.includes('话术识别')
          ? user.includes('SURE') ? { scriptCode: script.code, matchType: 'LIGHT', confidence: 0.92, intent: 'GREETING', reason: '只换了称呼' }
            : { scriptCode: script.code, matchType: 'HEAVY', confidence: 0.5, intent: 'PRODUCT', reason: '结尾问题改了' }
          : user.includes('100 pcs') ? { quality: 'HIGH', signals: ['QUANTITY', 'ASK_PRICE', 'NOT_A_SIGNAL'], gradeSuggestion: 'A', nextStep: '先按价格表报 100 件的阶梯价，再问交期。', reason: '报出数量并问价' }
            : { quality: 'REJECT', signals: ['STOP_CONTACT'], gradeSuggestion: null, nextStep: '', reason: '客户要求不要再联系' };
        return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
      });
      const [sure, unsure, stop, outage] = await Promise.all([lead(1), lead(2), lead(3), lead(4)]);
      await message(sure.id, 'OUTBOUND', 30, 'Hello Jean, which market do you sell to — stores or online? SURE');
      await message(sure.id, 'INBOUND', 28, 'We have 3 stores in Lyon and need 100 pcs, what is your price?');
      await message(unsure.id, 'OUTBOUND', 30, 'We are a sofa factory in Foshan with 20 years of export experience.');
      await message(stop.id, 'OUTBOUND', 30, 'Hello again, any news?');
      await message(stop.id, 'INBOUND', 29, 'Please do not write to me anymore, thanks');
      for (const c of [sure, unsure, stop]) await processOutreach(c.id);

      const matched = await db.outreachTouch.findFirstOrThrow({ where: { customerId: sure.id } });
      assert.deepEqual([matched.scriptId, matched.matchType, matched.judgeStatus, matched.judgedBy, matched.intent, Number(matched.confidence)], [script.id, 'LIGHT', 'DONE', 'AI', 'GREETING', 0.92]);
      assert.deepEqual([matched.replied24h, matched.replyQuality], [true, 'HIGH']);
      const reply = await db.outreachReply.findFirstOrThrow({ where: { customerId: sure.id } });
      assert.deepEqual([reply.quality, reply.signals, reply.gradeSuggestion, reply.gradeSuggestionStatus, reply.judgedBy], ['HIGH', ['QUANTITY', 'ASK_PRICE'], 'A', 'PENDING', 'AI'], 'unknown signals are dropped');
      assert.match(reply.nextStep, /阶梯价/);
      assert.equal((await db.customer.findUniqueOrThrow({ where: { id: sure.id } })).bestReplyQuality, 'HIGH');

      const review = await db.outreachTouch.findFirstOrThrow({ where: { customerId: unsure.id } });
      assert.deepEqual([review.judgeStatus, review.matchType], ['REVIEW', 'HEAVY'], 'confidence below 0.7 goes to a person');
      assert.match(review.judgeReason, /置信度 0\.50 低于 0\.7/);

      const stopped = await db.customer.findUniqueOrThrow({ where: { id: stop.id } });
      assert.deepEqual([stopped.outreachState, stopped.whatsappOptInStatus], ['STOPPED', 'OPTED_OUT'], 'a stop request the rules could not read is still a stop');

      // DeepSeek down: the touch waits (rules only) and is judged by a later run.
      down = true;
      await message(outage.id, 'OUTBOUND', 30, 'Hi, do you still need sofas? SURE');
      await processOutreach(outage.id);
      assert.equal((await db.outreachTouch.findFirstOrThrow({ where: { customerId: outage.id } })).judgeStatus, 'PENDING');
      down = false;
      await db.outreachTouch.updateMany({ where: { customerId: outage.id }, data: { judgedAt: new Date(Date.now() - 11 * 60_000) } });
      await processOutreach(outage.id);
      assert.equal((await db.outreachTouch.findFirstOrThrow({ where: { customerId: outage.id } })).judgeStatus, 'DONE');

      // A person corrects DeepSeek: the correction counts in this month's rate.
      await correctTouch(review.id, { scriptId: null, matchType: 'FREE', reason: 'AI_WRONG' }, boss);
      const board = await outreachDashboard(boss, { position: 'T0', range: '30' });
      assert.ok(board.quality.overrideCorrected >= 1 && board.quality.overrideTotal >= 4);
      assert.ok(asked.includes('match') && asked.includes('reply'));
    });
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.outreachScript.deleteMany({ where: { code: { startsWith: `T0-ZT${tag}` } } });
    await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: setting.outreachStartedAt, outreachConfig: setting.outreachConfig === null ? Prisma.DbNull : setting.outreachConfig } });
  }
});

test('every customer we have not written to gets a T0 script: customers who wrote first, other grades, other languages', async () => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(), marker = `Icebreak${tag}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { outreachStartedAt: true, outreachConfig: true } });
  await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: new Date('2026-01-01T00:00:00Z'), outreachConfig: {} } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const boss = actorOf(admin);
  let n = 0;
  const lead = (data: Record<string, unknown> = {}) => {
    const phone = `+336${String(Date.now()).slice(-6)}${String(++n).padStart(2, '0')}`;
    return db.customer.create({ data: { name: `${marker} Lead${n}`, ownerId: admin.id, source: 'FACEBOOK', leadGrade: 'B', whatsapp: phone, phone, phoneE164: phone,
      whatsappNormalized: phone.slice(1), contactKeysAt: new Date(), assignedAt: new Date(), ...data } });
  };
  const inbound = (customerId: string, hoursAgo: number, content: string) => db.whatsAppMessage.create({ data: { customerId, direction: 'INBOUND', content,
    sentAt: new Date(Date.now() - hoursAgo * HOUR), raw: '{}', source: 'gupshup', status: 'RECEIVED' } });
  try {
    // Before the library has a usable T0, the chat says so instead of leaving the salesperson guessing.
    const early = await lead();
    const usable = await db.outreachScript.count({ where: { position: 'T0', status: { in: ['TESTING', 'WINNER'] } } });
    if (!usable) {
      const view = await outreachNextView({ customerId: early.id }, boss);
      assert.deepEqual([view.next, view.script, view.noScript], ['T0', null, 'LIBRARY_EMPTY']);
      await db.outreachAssignment.deleteMany({ where: { customerId: early.id } });
    }

    // Only an A-grade English script: a B lead, a French lead and a lead who wrote first all get it.
    const script = await createScript({ code: `T0-IB${tag}1`, position: 'T0', grades: ['A'], language: 'en', content: 'Hi {客户名}, do you sell in stores or online?' }, boss);
    const wroteFirst = await lead();
    await inbound(wroteFirst.id, 2, 'Hello, I saw your ad. Price for 20 sofas?');
    const french = await lead({ language: 'Français' });
    for (const customer of [early, wroteFirst, french]) {
      const view = await outreachNextView({ customerId: customer.id }, boss);
      assert.deepEqual([view.state, view.next, view.script?.code, view.noScript], ['ICEBREAK', 'T0', script.code, null], customer.name);
      assert.ok(view.script?.rendered.startsWith(`Hi ${marker}`), 'ready to copy, with the name filled in');
    }
    const assignment = await db.outreachAssignment.findFirstOrThrow({ where: { customerId: wroteFirst.id, position: 'T0' } });
    assert.deepEqual([assignment.grade, assignment.language], ['B', 'en'], 'the statistics still count it under the customer\'s grade');

    // A D lead (Meta test lead or no contact) gets none, and the chat says how to fix a wrong grade.
    const invalid = await lead({ leadGrade: 'D' });
    const view = await outreachNextView({ customerId: invalid.id }, boss);
    assert.deepEqual([view.next, view.script, view.noScript], ['T0', null, 'GRADE_D']);
  } finally {
    await deleteTestCustomers({ where: { name: { startsWith: marker } } });
    await db.outreachScript.deleteMany({ where: { code: { startsWith: `T0-IB${tag}` } } });
    await db.setting.update({ where: { id: 'system' }, data: { outreachStartedAt: setting.outreachStartedAt, outreachConfig: setting.outreachConfig ?? Prisma.DbNull } });
  }
});
