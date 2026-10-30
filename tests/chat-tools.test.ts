import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../lib/db';
import { HttpError } from '../lib/auth';
import { needsTranslation } from '../lib/message-translation';
import { containsPrice, fillVariables, matchesReply, replyFor } from '../lib/quick-replies';
import { languageRank } from '../lib/sales-materials';
import { inboxConversations, inboxThread } from '../services/inbox-service';
import { decideGrade } from '../services/outreach-review-service';
import { keepOriginal, setAutoTranslate, translateBatch, translateMessage } from '../services/message-translation-service';
import { countReplyUse, createQuickReply, deleteQuickReply, quickReplyList, updateQuickReply } from '../services/quick-reply-service';
import { attachMaterials, deleteMaterial, listMaterials, materialPicker, replaceMaterialFile, uploadMaterial } from '../services/sales-material-service';
import { storeMedia } from '../services/whatsapp-media-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const status = (code: number) => (e: unknown) => e instanceof HttpError && e.status === code;

test('which messages get a Chinese line, prices in quick replies, language order', () => {
  assert.equal(needsTranslation({ content: "Oui je veux bien le prix d'un matelas" }), true);
  assert.equal(needsTranslation({ content: 'Ok' }), true);
  assert.equal(needsTranslation({ content: '好的，谢谢' }), false, 'Chinese');
  assert.equal(needsTranslation({ content: '95470' }), false, 'numbers only');
  assert.equal(needsTranslation({ content: '👍' }), false);
  assert.equal(needsTranslation({ content: '[IMAGE]', messageType: 'IMAGE' }), false);
  assert.equal(needsTranslation({ content: 'catalogue.pdf', messageType: 'DOCUMENT', fileName: 'catalogue.pdf' }), false, 'a file name');
  assert.equal(needsTranslation({ content: 'Voici le catalogue', messageType: 'DOCUMENT', fileName: 'catalogue.pdf' }), true, 'a caption');

  for (const priced of ['$120', '120 USD', '99,5 €', '每件 80 元', 'EUR 50', '80元']) assert.equal(containsPrice(priced), true, priced);
  for (const fine of ['leur 2 matelas', "30 % d'acompte", '25 à 30 jours', '40 pieds', '2块床垫', '30% 定金']) assert.equal(containsPrice(fine), false, fine);

  const reply = { zh: '你好 {客户名}', bodies: { fr: 'Bonjour {客户名}', en: 'Hello {客户名}' } };
  assert.deepEqual(replyFor(reply, 'fr'), { text: 'Bonjour {客户名}', language: 'fr', missing: false });
  assert.deepEqual(replyFor(reply, 'ar'), { text: 'Hello {客户名}', language: 'en', missing: true }, 'no Arabic: English, flagged');
  assert.deepEqual(replyFor({ zh: '你好', bodies: {} }, 'fr'), { text: '你好', language: 'zh', missing: true });
  assert.equal(fillVariables('Bonjour {客户名}, ici {我的名字}', { customer: 'Joe', me: 'coco' }), 'Bonjour Joe, ici coco');
  assert.equal(matchesReply({ title: '交期 · 25–30 天', zh: '下单后生产', category: 'LEAD_TIME' }, '交期'), true);
  assert.equal(matchesReply({ title: '样品', zh: '7 天寄出', category: 'LEAD_TIME' }, '交期'), true, 'the category counts');
  assert.equal(matchesReply({ title: '付款', zh: '30% 定金', category: 'PAYMENT' }, '交期'), false);

  assert.deepEqual(['', 'en', 'fr', 'ar'].sort((a, b) => languageRank(a, 'fr') - languageRank(b, 'fr')), ['fr', '', 'en', 'ar']);
});

