import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { sealSecret } from '../lib/secret';
import { DEFAULT_RADAR_CONFIG } from '../lib/radar';
import { DAY_MS, MINUTE, localParts, nextWindowStart } from '../lib/radar-schedule';
import { saveRadarConfig } from '../services/radar-config-service';
import { createTemplate, updateTemplate } from '../services/radar-template-service';
import { approveSends, enqueueProspects, prepareOpenings, previewEnqueue, queueView, reviewSends, setSendingPaused, updateSend } from '../services/radar-queue-service';
import { runSender } from '../services/radar-sender-service';
import { connectMailbox, mailboxConnectUrl, updateMailbox } from '../services/radar-mailbox-service';
import { addSuppression, listSuppressions } from '../services/radar-suppression-service';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
const FR = DEFAULT_RADAR_CONFIG.countries.FR;
const decodeQp = (text: string) => Buffer.from(text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

test('radar sending: enqueue with checks, openings reviewed, one mail per mailbox slot, pre-send stop, failures, recovery', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  // Template codes unique to this run (FR-1-A1F3 / FR-1-B1F3): the codes are unique across the whole library.
  const v = tag.slice(0, 3).toUpperCase(), codeA = `FR-1-A${v}`, codeB = `FR-1-B${v}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true, radarPausedAt: true, radarLaunchedAt: true } });
  await db.setting.update({ where: { id: 'system' }, data: { radarPausedAt: null, radarLaunchedAt: null } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const sales = await db.user.create({ data: { name: `Radar send ${tag}`, email: `radar-send-${tag}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } });
  const boss = actorOf(admin), seller = actorOf(sales);
  const customers: string[] = [];
  // Another test file may have left mailboxes or templates; this test owns only rows carrying its tag.
  const otherBoxes = await db.radarMailbox.findMany({ where: { address: { not: { contains: tag } }, status: 'ACTIVE' }, select: { id: true } });
  await db.radarMailbox.updateMany({ where: { id: { in: otherBoxes.map(b => b.id) } }, data: { status: 'PAUSED' } });
  const otherTemplates = await db.radarTemplate.findMany({ where: { status: { in: ['TESTING', 'WINNER'] } }, select: { id: true, status: true } });
  await db.radarTemplate.updateMany({ where: { id: { in: otherTemplates.map(x => x.id) } }, data: { status: 'RETIRED' } });

  // A weekday morning in Paris, two days from now.
  const now = new Date(nextWindowStart(new Date(Date.now() + 2 * DAY_MS), FR, 'Europe/Paris')!.getTime() + 60 * MINUTE);
  const prospect = (key: string, data: Record<string, unknown>, emails: { address: string; kind?: string; verifyStatus?: string }[]) => db.radarProspect.create({ data: {
    placeKey: `${key}-${tag}`, name: `${key} ${tag}`, nameCityKey: `${key} ${tag}|lyon`, country: 'FR', city: 'Lyon', timezone: 'Europe/Paris', domain: `${key}-${tag}.fr`,
    grade: 'A', score: 80, scoredAt: new Date(), status: 'NEW', ...data,
    emails: { create: emails.map(e => ({ address: e.address, kind: e.kind ?? 'DIRECT', verifyStatus: e.verifyStatus ?? 'VALID', verifiedAt: new Date(), verifyAttempts: 1 })) },
  } });
  try {
    // ── Templates ──
    await saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, catalogUrls: { fr: '', en: '' } }, boss);
    const body = '{称呼}\n\n{个性化开头}\n\nNous fabriquons des canapés compressés pour des magasins comme {公司名}. Catalogue : {目录链接}\n\nVoulez-vous nos prix de gros ?';
    const a = await createTemplate({ code: codeA.toLowerCase(), subject: 'Canapés compressés pour {公司名}', body }, boss);
    await createTemplate({ code: codeB, subject: 'Canapés pour {城市}', body: '{称呼}\n\n{个性化开头}\n\nPetite question : vendez-vous des canapés ?' }, boss);
    await assert.rejects(createTemplate({ code: codeA, subject: 'x', body: 'y' }, boss), (e: { status?: number }) => e.status === 409);
    await assert.rejects(createTemplate({ code: 'FR-4-A', subject: 'x', body: 'y' }, boss), /语言-封次-版本/);
    await assert.rejects(createTemplate({ code: 'FR-1-C', subject: 'x', body: '{客户名}' }, boss), /不认识的变量/);
    await assert.rejects(createTemplate({ code: 'FR-1-C', subject: 'x', body: 'y' }, seller), (e: { status?: number }) => e.status === 403);

    // ── Mailbox: connect through Google (mocked), then the warm-up decides its cap ──
    await assert.rejects(withEnv({ GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '' }, () => mailboxConnectUrl(boss, {}, 'https://crm.test')), /GOOGLE_OAUTH_CLIENT_ID/);
    const address = `jason-${tag}@lvanju-mail.com`;
    const box = await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret', PUBLIC_APP_URL: '' }, async () => {
      const url = new URL(await mailboxConnectUrl(boss, { warmup: localParts(new Date(Date.now() - 40 * DAY_MS), 'Asia/Shanghai').day }, 'https://crm.test'));
      assert.equal(url.searchParams.get('redirect_uri'), 'https://crm.test/api/radar/mailboxes/callback');
      assert.match(url.searchParams.get('scope') ?? '', /gmail\.send.*gmail\.readonly/);
      const state = url.searchParams.get('state')!;
      await assert.rejects(connectMailbox(boss, { code: 'c', state: state.replace(/.$/, c => c === 'A' ? 'B' : 'A') }, 'https://crm.test'), /授权已过期或不是本人发起/);
      await assert.rejects(connectMailbox(seller, { code: 'c', state }, 'https://crm.test'), (e: { status?: number }) => e.status === 403);
      const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') { assert.match(String(init?.body), /grant_type=authorization_code/); return Response.json({ access_token: 'access-1', refresh_token: `refresh-${tag}`, expires_in: 3600 }); }
        if (url.endsWith('/users/me/profile')) return Response.json({ emailAddress: address.toUpperCase(), historyId: '100' });
        return new Response('unexpected', { status: 500 });
      });
      const connected = await connectMailbox(boss, { code: 'code-1', state }, 'https://crm.test');
      mock.mock.restore();
      return connected;
    });
    assert.deepEqual(box, { address, created: true });
    const mailbox = await db.radarMailbox.findUniqueOrThrow({ where: { address } });
    assert.notEqual(mailbox.credential, `refresh-${tag}`, 'the token is stored sealed');
    assert.equal(mailbox.capLevel, 5, 'warming up for 40 days: the last level');
    await updateMailbox(mailbox.id, { fromName: 'Jason', signature: 'Jason · LVANJU\nwww.lvanju.com' }, boss);

    // ── Prospects ──
    const facts = [{ fact: '里昂有 3 家门店', quote: 'Nos 3 magasins à Lyon' }];
    const pA = await prospect('alpha', { score: 90, siteFacts: facts }, [{ address: `achat@alpha-${tag}.fr` }, { address: `contact@alpha-${tag}.fr`, kind: 'GENERIC' }]);
    const pB = await prospect('beta', { grade: 'B', score: 60 }, [{ address: `info@beta-${tag}.fr`, kind: 'GENERIC', verifyStatus: 'RISKY' }]);
    const pC = await prospect('gamma', { grade: 'C', score: 40 }, [{ address: `info@gamma-${tag}.fr` }]);
    const pU = await prospect('delta', {}, [{ address: `info@delta-${tag}.fr`, verifyStatus: '' }]);
    const pS = await prospect('epsilon', {}, [{ address: `info@epsilon-${tag}.fr` }]);
    const pK = await prospect('kappa', {}, [{ address: `buyer@kappa-${tag}.fr` }]);
    await addSuppression({ value: `https://www.epsilon-${tag}.fr/` }, boss);
    assert.ok((await listSuppressions(boss, { q: `epsilon-${tag}` })).some(s => s.scope === 'DOMAIN' && s.active));
    const customer = await db.customer.create({ data: { name: `Kappa ${tag}`, ownerId: admin.id, email: `buyer@kappa-${tag}.fr`, emailNormalized: `buyer@kappa-${tag}.fr`, contactKeysAt: new Date() } });
    customers.push(customer.id);
    const ids = [pA.id, pB.id, pC.id, pU.id, pS.id, pK.id];

    let preview = await previewEnqueue({ ids }, boss);
    assert.deepEqual(preview.skipped.find(s => s.reason === 'NO_CATALOG')?.count, 4, 'version A uses {目录链接}: fill it in first');
    await saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, catalogUrls: { fr: 'https://www.lvanju.com/fr/catalogue', en: '' } }, boss);
    preview = await previewEnqueue({ ids }, boss);
    assert.equal(preview.selected, 6);
    assert.equal(preview.ready, 2);
    assert.deepEqual(Object.fromEntries(preview.skipped.map(s => [s.reason, s.count])), { C_GRADE: 1, NOT_VERIFIED: 1, SUPPRESSED: 1, IN_BOS: 1 });
    assert.deepEqual(preview.languages, { fr: 2, en: 0 });
    assert.deepEqual(preview.review, { forced: true, default: true, aiAlways: true }, 'nothing sent yet: the first two weeks have not started');
    assert.equal(preview.mailboxes, 1);
    assert.equal(preview.dailyCapacity, 40);
    assert.ok(preview.estimate && new Date(preview.estimate.finishAt) >= new Date(Date.now() - MINUTE));
    await assert.rejects(previewEnqueue({}, boss), /请先选择客户/);
    await assert.rejects(previewEnqueue({ ids }, seller), (e: { status?: number }) => e.status === 403);

    // ── Enqueue: the AI opening waits; whole first mails are reviewed in the first two weeks ──
    const deepSeek = 'Vos 3 magasins à Lyon mettent en avant les canapés.';
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      if (String(input) === 'https://deepseek.test/chat/completions') return Response.json({ choices: [{ message: { content: JSON.stringify({ opening: deepSeek }) } }] });
      return new Response('unexpected', { status: 500 });
    });
    const queued = await withEnv({ DEEPSEEK_API_KEY: 'k', DEEPSEEK_BASE_URL: 'https://deepseek.test' }, async () => {
      const r = await enqueueProspects({ ids, review: false }, boss);
      await prepareOpenings(10);
      return r;
    });
    assert.equal(queued.queued, 2);
    assert.equal(queued.preparing, 1);
    assert.equal((await enqueueProspects({ ids: [pA.id] }, boss)).skipped[0].reason, 'IN_SEQUENCE', 'one running sequence per company');
    const sendA = await db.radarSend.findFirstOrThrow({ where: { prospectId: pA.id }, include: { sequence: true } });
    const sendB = await db.radarSend.findFirstOrThrow({ where: { prospectId: pB.id }, include: { sequence: true } });
    assert.deepEqual([sendA.templateCode, sendB.templateCode], [codeA, codeB], 'the two versions alternate');
    assert.deepEqual([sendA.status, sendA.openingSource, sendA.opening], ['REVIEW', 'AI', deepSeek]);
    assert.equal(sendA.subject, `Canapés compressés pour alpha ${tag}`);
    assert.match(sendA.body, /^Bonjour,\n\nVos 3 magasins à Lyon mettent en avant les canapés\.\n\nNous fabriquons .* Catalogue : https:\/\/www\.lvanju\.com\/fr\/catalogue/s);
    assert.deepEqual([sendB.status, sendB.openingSource, sendB.risky], ['REVIEW', 'NONE', true], 'strict period: reviewed although no AI wrote anything');
    assert.equal(sendB.body, 'Bonjour,\n\nPetite question : vendez-vous des canapés ?');
    assert.deepEqual([sendA.sequence.enqueuedById, sendA.sequence.activeDomain, sendA.sequence.needsReview], [admin.id, `alpha-${tag}.fr`, true], 'who clicked is recorded');
    assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: pA.id } })).status, 'QUEUED');
    assert.deepEqual((await reviewSends(boss)).filter(s => s.prospect.id === pA.id).map(s => s.prospect.facts[0]?.quote), ['Nos 3 magasins à Lyon']);

    // ── Nothing goes before approval, nor without RADAR_SEND_ENABLED, nor while paused ──
    const gmail: { url: string; body?: string }[] = [];
    let sendStatus = 200, tokenStatus = 200, messageCounter = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      gmail.push({ url, body: init?.body ? String(init.body) : undefined });
      if (url === 'https://oauth2.googleapis.com/token') return tokenStatus === 200 ? Response.json({ access_token: 'access-2', expires_in: 3600 }) : Response.json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, { status: 400 });
      if (url.endsWith('/messages/send')) {
        if (sendStatus === 503) return Response.json({ error: { code: 503, message: 'Backend Error', errors: [{ reason: 'backendError' }] } }, { status: 503 });
        if (sendStatus === 400) return Response.json({ error: { code: 400, message: 'Invalid To header', errors: [{ reason: 'invalidArgument' }] } }, { status: 400 });
        messageCounter++;
        return Response.json({ id: `g${messageCounter}`, threadId: `t${messageCounter}` });
      }
      if (url.includes('/messages/g')) return Response.json({ id: 'x', threadId: 'x', payload: { headers: [{ name: 'Message-ID', value: `<m${messageCounter}@mail.gmail.com>` }] } });
      return new Response('unexpected', { status: 500 });
    });
    const sends = () => gmail.filter(g => g.url.endsWith('/messages/send'));
    await withEnv({ RADAR_SEND_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' }, async () => {
      assert.equal((await runSender(now)).sent, 0, 'both mails are still in review');
      await updateSend(sendA.id, { action: 'edit', opening: 'Vos magasins de Lyon proposent canapés et literie.' }, boss);
      const edited = await db.radarSend.findUniqueOrThrow({ where: { id: sendA.id } });
      assert.deepEqual([edited.openingSource, edited.edited], ['HUMAN', false]);
      assert.match(edited.body, /^Bonjour,\n\nVos magasins de Lyon proposent canapés et literie\.\n\nNous/, 'the body follows the edited opening');
      assert.deepEqual(await approveSends({ ids: [sendA.id, sendB.id] }, boss), { approved: 2, skipped: 0 });
    });
    assert.equal((await withEnv({ RADAR_SEND_ENABLED: '' }, () => runSender(now))).skipped, 'DISABLED');
    await setSendingPaused({ paused: true }, boss);
    assert.equal((await withEnv({ RADAR_SEND_ENABLED: 'true' }, () => runSender(now))).skipped, 'PAUSED');
    await setSendingPaused({ paused: false }, boss);
    assert.equal(sends().length, 0);

    await withEnv({ RADAR_SEND_ENABLED: 'true', GOOGLE_OAUTH_CLIENT_ID: 'client-id', GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret' }, async () => {
      // ── Outside the recipient's hours: nothing ──
      const saturday = fromZonedTime(`${localParts(new Date(now.getTime() + ((6 - localParts(now, 'Europe/Paris').weekday + 7) % 7) * DAY_MS), 'Europe/Paris').day}T11:00:00`, 'Europe/Paris');
      assert.equal((await runSender(saturday)).sent, 0, 'Saturday in Paris');

      // ── First run: the A prospect goes first; one mail for the one mailbox ──
      const first = await runSender(now, () => 0);
      assert.equal(first.sent, 1);
      const sentA = await db.radarSend.findUniqueOrThrow({ where: { id: sendA.id }, include: { sequence: true, template: true } });
      assert.deepEqual([sentA.status, sentA.providerMessageId, sentA.threadId, sentA.messageId, sentA.mailboxId], ['SENT', 'g1', 't1', '<m1@mail.gmail.com>', mailbox.id]);
      assert.deepEqual([sentA.sequence.mailboxId, sentA.sequence.threadId, sentA.sequence.messageIds], [mailbox.id, 't1', ['<m1@mail.gmail.com>']]);
      assert.ok(sentA.template?.firstSentAt, 'the template is locked now');
      await assert.rejects(updateTemplate(a.id, { body: 'changed' }, boss), /已发出过，内容已锁定/);
      await updateTemplate(a.id, { versionNote: '首版' }, boss);
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: pA.id } })).status, 'IN_SEQUENCE');
      assert.ok((await db.setting.findUniqueOrThrow({ where: { id: 'system' } })).radarLaunchedAt, 'the two-week review clock starts with the first mail');
      const box1 = await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
      assert.equal(box1.nextSendAt?.getTime(), now.getTime() + 6 * MINUTE, 'the gap starts');
      const mime = Buffer.from(JSON.parse(sends()[0].body!).raw, 'base64url').toString('utf8');
      assert.match(mime, new RegExp(`^From: "Jason" <${address}>\\r\\nTo: <achat@alpha-${tag}\\.fr>\\r\\n`));
      assert.doesNotMatch(mime, /In-Reply-To/);
      const text = decodeQp(mime.split('\r\n\r\n').slice(1).join('\r\n\r\n'));
      assert.match(text, /Vos magasins de Lyon proposent canapés et literie\.[\s\S]*Jason · LVANJU\r\nwww\.lvanju\.com\r\n\r\nSi vous ne souhaitez plus recevoir nos e-mails, répondez simplement « stop »\./);

      // ── The same minute again: the mailbox's gap has not passed ──
      assert.equal((await runSender(now)).sent, 0);

      // ── Before B's slot it becomes a customer: cancelled, not counted, the company is excluded ──
      const later = new Date(now.getTime() + 20 * MINUTE);
      const bosB = await db.customer.create({ data: { name: `Beta ${tag}`, ownerId: admin.id, email: `buyer@beta-${tag}.fr`, emailNormalized: `buyer@beta-${tag}.fr`, contactKeysAt: new Date() } });
      customers.push(bosB.id);
      const stopped = await runSender(later);
      assert.deepEqual([stopped.sent, stopped.cancelled], [0, 1]);
      assert.deepEqual(await db.radarSend.findUniqueOrThrow({ where: { id: sendB.id }, select: { status: true, cancelReason: true } }), { status: 'CANCELLED', cancelReason: 'IN_BOS' });
      assert.deepEqual(await db.radarSequence.findUniqueOrThrow({ where: { id: sendB.sequenceId }, select: { status: true, activeDomain: true } }), { status: 'STOPPED', activeDomain: null });
      assert.match((await db.radarProspect.findUniqueOrThrow({ where: { id: pB.id } })).excludedReason, /^已在 BOS/);
      assert.ok(await db.radarSuppression.findUnique({ where: { scope_value_reason: { scope: 'DOMAIN', value: `beta-${tag}.fr`, reason: 'CUSTOMER' } } }));
      assert.equal((await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).nextSendAt?.getTime(), later.getTime(), 'a cancelled mail does not use the slot');

      // ── Two runs at once never send one mail twice ──
      const pD = await prospect('omega', { score: 85 }, [{ address: `achat@omega-${tag}.fr` }, { address: `contact@omega-${tag}.fr`, kind: 'GENERIC' }]);
      await enqueueProspects({ ids: [pD.id] }, boss);
      const sendD = await db.radarSend.findFirstOrThrow({ where: { prospectId: pD.id } });
      await approveSends({ ids: [sendD.id] }, boss);
      const before = sends().length;
      const slot = new Date(later.getTime() + 20 * MINUTE);
      await Promise.all([runSender(slot), runSender(slot)]);
      assert.equal(sends().length - before, 1);
      assert.equal((await db.radarSend.findUniqueOrThrow({ where: { id: sendD.id } })).status, 'SENT');

      // ── A temporary Gmail error retries later; a permanent one blocks the address and moves to the next one ──
      const pE = await prospect('sigma', { score: 85 }, [{ address: `achat@sigma-${tag}.fr` }, { address: `contact@sigma-${tag}.fr`, kind: 'GENERIC' }]);
      await enqueueProspects({ ids: [pE.id] }, boss);
      const sendE = await db.radarSend.findFirstOrThrow({ where: { prospectId: pE.id } });
      await approveSends({ ids: [sendE.id] }, boss);
      sendStatus = 503;
      let at = new Date(slot.getTime() + 20 * MINUTE);
      assert.equal((await runSender(at)).retried, 1);
      const retried = await db.radarSend.findUniqueOrThrow({ where: { id: sendE.id } });
      assert.deepEqual([retried.status, retried.attempts, retried.mailboxId], ['QUEUED', 1, null]);
      assert.ok(retried.nextAttemptAt! > new Date(Date.now() + 4 * MINUTE), 'retry in about five minutes');
      assert.equal((await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } })).consecutiveFailures, 1);
      await db.radarSend.update({ where: { id: sendE.id }, data: { nextAttemptAt: null } });
      sendStatus = 400;
      at = new Date(at.getTime() + 20 * MINUTE);
      assert.equal((await runSender(at)).failed, 1);
      assert.deepEqual(await db.radarSend.findUniqueOrThrow({ where: { id: sendE.id }, select: { status: true } }), { status: 'FAILED' });
      assert.equal((await db.radarEmail.findFirstOrThrow({ where: { address: `achat@sigma-${tag}.fr` } })).verifyStatus, 'INVALID');
      assert.ok(await db.radarSuppression.findUnique({ where: { scope_value_reason: { scope: 'EMAIL', value: `achat@sigma-${tag}.fr`, reason: 'HARD_BOUNCE' } } }));
      const restarted = await db.radarSend.findFirstOrThrow({ where: { prospectId: pE.id, toAddress: `contact@sigma-${tag}.fr` }, include: { sequence: true } });
      assert.deepEqual([restarted.status, restarted.sequence.status, restarted.sequence.activeDomain, restarted.subject], ['QUEUED', 'ACTIVE', `sigma-${tag}.fr`, sendE.subject], 'approved words go to the next address');
      sendStatus = 200;
      at = new Date(at.getTime() + 20 * MINUTE);
      assert.equal((await runSender(at)).sent, 1);

      // ── An expired authorisation pauses the mailbox and puts the mail back ──
      const pF = await prospect('tau', { score: 70 }, [{ address: `achat@tau-${tag}.fr` }]);
      await enqueueProspects({ ids: [pF.id] }, boss);
      const sendF = await db.radarSend.findFirstOrThrow({ where: { prospectId: pF.id } });
      await approveSends({ ids: [sendF.id] }, boss);
      await db.radarMailbox.update({ where: { id: mailbox.id }, data: { credential: sealSecret(`refresh-revoked-${tag}`) } });
      tokenStatus = 400;
      at = new Date(at.getTime() + 20 * MINUTE);
      assert.equal((await runSender(at)).paused, 1);
      const paused = await db.radarMailbox.findUniqueOrThrow({ where: { id: mailbox.id } });
      assert.deepEqual([paused.status, paused.pausedReason.startsWith('授权失效')], ['PAUSED', true]);
      assert.deepEqual(await db.radarSend.findUniqueOrThrow({ where: { id: sendF.id }, select: { status: true } }), { status: 'QUEUED' });
      tokenStatus = 200;
      await updateMailbox(mailbox.id, { status: 'ACTIVE' }, boss);

      // ── A mail stuck in sending is never resent: a person checks the sent folder ──
      await db.radarSend.update({ where: { id: sendF.id }, data: { status: 'SENDING' } });
      await db.$executeRaw`UPDATE RadarSend SET updatedAt = ${new Date(Date.now() - 11 * MINUTE)} WHERE id = ${sendF.id}`;
      const recovered = await runSender(new Date(at.getTime() + 20 * MINUTE));
      assert.equal(recovered.recovered, 1);
      assert.equal((await db.radarSend.findUniqueOrThrow({ where: { id: sendF.id } })).status, 'UNKNOWN');
      await updateSend(sendF.id, { action: 'confirmNotSent' }, boss);
      assert.equal((await db.radarSend.findUniqueOrThrow({ where: { id: sendF.id } })).status, 'QUEUED');

      // ── Cancelling before anything went out puts the company back on the wall ──
      await updateSend(sendF.id, { action: 'cancel' }, boss);
      assert.deepEqual(await db.radarSequence.findUniqueOrThrow({ where: { id: sendF.sequenceId }, select: { status: true, activeDomain: true } }), { status: 'STOPPED', activeDomain: null });
      assert.equal((await db.radarProspect.findUniqueOrThrow({ where: { id: pF.id } })).status, 'NEW');
      await assert.rejects(updateSend(sendA.id, { action: 'cancel' }, boss), /已经发出/);
    });

    // ── Queue page ──
    const view = await queueView(boss, { view: 'SENT' });
    assert.ok(view.rows.some(r => r.id === sendA.id && r.status === 'SENT'));
    assert.equal(view.mailboxes.find(m => m.id === mailbox.id)?.cap, 40);
    assert.equal((await queueView(boss, { view: 'CANCELLED' })).rows.find(r => r.id === sendB.id)?.cancelLabel, '已在 BOS 跟进');
    await assert.rejects(queueView(seller), (e: { status?: number }) => e.status === 403);
  } finally {
    const prospects = await db.radarProspect.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    await db.radarSend.deleteMany({ where: { prospectId: { in: prospects.map(p => p.id) } } });
    await db.radarSequence.deleteMany({ where: { prospectId: { in: prospects.map(p => p.id) } } });
    await db.radarProspect.deleteMany({ where: { id: { in: prospects.map(p => p.id) } } });
    await db.radarSuppression.deleteMany({ where: { value: { contains: tag } } });
    await db.radarMailbox.deleteMany({ where: { address: { contains: tag } } });
    await db.radarTemplate.deleteMany({ where: { code: { in: [codeA, codeB] }, sends: { none: {} } } });
    await db.radarMailbox.updateMany({ where: { id: { in: otherBoxes.map(b => b.id) } }, data: { status: 'ACTIVE' } });
    for (const x of otherTemplates) await db.radarTemplate.updateMany({ where: { id: x.id }, data: { status: x.status } });
    await db.setting.update({ where: { id: 'system' }, data: { radarPausedAt: setting.radarPausedAt, radarLaunchedAt: setting.radarLaunchedAt } });
    if (setting.radarConfig === null) await db.$executeRaw`UPDATE Setting SET radarConfig = NULL WHERE id = 'system'`;
    else await db.setting.update({ where: { id: 'system' }, data: { radarConfig: setting.radarConfig } });
    await deleteTestCustomers({ where: { id: { in: customers } } });
    await db.user.delete({ where: { id: sales.id } });
  }
});
