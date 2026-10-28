import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { sealSecret } from '../lib/secret';
import { DEFAULT_RADAR_CONFIG } from '../lib/radar';
import { DAY_MS, MINUTE, addWorkdays, nextWindowStart } from '../lib/radar-schedule';
import type { GmailMessage } from '../lib/gmail';
import { saveRadarConfig } from '../services/radar-config-service';
import { createTemplate } from '../services/radar-template-service';
import { approveSends, enqueueProspects } from '../services/radar-queue-service';
import { runSender } from '../services/radar-sender-service';
import { decideReply, pollInboxes, processReplies, reviewReplies, sweepSequences } from '../services/radar-inbox-service';
import { pushReplyToBos } from '../services/radar-bos-service';
import { deleteTestCustomers } from './identity-test-cleanup';
import { gmailMessage, withEnv } from './radar-test-helpers';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const FR = DEFAULT_RADAR_CONFIG.countries.FR;

test('radar replies: matched, screened, analysed, pushed into the customer center once; follow-ups stop; sequences end', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  const v = tag.slice(0, 4).toUpperCase(), codes = [1, 2, 3].map(step => `FR-${step}-${v}`);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true, radarPausedAt: true, radarLaunchedAt: true, leadAssignMode: true } });
  // Launched a month ago: past the two weeks in which every valid reply is reviewed.
  await db.setting.update({ where: { id: 'system' }, data: { radarPausedAt: null, radarLaunchedAt: new Date(Date.now() - 30 * DAY_MS), leadAssignMode: 'POOL' } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const boss = actorOf(admin);
  const otherBoxes = await db.radarMailbox.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  await db.radarMailbox.updateMany({ where: { id: { in: otherBoxes.map(b => b.id) } }, data: { status: 'PAUSED' } });
  // Other mailboxes in the database are not read during this test.
  const polled = await db.radarMailbox.findMany({ select: { id: true, lastPolledAt: true } });
  await db.radarMailbox.updateMany({ where: { id: { in: polled.map(b => b.id) } }, data: { lastPolledAt: new Date(Date.now() + 365 * DAY_MS) } });
  const otherTemplates = await db.radarTemplate.findMany({ where: { status: { in: ['TESTING', 'WINNER'] } }, select: { id: true, status: true } });
  await db.radarTemplate.updateMany({ where: { id: { in: otherTemplates.map(x => x.id) } }, data: { status: 'RETIRED' } });
  const customers: string[] = [];
  const address = `jason-${tag}@lvanju-mail.com`;
  const mailbox = await db.radarMailbox.create({ data: { address, domain: 'lvanju-mail.com', fromName: 'Jason', signature: 'Jason · LVANJU', credential: sealSecret(`refresh-${tag}`),
    warmupStartedAt: new Date(Date.now() - 60 * DAY_MS), capLevel: 5, historyId: '1000' } });
  const now0 = new Date(nextWindowStart(new Date(Date.now() + 2 * DAY_MS), FR, 'Europe/Paris')!.getTime() + 60 * MINUTE);
  const prospect = (key: string, emails: string[], data: Record<string, unknown> = {}) => db.radarProspect.create({ data: {
    placeKey: `${key}-${tag}`, name: `${key} ${tag}`, nameCityKey: `${key} ${tag}|lyon`, country: 'FR', city: 'Lyon', timezone: 'Europe/Paris', domain: `${key}-${tag}.fr`,
    grade: 'A', score: 80, scoredAt: new Date(), status: 'NEW', customerType: 'WHOLESALER', mainProducts: '沙发', website: `https://${key}-${tag}.fr`, phone: '', ...data,
    emails: { create: emails.map(a => ({ address: a, kind: 'DIRECT', verifyStatus: 'VALID', verifiedAt: new Date(), verifyAttempts: 1 })) },
  } });

  // ── Gmail and DeepSeek, mocked ──
  const inbox = new Map<string, GmailMessage>();
  let pending: string[] = [];
  let counter = 0, deepSeekCalls = 0;
  const deepSeek = (text: string) => {
    deepSeekCalls++;
    const base = { valid: false, confidence: 0.95, intent: 'LOW', extracted: {}, returnDate: null, complaint: false };
    if (/50 canapés/i.test(text)) return { ...base, category: 'QUOTE', valid: true, intent: 'HIGH', summary: '问 50 套沙发的批发价和运费', extracted: { contactName: 'Marie Dupont', products: '布艺沙发', quantity: '50 套', phone: `+33 6 ${tag.replace(/\D/g, '').padEnd(8, '7').slice(0, 8)}` } };
    if (/prix|price/i.test(text)) return { ...base, category: 'QUOTE', valid: true, intent: 'HIGH', summary: '问价格' };
    if (/pas intéressé/i.test(text)) return { ...base, category: 'NOT_INTERESTED', summary: '不需要' };
    if (/\bstop\b/i.test(text)) return { ...base, category: 'UNSUBSCRIBE', summary: '要求不再联系' };
    if (/spam/i.test(text)) return { ...base, category: 'UNRELATED', summary: '投诉垃圾邮件', complaint: true };
    if (/catalogue/i.test(text)) return { ...base, category: 'INTERESTED', valid: true, confidence: 0.6, summary: '可能想要目录' };
    return { ...base, category: 'UNCLEAR', confidence: 0.3, summary: '看不懂' };
  };
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access', expires_in: 3600 });
    if (url.endsWith('/messages/send')) { counter++; return Response.json({ id: `g${tag}${counter}`, threadId: `t${tag}${counter}` }); }
    if (url.includes(`/messages/g${tag}`)) return Response.json({ id: 'x', threadId: 'x', payload: { headers: [{ name: 'Message-ID', value: `<m${tag}${counter}@mail.gmail.com>` }] } });
    if (url.includes('/history?')) { const ids = pending; pending = []; return Response.json({ history: ids.map(id => ({ messagesAdded: [{ message: { id } }] })), historyId: String(1000 + inbox.size) }); }
    const get = /\/messages\/([^/?]+)\?format=full/.exec(url);
    if (get && inbox.has(get[1])) return Response.json(inbox.get(get[1]));
    if (url === 'https://deepseek.test/chat/completions') {
      const context = JSON.parse(JSON.parse(String(init?.body)).messages[1].content) as { reply: { text: string } };
      return Response.json({ choices: [{ message: { content: JSON.stringify(deepSeek(context.reply.text)) } }] });
    }
    return new Response(`unexpected ${url}`, { status: 500 });
  });
  const deliverMail = (m: Parameters<typeof gmailMessage>[0]) => { inbox.set(m.id, gmailMessage(m)); pending.push(m.id); };
  let clock = now0.getTime();
  const tick = (minutes = 6) => new Date(clock += minutes * MINUTE);
  const env = { RADAR_SEND_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's', DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'https://deepseek.test' };

  try {
    await saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, catalogUrls: { fr: 'https://www.lvanju.com/fr/catalogue', en: '' } }, boss);
    await createTemplate({ code: codes[0], subject: 'Canapés pour {公司名}', body: '{称呼}\n\nVendez-vous des canapés ?' }, boss);
    await createTemplate({ code: codes[1], body: '{称呼}\n\nPetit rappel : notre catalogue {目录链接}' }, boss);
    await createTemplate({ code: codes[2], body: '{称呼}\n\nJe ne vous dérange plus. WhatsApp : +86 138 0000 0000' }, boss);

    await withEnv(env, async () => {
      // Six companies, each sent its first mail through the real sender (one per mailbox slot).
      const keys = ['quote', 'bounce', 'away', 'nope', 'stop', 'unsure'];
      const ps: Record<string, Awaited<ReturnType<typeof prospect>>> = Object.fromEntries(await Promise.all(keys.map(async k => [k, await prospect(k, k === 'bounce' ? [`achat@${k}-${tag}.fr`, `contact@${k}-${tag}.fr`] : [`achat@${k}-${tag}.fr`])])));
      await enqueueProspects({ ids: Object.values(ps).map(p => p.id) }, boss);
      await approveSends({ ids: (await db.radarSend.findMany({ where: { prospectId: { in: Object.values(ps).map(p => p.id) } } })).map(s => s.id) }, boss);
      for (let i = 0; i < keys.length; i++) assert.equal((await runSender(tick(16))).sent, 1);
      const first = async (key: string) => db.radarSend.findFirstOrThrow({ where: { prospectId: ps[key].id, step: 1, status: 'SENT' } });

      // ── Every first mail queued its follow-up, due 3 working days later in Paris, in the same thread ──
      const sentQuote = await first('quote');
      const followUp = await db.radarSend.findFirstOrThrow({ where: { sequenceId: sentQuote.sequenceId, step: 2 } });
      assert.deepEqual([followUp.status, followUp.templateCode, followUp.subject], ['QUEUED', codes[1], `Re: Canapés pour quote ${tag}`]);
      assert.equal(followUp.dueAt.toISOString(), addWorkdays(sentQuote.sentAt!, 3, FR, 'Europe/Paris').toISOString());
      assert.match(followUp.body, /notre catalogue https:\/\/www\.lvanju\.com\/fr\/catalogue/);

      // ── Replies arrive ──
      const reply = (key: string, id: string, extra: Partial<Parameters<typeof gmailMessage>[0]>) => deliverMail({ id: `${id}${tag}`, threadId: '', from: `achat@${key}-${tag}.fr`, subject: 'Re: Canapés', ...extra });
      const sent = await Promise.all(keys.map(first));
      const byKey = Object.fromEntries(keys.map((k, i) => [k, sent[i]]));
      reply('quote', 'q', { threadId: byKey.quote.threadId!, text: 'Bonjour,\nQuel est votre prix pour 50 canapés ?\n\nLe mer. 28 oct. 2026 à 10:00, Jason a écrit :\n> Vendez-vous des canapés ?' });
      deliverMail({ id: `b${tag}`, threadId: byKey.bounce.threadId!, from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)',
        text: '550 5.1.1 The email account that you tried to reach does not exist.', report: `Final-Recipient: rfc822; achat@bounce-${tag}.fr\nStatus: 5.1.1` });
      reply('away', 'a', { threadId: 'other-thread', text: "Je suis absent jusqu'au 9 novembre.", subject: 'Réponse automatique : Canapés', headers: { 'In-Reply-To': byKey.away.messageId! } });
      reply('nope', 'n', { text: 'Merci, pas intéressé.' });
      deliverMail({ id: `s${tag}`, threadId: '', from: `boss@stop-${tag}.fr`, subject: 'Re: Canapés', text: 'STOP' });
      reply('unsure', 'u', { threadId: byKey.unsure.threadId!, text: 'Envoyez le catalogue peut-être' });
      deliverMail({ id: `x${tag}`, threadId: 'nothing', from: 'newsletter@random-site.com', subject: 'Promo', text: 'Buy now' });

      // A reply not handled yet holds its company: its follow-up never leaves before we know what it said.
      const read = await pollInboxes(tick());
      assert.deepEqual([read.mailboxes, read.stored, read.failed], [1, 6, 0], 'the newsletter matches no company and is not stored');
      assert.equal(await db.radarReply.count({ where: { providerMessageId: `x${tag}` } }), 0);
      await db.radarSend.update({ where: { id: followUp.id }, data: { dueAt: new Date(clock - DAY_MS) } });
      assert.equal((await runSender(tick(16))).sent, 0, 'the quote company replied: its follow-up waits');
      const matched = await db.radarReply.findMany({ where: { mailboxId: mailbox.id, prospectId: { in: Object.values(ps).map(p => p.id) } } });
      assert.deepEqual(Object.fromEntries(matched.map(r => [r.providerMessageId.replace(tag, ''), [r.matchedBy, r.screen]])), {
        q: ['THREAD', 'NONE'], b: ['THREAD', 'HARD_BOUNCE'], a: ['HEADER', 'AUTO_REPLY'], n: ['ADDRESS', 'NONE'], s: ['DOMAIN', 'NONE'], u: ['THREAD', 'NONE'] });
      assert.equal(matched.find(r => r.providerMessageId === `q${tag}`)?.text, 'Bonjour,\nQuel est votre prix pour 50 canapés ?', 'the quoted original is cut');

      const handled = await processReplies(20, tick());
      assert.equal(handled.processed, 6);
      assert.equal(deepSeekCalls, 4, 'bounces and auto-replies are handled by rules, without the AI');

      // ── The valid reply is a new customer: 主动开发, 已回复, inquiry date = reply date, assigned like every lead ──
      const q = await db.radarReply.findFirstOrThrow({ where: { providerMessageId: `q${tag}` } });
      assert.deepEqual([q.category, q.valid, q.reviewStatus, q.pushStatus, q.intent], ['QUOTE', true, 'NONE', 'PUSHED', 'HIGH']);
      const customer = await db.customer.findUniqueOrThrow({ where: { id: q.customerId! }, include: { followUps: true, stageHistory: true, leadAlerts: true } });
      customers.push(customer.id);
      assert.deepEqual([customer.name, customer.companyName, customer.source, customer.stage, customer.isQualified, customer.countryCode, customer.country, customer.purchaseType, customer.quantity, customer.language],
        ['Marie Dupont', `quote ${tag}`, 'OUTBOUND', 'REPLIED', true, 'FR', '法国', 'WHOLESALE', 50, 'fr']);
      assert.equal(customer.sourceDetail, `客户雷达 · 开发信 · ${codes[0]} · 第 1 封`);
      assert.equal(customer.email, `achat@quote-${tag}.fr`);
      assert.equal(customer.inquiryAt?.toISOString(), q.receivedAt.toISOString());
      assert.equal(customer.pendingAssignment, true, 'the pool, as set');
      assert.match(customer.notes, /摘要：问 50 套沙发的批发价和运费[\s\S]*原文：\nBonjour,\nQuel est votre prix pour 50 canapés \?[\s\S]*在邮箱中打开回复：https:\/\/mail\.google\.com\/mail\/u\//);
      assert.equal(customer.followUps.length, 1);
      assert.equal(customer.followUps[0].type, 'EMAIL');
      assert.ok(customer.followUps[0].content.length <= 191);
      assert.deepEqual(customer.stageHistory.map(h => h.toStage), ['REPLIED']);
      assert.ok(customer.leadAlerts.some(a => a.kind === 'NEW'));
      assert.deepEqual(await db.radarProspect.findUniqueOrThrow({ where: { id: ps.quote.id }, select: { status: true, customerId: true } }), { status: 'IN_BOS', customerId: customer.id });
      assert.deepEqual(await db.radarSend.findUniqueOrThrow({ where: { id: followUp.id }, select: { status: true, cancelReason: true } }), { status: 'CANCELLED', cancelReason: 'REPLIED' });
      assert.equal((await db.radarSequence.findUniqueOrThrow({ where: { id: sentQuote.sequenceId } })).status, 'REPLIED');
      assert.deepEqual(await pushReplyToBos(q.id), { status: 'ALREADY', customerId: customer.id }, 'one reply, one customer');
      assert.equal(await db.customer.count({ where: { companyName: `quote ${tag}` } }), 1);

      // ── Hard bounce: address blocked, the company moves to its next address from the first mail ──
      assert.equal((await db.radarSend.findUniqueOrThrow({ where: { id: byKey.bounce.id } })).status, 'BOUNCED');
      assert.ok((await db.radarEmail.findFirstOrThrow({ where: { address: `achat@bounce-${tag}.fr` } })).bouncedAt);
      const restarted = await db.radarSend.findFirstOrThrow({ where: { prospectId: ps.bounce.id, toAddress: `contact@bounce-${tag}.fr` } });
      assert.deepEqual([restarted.step, restarted.status], [1, 'QUEUED']);
      assert.equal((await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).status, 'ACTIVE', 'one bounce is under the line');

      // ── Out of office: paused until two working days after 9 November ──
      const away = await db.radarSequence.findUniqueOrThrow({ where: { id: byKey.away.sequenceId } });
      const back = addWorkdays(new Date('2026-11-09T11:00:00Z'), 2, FR, 'Europe/Paris');
      assert.equal(away.status, 'PAUSED');
      assert.equal(away.resumeAt?.toISOString(), back.toISOString());
      assert.equal((await db.radarSend.findFirstOrThrow({ where: { sequenceId: away.id, step: 2 } })).dueAt.toISOString(), back.toISOString());

      // ── Not interested, unsubscribe ──
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: ps.nope.id } })).status, 'NOT_INTERESTED');
      const rest = await db.radarSuppression.findUniqueOrThrow({ where: { scope_value_reason: { scope: 'DOMAIN', value: `nope-${tag}.fr`, reason: 'NOT_INTERESTED' } } });
      assert.ok(Math.abs(rest.expiresAt!.getTime() - (Date.now() + 180 * DAY_MS)) < 60_000, '180 days');
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: ps.stop.id } })).status, 'UNSUBSCRIBED');
      assert.equal((await db.radarSuppression.findUniqueOrThrow({ where: { scope_value_reason: { scope: 'EMAIL', value: `boss@stop-${tag}.fr`, reason: 'UNSUBSCRIBE' } } })).expiresAt, null);
      assert.ok(await db.radarSuppression.findUnique({ where: { scope_value_reason: { scope: 'EMAIL', value: `achat@stop-${tag}.fr`, reason: 'UNSUBSCRIBE' } } }), 'the address we wrote to as well');

      // ── Unsure (60%): a person decides; 有效 pushes it ──
      const pendingReview = await reviewReplies(boss);
      const unsure = pendingReview.find(r => r.prospect.id === ps.unsure.id)!;
      assert.deepEqual([unsure.category, unsure.confidence], ['INTERESTED', 0.6]);
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: ps.unsure.id } })).status, 'REVIEW');
      assert.equal((await db.radarSequence.findUniqueOrThrow({ where: { id: byKey.unsure.sequenceId } })).status, 'REPLIED', 'a reply stops the sequence even while it waits for review');
      await assert.rejects(decideReply(unsure.id, { verdict: 'INVALID' }, boss), /请选择无效回复的分类/);
      await decideReply(unsure.id, { verdict: 'VALID' }, boss);
      const decided = await db.radarReply.findUniqueOrThrow({ where: { id: unsure.id } });
      assert.deepEqual([decided.reviewStatus, decided.pushStatus, decided.category], ['CONFIRMED', 'PUSHED', 'INTERESTED']);
      customers.push(decided.customerId!);
      await assert.rejects(decideReply(unsure.id, { verdict: 'VALID' }, boss), (e: { status?: number }) => e.status === 409);

      // ── A later mail in the thread of a company already pushed: straight under the customer, no AI ──
      const calls = deepSeekCalls;
      deliverMail({ id: `q2${tag}`, threadId: byKey.quote.threadId!, from: `achat@quote-${tag}.fr`, subject: 'Re: Canapés', text: 'Et le délai de livraison ?' });
      await pollInboxes(tick());
      await processReplies(20, tick());
      assert.equal(deepSeekCalls, calls);
      const later = await db.radarReply.findFirstOrThrow({ where: { providerMessageId: `q2${tag}` } });
      assert.deepEqual([later.pushStatus, later.customerId], ['ATTACHED', customer.id]);
      const after = await db.customer.findUniqueOrThrow({ where: { id: customer.id }, include: { followUps: true, leadAlerts: true } });
      assert.equal(after.followUps.length, 2);
      assert.ok(after.leadAlerts.some(a => a.kind === 'EMAIL_REPLY'));

      // ── A company that is already a customer by domain: the reply goes under that customer ──
      const known = await db.customer.create({ data: { name: `Known ${tag}`, ownerId: admin.id, email: `owner@known-${tag}.fr`, emailNormalized: `owner@known-${tag}.fr`, contactKeysAt: new Date() } });
      customers.push(known.id);
      const pk = await prospect('known', [`achat@known-${tag}.fr`]);
      const seq = await db.radarSequence.create({ data: { prospectId: pk.id, emailId: (await db.radarEmail.findFirstOrThrow({ where: { prospectId: pk.id } })).id, language: 'fr', activeDomain: `known-${tag}.fr`, enqueuedById: admin.id, mailboxId: mailbox.id, threadId: `tk${tag}` } });
      await db.radarSend.create({ data: { sequenceId: seq.id, step: 1, prospectId: pk.id, emailId: seq.emailId, toAddress: `achat@known-${tag}.fr`, subject: 'Canapés', body: 'x', status: 'SENT', sentAt: new Date(), dueAt: new Date(), mailboxId: mailbox.id, threadId: `tk${tag}`, templateCode: codes[0] } });
      deliverMail({ id: `k${tag}`, threadId: `tk${tag}`, from: `achat@known-${tag}.fr`, subject: 'Re: Canapés', text: 'Votre prix pour 20 canapés ?' });
      await pollInboxes(tick());
      await processReplies(20, tick());
      const kr = await db.radarReply.findFirstOrThrow({ where: { providerMessageId: `k${tag}` } });
      assert.deepEqual([kr.pushStatus, kr.customerId], ['PUSHED', known.id], 'no second customer for the same company');
      assert.match((await db.customer.findUniqueOrThrow({ where: { id: known.id } })).notes, /开发信回复/);

      // ── A complaint pauses the mailbox it came to ──
      const pc = await prospect('angry', [`achat@angry-${tag}.fr`]);
      const seqC = await db.radarSequence.create({ data: { prospectId: pc.id, emailId: (await db.radarEmail.findFirstOrThrow({ where: { prospectId: pc.id } })).id, language: 'fr', activeDomain: `angry-${tag}.fr`, enqueuedById: admin.id, mailboxId: mailbox.id, threadId: `tc${tag}` } });
      await db.radarSend.create({ data: { sequenceId: seqC.id, step: 1, prospectId: pc.id, emailId: seqC.emailId, toAddress: `achat@angry-${tag}.fr`, subject: 'Canapés', body: 'x', status: 'SENT', sentAt: new Date(), dueAt: new Date(), mailboxId: mailbox.id, threadId: `tc${tag}` } });
      deliverMail({ id: `c${tag}`, threadId: `tc${tag}`, from: `achat@angry-${tag}.fr`, subject: 'Re: Canapés', text: 'This is spam, I will report you.' });
      await pollInboxes(tick());
      await processReplies(20, tick());
      const paused = await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
      assert.deepEqual([paused.status, paused.pausedReason.startsWith('收到投诉')], ['PAUSED', true]);
      await db.radarMailbox.update({ where: { id: mailbox.id }, data: { status: 'ACTIVE', pausedReason: '' } });

      // ── Without DeepSeek, a reply waits for a person ──
      await withEnv({ DEEPSEEK_API_KEY: '' }, async () => {
        const pn = await prospect('noai', [`achat@noai-${tag}.fr`]);
        const seqN = await db.radarSequence.create({ data: { prospectId: pn.id, emailId: (await db.radarEmail.findFirstOrThrow({ where: { prospectId: pn.id } })).id, language: 'fr', activeDomain: `noai-${tag}.fr`, enqueuedById: admin.id, mailboxId: mailbox.id, threadId: `tn${tag}` } });
        await db.radarSend.create({ data: { sequenceId: seqN.id, step: 1, prospectId: pn.id, emailId: seqN.emailId, toAddress: `achat@noai-${tag}.fr`, subject: 'Canapés', body: 'x', status: 'SENT', sentAt: new Date(), dueAt: new Date(), mailboxId: mailbox.id, threadId: `tn${tag}` } });
        deliverMail({ id: `na${tag}`, threadId: `tn${tag}`, from: `achat@noai-${tag}.fr`, subject: 'Re', text: 'Votre prix ?' });
        await pollInboxes(tick());
        await processReplies(20, tick());
        assert.deepEqual(await db.radarReply.findFirstOrThrow({ where: { providerMessageId: `na${tag}` }, select: { category: true, reviewStatus: true, pushStatus: true } }), { category: 'UNCLEAR', reviewStatus: 'PENDING', pushStatus: 'NONE' });
      });

      // ── Time: the auto-reply pause ends; a sequence whose last mail went out a week ago ends without reply ──
      const sweep = await sweepSequences(new Date(back.getTime() + MINUTE));
      assert.ok(sweep.resumed >= 1);
      assert.equal((await db.radarSequence.findUniqueOrThrow({ where: { id: away.id } })).status, 'ACTIVE');
      const pe = await prospect('silent', [`achat@silent-${tag}.fr`], { status: 'IN_SEQUENCE' });
      const seqE = await db.radarSequence.create({ data: { prospectId: pe.id, emailId: (await db.radarEmail.findFirstOrThrow({ where: { prospectId: pe.id } })).id, language: 'fr', activeDomain: `silent-${tag}.fr`, enqueuedById: admin.id } });
      await db.radarSend.create({ data: { sequenceId: seqE.id, step: 3, prospectId: pe.id, emailId: seqE.emailId, toAddress: `achat@silent-${tag}.fr`, body: 'x', status: 'SENT', sentAt: new Date(Date.now() - 8 * DAY_MS), dueAt: new Date() } });
      assert.ok((await sweepSequences()).ended >= 1);
      assert.deepEqual(await db.radarSequence.findUniqueOrThrow({ where: { id: seqE.id }, select: { status: true, activeDomain: true } }), { status: 'ENDED', activeDomain: null });
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: pe.id } })).status, 'NO_REPLY');
      const cool = await db.radarSuppression.findUniqueOrThrow({ where: { scope_value_reason: { scope: 'DOMAIN', value: `silent-${tag}.fr`, reason: 'NO_REPLY' } } });
      assert.ok(Math.abs(cool.expiresAt!.getTime() - (Date.now() + 90 * DAY_MS)) < 60_000, '90 days');

      // Polling the same message again stores nothing new.
      pending.push(`q${tag}`);
      assert.equal((await pollInboxes(tick())).stored, 0);
    });
  } finally {
    const prospects = await db.radarProspect.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const ids = prospects.map(p => p.id);
    await db.radarReply.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarSend.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarSequence.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarProspect.deleteMany({ where: { id: { in: ids } } });
    await db.radarSuppression.deleteMany({ where: { value: { contains: tag } } });
    await db.radarMailbox.deleteMany({ where: { address: { contains: tag } } });
    await db.radarTemplate.deleteMany({ where: { code: { in: codes }, sends: { none: {} } } });
    await db.radarMailbox.updateMany({ where: { id: { in: otherBoxes.map(b => b.id) } }, data: { status: 'ACTIVE' } });
    for (const b of polled) await db.radarMailbox.updateMany({ where: { id: b.id }, data: { lastPolledAt: b.lastPolledAt } });
    for (const x of otherTemplates) await db.radarTemplate.updateMany({ where: { id: x.id }, data: { status: x.status } });
    await db.setting.update({ where: { id: 'system' }, data: { radarPausedAt: setting.radarPausedAt, radarLaunchedAt: setting.radarLaunchedAt, leadAssignMode: setting.leadAssignMode } });
    if (setting.radarConfig === null) await db.$executeRaw`UPDATE Setting SET radarConfig = NULL WHERE id = 'system'`;
    else await db.setting.update({ where: { id: 'system' }, data: { radarConfig: setting.radarConfig } });
    await db.leadAlert.deleteMany({ where: { customerId: { in: customers } } });
    await deleteTestCustomers({ where: { id: { in: customers } } });
  }
});