test('grade avatars: filter by grade, change with undo, AI suggestions from the chat', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), now = new Date();
  const marker = await db.customerTag.create({ data: { name: `等级-${tag}`, color: 'blue', createdBy: admin.id } });
  const make = async (name: string, leadGrade: string) => {
    const c = await db.customer.create({ data: { name: `${name} ${tag}`, ownerId: admin.id, inquiryAt: now, stage: 'CONTACTED', leadGrade, leadGradeSource: leadGrade ? 'AI' : '',
      leadGradeReason: leadGrade ? '批发商；采购两款' : '', leadGradedAt: leadGrade ? new Date(now.getTime() - 3600_000) : null } });
    await db.customerTagLink.create({ data: { customerId: c.id, tagId: marker.id, createdBy: admin.id } });
    await db.whatsAppMessage.create({ data: { customerId: c.id, direction: 'INBOUND', content: 'Bonjour', sentAt: now, raw: '{}', source: 'gupshup' } });
    return c;
  };
  try {
    const joe = await make('Joe', 'B');
    await make('Karim', 'A'); await make('Nisar', '');
    const names = async (grades: string) => (await inboxConversations(actor, { tagId: marker.id, grades })).conversations.map(c => c.name.replace(` ${tag}`, '')).sort();
    assert.deepEqual(await names(''), ['Joe', 'Karim', 'Nisar']);
    assert.deepEqual(await names('A'), ['Karim']);
    assert.deepEqual(await names('B,none'), ['Joe', 'Nisar']);
    assert.deepEqual(await names('none,bogus'), ['Nisar'], 'unknown keys are ignored');
    const row = (await inboxConversations(actor, { tagId: marker.id, grades: 'B' })).conversations[0];
    assert.deepEqual([row.grade, row.gradeReason], ['B', '批发商；采购两款']);
    assert.equal((await inboxConversations(actor, { filter: 'todo', tagId: marker.id, grades: 'A' })).todo.every(t => t.grade === 'A'), true);

    // One click: D is allowed too; 撤销 puts back the grade, its source, reason and time.
    const before = await db.customer.findUniqueOrThrow({ where: { id: joe.id }, select: { leadGradedAt: true } });
    const set = await decideGrade({ action: 'SET', customerId: joe.id, grade: 'D' }, actor);
    assert.equal(set.grade, 'D');
    assert.deepEqual({ ...set.undo, gradedAt: undefined }, { grade: 'B', source: 'AI', reason: '批发商；采购两款', gradedAt: undefined, setGrade: 'D', replyIds: [] });
    let saved = await db.customer.findUniqueOrThrow({ where: { id: joe.id } });
    assert.deepEqual([saved.leadGrade, saved.leadGradeSource], ['D', 'HUMAN']);
    assert.match(saved.leadGradeReason, /手动调整（原 B）/);
    await decideGrade({ action: 'UNDO', customerId: joe.id, undo: set.undo }, actor);
    saved = await db.customer.findUniqueOrThrow({ where: { id: joe.id } });
    assert.deepEqual([saved.leadGrade, saved.leadGradeSource, saved.leadGradeReason, saved.leadGradedAt?.getTime()], ['B', 'AI', '批发商；采购两款', before.leadGradedAt?.getTime()]);
    await assert.rejects(decideGrade({ action: 'UNDO', customerId: joe.id, undo: set.undo }, actor), status(409), 'nothing left to undo');

    // An AI suggestion shows on the avatar; accepting it can be undone, which brings the suggestion back.
    const suggestion = await db.outreachReply.create({ data: { groupKey: `grade-${tag}`, customerId: joe.id, receivedAt: now, gradeSuggestion: 'A', gradeSuggestionStatus: 'PENDING',
      reason: '要两款的价格，还给了邮编', text: 'prix', contentHash: 'x'.repeat(64) } });
    assert.equal((await inboxThread(actor, { customerId: joe.id })).gradeSuggestion?.id, suggestion.id);
    const accepted = await decideGrade({ action: 'ACCEPT', replyId: suggestion.id }, actor);
    assert.equal(accepted.grade, 'A');
    assert.equal((await inboxThread(actor, { customerId: joe.id })).gradeSuggestion, null);
    await decideGrade({ action: 'UNDO', customerId: joe.id, undo: accepted.undo }, actor);
    assert.equal((await db.outreachReply.findUniqueOrThrow({ where: { id: suggestion.id } })).gradeSuggestionStatus, 'PENDING');
    const thread = await inboxThread(actor, { customerId: joe.id });
    assert.deepEqual([thread.customer.leadGrade, thread.gradeSuggestion?.gradeSuggestion], ['B', 'A']);
    // A manual grade settles the open suggestion; undoing it reopens the suggestion as well.
    const manual = await decideGrade({ action: 'SET', customerId: joe.id, grade: 'C', note: '电话确认是零售' }, actor);
    assert.deepEqual(manual.undo?.replyIds, [suggestion.id]);
    assert.equal((await db.outreachReply.findUniqueOrThrow({ where: { id: suggestion.id } })).gradeSuggestionStatus, 'DISMISSED');
    // Changed again since: the older undo no longer applies.
    await decideGrade({ action: 'SET', customerId: joe.id, grade: 'A' }, actor);
    await assert.rejects(decideGrade({ action: 'UNDO', customerId: joe.id, undo: manual.undo }, actor), status(409));
  } finally {
    await deleteTestCustomers({ where: { name: { endsWith: ` ${tag}` } } });
    await db.customerTag.deleteMany({ where: { id: marker.id } });
  }
});

test('自动翻译: stored once, per-customer switch, the Chinese we wrote kept with our message', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), now = new Date();
  const old = await db.translationSetting.findUnique({ where: { id: 'meta' } }), originalFetch = globalThis.fetch;
  const customer = await db.customer.create({ data: { name: `Translate ${tag}`, ownerId: admin.id, inquiryAt: now, stage: 'REPLIED' } });
  const message = (content: string, direction = 'INBOUND', at = 0) => db.whatsAppMessage.create({ data: { customerId: customer.id, direction, content, sentAt: new Date(now.getTime() + at), raw: '{}', source: 'gupshup' } });
  try {
    const french = await message("Je veux le prix d'un matelas", 'INBOUND', 1), chinese = await message('你好', 'INBOUND', 2), ours = await message('Merci Joe', 'OUTBOUND', 3);
    await keepOriginal(ours.id, '谢谢 Joe');
    // No translation service and no DeepSeek: nothing stored, and the chat is told to stop asking.
    await db.translationSetting.deleteMany({ where: { id: 'meta' } });
    assert.deepEqual(await translateBatch(actor, { customerId: customer.id, messageIds: [french.id, chinese.id] }), { translations: {}, unavailable: true });

    let calls = 0;
    await db.translationSetting.create({ data: { id: 'meta', endpoint: 'https://translator.example.test/translate', encryptedKey: '' } });
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ translatedText: '我想要床垫的价格' }), { status: 200 }); }) as typeof fetch;
    const batch = await translateBatch(actor, { customerId: customer.id, messageIds: [french.id, chinese.id, ours.id] });
    assert.deepEqual(batch, { translations: { [french.id]: { kind: 'MACHINE', text: '我想要床垫的价格' } }, unavailable: false }, 'Chinese and messages with our own Chinese are skipped');
    assert.equal(calls, 1);
    // Stored: a click or another visit never translates again.
    assert.deepEqual(await translateMessage(actor, { messageId: french.id }), { text: '我想要床垫的价格', kind: 'MACHINE' });
    assert.deepEqual(await translateBatch(actor, { customerId: customer.id, messageIds: [french.id] }), { translations: {}, unavailable: false });
    assert.equal(calls, 1);
    const thread = await inboxThread(actor, { customerId: customer.id });
    assert.deepEqual(Object.fromEntries(thread.messages.map(m => [m.content, m.translation])), {
      "Je veux le prix d'un matelas": { kind: 'MACHINE', text: '我想要床垫的价格' }, '你好': null, 'Merci Joe': { kind: 'ORIGINAL', text: '谢谢 Joe' } });
    assert.equal(thread.customer.autoTranslate, true, 'on by default');

    await setAutoTranslate(actor, { customerId: customer.id, on: false });
    assert.equal((await inboxThread(actor, { customerId: customer.id })).customer.autoTranslate, false);
    await assert.rejects(translateBatch(actor, { customerId: customer.id, messageIds: [french.id] }), status(409), 'switched off: only a click translates');
  } finally {
    globalThis.fetch = originalFetch;
    await db.translationSetting.deleteMany({ where: { id: 'meta' } });
    if (old) await db.translationSetting.create({ data: old });
    await deleteTestCustomers({ where: { id: customer.id } });
  }
});

test('常用回复: company and own replies, no prices, most used first', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), now = new Date();
  const seller = await db.user.create({ data: { name: `Coco ${tag}`, email: `replies-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const sales = { id: seller.id, name: seller.name, email: seller.email, role: 'SALES' };
  const customer = await db.customer.create({ data: { name: `JOE ABI-AAD ${tag}`, ownerId: seller.id, inquiryAt: now, stage: 'REPLIED', country: 'France' } });
  try {
    const shared = await createQuickReply(actor, { scope: 'SHARED', title: `交期 ${tag}`, category: 'LEAD_TIME', zh: '你好 {客户名}，下单后 25–30 天',
      bodies: { fr: 'Bonjour {客户名}, 25 à 30 jours après la commande', en: 'Hi {客户名}, 25–30 days after the order' } });
    await assert.rejects(createQuickReply(sales, { scope: 'SHARED', title: 'x', zh: '中文' }), status(403), 'only administrators keep company replies');
    await assert.rejects(createQuickReply(sales, { title: 'price', zh: '每件 80 元' }), status(400));
    await assert.rejects(createQuickReply(sales, { title: 'price', zh: '价格', bodies: { en: 'USD 80 per piece' } }), status(400), 'no price in any language');
    const mine = await createQuickReply(sales, { title: `跟进 ${tag}`, category: 'INFO', zh: '目录看了吗？', bodies: { fr: 'Avez-vous vu le catalogue ?' } });

    const list = await quickReplyList(sales, { customerId: customer.id });
    assert.deepEqual(list.customer, { language: 'fr', firstName: 'Joe' }, 'France reads French; the first name for {客户名}');
    assert.equal(list.me, sales.name);
    assert.equal(list.canShare, false);
    const ours = list.replies.filter(r => r.title.endsWith(tag));
    assert.deepEqual(ours.map(r => [r.title, r.scope]).sort(), [[`交期 ${tag}`, 'SHARED'], [`跟进 ${tag}`, 'MINE']]);
    assert.equal((await quickReplyList(actor)).replies.some(r => r.id === mine.id), false, "someone else's replies stay theirs");

    await countReplyUse(sales, mine.id);
    const counted = (await quickReplyList(sales)).replies.find(r => r.id === mine.id)!;
    assert.equal(counted.useCount, 1);

    await assert.rejects(updateQuickReply(sales, shared.id, { title: 'x', zh: 'y' }), status(403));
    await updateQuickReply(sales, mine.id, { title: `跟进目录 ${tag}`, category: 'INFO', zh: '目录看了吗？', bodies: { fr: 'Avez-vous regardé le catalogue ?', en: 'Did you see the catalogue?' } });
    assert.deepEqual((await quickReplyList(sales)).replies.find(r => r.id === mine.id)!.bodies, { fr: 'Avez-vous regardé le catalogue ?', en: 'Did you see the catalogue?' });
    await assert.rejects(deleteQuickReply(actor, mine.id), status(404));
    await deleteQuickReply(sales, mine.id);
    await deleteQuickReply(actor, shared.id);
    assert.equal((await quickReplyList(sales)).replies.some(r => r.title.endsWith(tag)), false);
    await assert.rejects(countReplyUse(sales, mine.id), status(404));
  } finally {
    await db.quickReply.deleteMany({ where: { title: { endsWith: tag } } });
    await deleteTestCustomers({ where: { id: customer.id } });
    await db.user.deleteMany({ where: { id: seller.id } });
  }
});

test('产品资料: the 资料库, the customer\'s language first, files copied into the chat', async () => {
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role };
  const tag = randomUUID().slice(0, 8), now = new Date();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'materials-')), previous = process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR = dir;
  const seller = await db.user.create({ data: { name: `Seller ${tag}`, email: `materials-${tag}@example.test`, passwordHash: 'test', role: 'SALES' } });
  const sales = { id: seller.id, name: seller.name, email: seller.email, role: 'SALES' };
  const customer = await db.customer.create({ data: { name: `Material ${tag}`, ownerId: seller.id, inquiryAt: now, stage: 'REPLIED', country: 'France' } });
  const other = await db.customer.create({ data: { name: `Other ${tag}`, ownerId: seller.id, inquiryAt: now, stage: 'REPLIED' } });
  const pdf = (name: string, text = '%PDF-1.4 test') => new File([text], name, { type: 'application/pdf' });
  try {
    const english = await uploadMaterial(actor, pdf('catalog-en.pdf'), { title: `Catalog EN ${tag}`, category: 'CATALOG', language: 'en' });
    const french = await uploadMaterial(actor, pdf('catalog-fr.pdf'), { title: `Catalogue FR ${tag}`, category: 'CATALOG', language: 'fr' });
    const factory = await uploadMaterial(actor, pdf('factory.pdf'), { title: `Factory ${tag}`, category: 'FACTORY' });
    await assert.rejects(uploadMaterial(sales, pdf('x.pdf'), { title: 'x' }), status(403));
    await assert.rejects(uploadMaterial(actor, new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }), { title: 'x' }), status(400));

    const picker = await materialPicker(sales, { customerId: customer.id, q: tag });
    assert.equal(picker.language, 'fr');
    assert.deepEqual(picker.files.map(f => f.id), [french.id, factory.id, english.id], 'French first, then files for every language, then English');

    // Sent lately from another chat: offered again without uploading.
    const sentBefore = await storeMedia({ customerId: other.id, createdBy: seller.id, fileName: `size-${tag}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF sizes') });
    await db.whatsAppMessage.create({ data: { customerId: other.id, direction: 'OUTBOUND', sentById: seller.id, content: '', messageType: 'FILE', fileName: sentBefore.fileName,
      mimeType: 'application/pdf', mediaUrl: `/api/whatsapp/media/${sentBefore.id}`, status: 'DELIVERED', sentAt: now, raw: '{}', source: 'gupshup' } });
    const recent = (await materialPicker(sales, { customerId: customer.id })).recent.find(r => r.id === sentBefore.id);
    assert.equal(recent?.to, other.name);
    assert.equal((await materialPicker(actor, { customerId: customer.id })).recent.some(r => r.id === sentBefore.id), false, 'only what this person sent');

    const { assets } = await attachMaterials(sales, { customerId: customer.id, items: [{ kind: 'MATERIAL', id: french.id }, { kind: 'RECENT', id: sentBefore.id }] });
    assert.deepEqual(assets.map(a => a.fileName), ['catalog-fr.pdf', `size-${tag}.pdf`]);
    assert.equal(await db.mediaAsset.count({ where: { customerId: customer.id } }), 2, 'copied into this customer\'s attachments');
    await assert.rejects(attachMaterials(actor, { customerId: customer.id, items: [{ kind: 'RECENT', id: sentBefore.id }] }), status(404));

    // 换新版 keeps the entry; deleting takes it out of the library.
    const replaced = await replaceMaterialFile(actor, french.id, pdf('catalog-fr-2027.pdf', '%PDF-1.4 new'));
    assert.equal(replaced.fileName, 'catalog-fr-2027.pdf');
    await deleteMaterial(actor, english.id);
    assert.equal((await listMaterials()).some(m => m.id === english.id), false);
    await assert.rejects(attachMaterials(sales, { customerId: customer.id, items: [{ kind: 'MATERIAL', id: english.id }] }), status(404));
  } finally {
    await db.salesMaterial.deleteMany({ where: { title: { endsWith: tag } } });
    await deleteTestCustomers({ where: { id: { in: [customer.id, other.id] } } });
    await db.user.deleteMany({ where: { id: seller.id } });
    process.env.MEDIA_STORAGE_DIR = previous;
    if (previous === undefined) delete process.env.MEDIA_STORAGE_DIR;
    await rm(dir, { recursive: true, force: true });
    await db.$disconnect();
  }
});
