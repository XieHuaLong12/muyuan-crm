import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { DEFAULT_RADAR_CONFIG } from '../lib/radar';
import { saveRadarConfig } from '../services/radar-config-service';
import { createTemplate } from '../services/radar-template-service';
import { sealSecret } from '../lib/secret';
import { checkPostmaster, deliverRadarDailySummary, radarStats, retentionCleanup, sampleReply } from '../services/radar-analytics-service';
import { updateProspect } from '../services/radar-prospect-service';
import { withEnv } from './radar-test-helpers';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const DAY = 24 * 3600_000;

test('radar stats: weekly measures, template versions compared, AI checks, daily summary, data retention and erasure', async () => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  const v = tag.slice(0, 3).toUpperCase(), codeA = `EN-1-A${v}`, codeB = `EN-1-B${v}`;
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const boss = actorOf(admin);
  const mailbox = await db.radarMailbox.create({ data: { address: `stats-${tag}@lvanju-mail.com`, domain: 'lvanju-mail.com', warmupStartedAt: new Date(Date.now() - 60 * DAY), capLevel: 5 } });
  const markers: string[] = [];
  try {
    await saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, minSample: 10 }, boss);
    const before = await radarStats(boss);
    const a = await createTemplate({ code: codeA, subject: 'Sofas', body: '{称呼}\n\nDo you sell sofas?' }, boss);
    const b = await createTemplate({ code: codeB, subject: 'Sofas', body: '{称呼}\n\nWould a catalogue help?' }, boss);

    // 30 companies this week: 12 with template A, 18 with B; one of A's bounced. A gets 6 replies (2 valid), B gets 1.
    const now = new Date();
    let n = 0;
    const company = async (template: { id: string; code: string }, outcome: 'none' | 'reply' | 'valid' | 'bounce' | 'auto') => {
      n++;
      const p = await db.radarProspect.create({ data: { placeKey: `s${n}-${tag}`, name: `Stats ${n} ${tag}`, nameCityKey: `stats ${n} ${tag}|dubai`, country: 'AE', city: 'Dubai', timezone: 'Asia/Dubai',
        grade: n % 3 ? 'A' : 'B', score: 70, status: 'IN_SEQUENCE', emails: { create: [{ address: `buyer@s${n}-${tag}.ae`, kind: 'DIRECT', verifyStatus: n % 5 ? 'VALID' : '' }] } }, include: { emails: true } });
      const seq = await db.radarSequence.create({ data: { prospectId: p.id, emailId: p.emails[0].id, language: 'en', enqueuedById: admin.id, mailboxId: mailbox.id } });
      const send = await db.radarSend.create({ data: { sequenceId: seq.id, step: 1, prospectId: p.id, emailId: p.emails[0].id, toAddress: p.emails[0].address, templateId: template.id, templateCode: template.code,
        subject: 'Sofas', body: 'x', status: outcome === 'bounce' ? 'BOUNCED' : 'SENT', sentAt: now, dueAt: now, mailboxId: mailbox.id } });
      if (outcome === 'reply' || outcome === 'valid' || outcome === 'auto') {
        await db.radarReply.create({ data: { mailboxId: mailbox.id, providerMessageId: `r${n}-${tag}`, prospectId: p.id, sequenceId: seq.id, sendId: send.id, matchedBy: 'THREAD',
          fromAddress: p.emails[0].address, receivedAt: now, rawText: '', text: outcome === 'valid' ? 'Price please' : 'Not now', screen: outcome === 'auto' ? 'AUTO_REPLY' : 'NONE',
          category: outcome === 'valid' ? 'QUOTE' : outcome === 'auto' ? 'AUTO_REPLY' : 'NOT_INTERESTED', aiCategory: outcome === 'auto' ? '' : outcome === 'valid' ? 'QUOTE' : 'NOT_INTERESTED',
          valid: outcome === 'valid', confidence: 0.9, analyzedAt: now, processedAt: now, complaint: n === 3 } });
      }
      return p;
    };
    type Step = readonly ['A' | 'B', Parameters<typeof company>[1]];
    const times = (count: number, step: Step) => Array.from({ length: count }, () => step);
    const plan: Step[] = [...times(2, ['A', 'valid']), ...times(4, ['A', 'reply']), ['A', 'bounce'], ['A', 'auto'], ...times(4, ['A', 'none']), ['B', 'reply'], ...times(17, ['B', 'none'])];
    const made = [];
    for (const [which, outcome] of plan) made.push(await company(which === 'A' ? a : b, outcome));

    const stats = await radarStats(boss);
    const week = stats.weeks[0], was = before.weeks[0];
    assert.equal(week.sent - was.sent, 30);
    assert.equal(week.bounced - was.bounced, 1);
    assert.equal(week.mailed - was.mailed, 29, 'the company whose only mail bounced is not counted');
    assert.equal(week.answered - was.answered, 7, 'auto-replies are not replies');
    assert.equal(week.valid - was.valid, 2);
    assert.equal(week.complaints - was.complaints, 1);
    assert.equal(week.found - was.found, 30);
    const group = stats.templates.find(g => g.rows.some(r => r.code === codeA))!;
    const rowA = group.rows.find(r => r.code === codeA)!, rowB = group.rows.find(r => r.code === codeB)!;
    assert.deepEqual([rowA.sent, rowA.bounced, rowA.replied, rowA.valid, rowA.replyRate], [11, 1, 6, 2, 54.5]);
    assert.deepEqual([rowB.sent, rowB.replied, rowB.replyRate], [18, 1, 5.6]);
    assert.equal(rowA.suggestion, 'WIN', 'A clearly answers more, both above the 10-mail threshold');
    assert.equal(rowB.suggestion, 'RETIRE');
    assert.ok(rowA.probability! > 0.99);

    // ── Weekly AI check ──
    const sample = stats.samples.find(s => s.prospect.endsWith(tag) && s.aiCategory === 'QUOTE')!;
    assert.ok(sample, 'valid ones are offered for checking');
    await sampleReply(sample.id, { verdict: 'CORRECT' }, boss);
    const wrong = stats.samples.find(s => s.prospect.endsWith(tag) && s.aiCategory === 'NOT_INTERESTED')!;
    await sampleReply(wrong.id, { verdict: 'WRONG' }, boss);
    const checked = (await radarStats(boss)).ai;
    assert.ok(checked.checked >= 2 && checked.accuracy !== null);
    await assert.rejects(sampleReply(sample.id, { verdict: 'MAYBE' }, boss), /判对了还是判错了/);

    // ── Daily summary: from 08:00 Beijing, once a day ──
    const tomorrow = new Date(Date.now() + DAY);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(tomorrow);
    markers.push(`radar-daily:${day}`);
    assert.deepEqual(await deliverRadarDailySummary(new Date(`${day}T07:30:00+08:00`)), { sent: false }, 'before 08:00');
    const summary = await deliverRadarDailySummary(new Date(`${day}T08:05:00+08:00`));
    assert.equal(summary.sent, true);
    assert.match(summary.body!, /^新入库 \d+ 家 · 发出 \d+ 封 · 回复 \d+ 封/);
    assert.deepEqual(await deliverRadarDailySummary(new Date(`${day}T09:00:00+08:00`)), { sent: false }, 'once a day');

    // ── Retention: a company that ended without reply 13 months ago is forgotten, its address stays blocked ──
    const old = made[10];
    await db.radarProspect.update({ where: { id: old.id }, data: { status: 'NO_REPLY', statusAt: new Date(Date.now() - 400 * DAY), siteText: 'about us', notes: 'note' } });
    assert.ok((await retentionCleanup()).erased >= 1);
    const erased = await db.radarProspect.findUniqueOrThrow({ where: { id: old.id }, include: { emails: true, sends: true } });
    assert.deepEqual([erased.siteText, erased.notes, erased.emails[0].address.startsWith('erased-'), erased.sends[0].toAddress], [null, '', true, 'erased@invalid']);
    assert.ok(await db.radarSuppression.findUnique({ where: { scope_value_reason: { scope: 'EMAIL', value: old.emails[0].address, reason: 'MANUAL' } } }));
    assert.equal((await retentionCleanup()).erased, 0, 'nothing left to erase');
    const noEmail = await db.radarProspect.create({ data: { placeKey: `ne-${tag}`, name: `No email ${tag}`, nameCityKey: `no email ${tag}|dubai`, country: 'AE', city: 'Dubai', timezone: 'Asia/Dubai',
      status: 'EXCLUDED', statusAt: new Date(Date.now() - 400 * DAY), siteText: 'about us', notes: 'called once' } });
    assert.equal((await retentionCleanup()).erased, 1, 'a company without any address is cleared too');
    assert.deepEqual(await db.radarProspect.findUniqueOrThrow({ where: { id: noEmail.id }, select: { siteText: true, notes: true } }), { siteText: null, notes: '' });

    // ── 对方要求删除数据 ──
    const asked = made[0];
    await updateProspect(asked.id, { action: 'erase' }, boss);
    const gone = await db.radarProspect.findUniqueOrThrow({ where: { id: asked.id }, include: { emails: true, replies: true, sequences: true } });
    assert.deepEqual([gone.status, gone.excludedReason, gone.emails[0].address.startsWith('erased-'), gone.replies[0].text, gone.sequences[0].status], ['UNSUBSCRIBED', '对方要求删除数据', true, '', 'STOPPED']);
    assert.ok(await db.radarSuppression.findUnique({ where: { scope_value_reason: { scope: 'EMAIL', value: asked.emails[0].address, reason: 'UNSUBSCRIBE' } } }));
  } finally {
    const prospects = await db.radarProspect.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    const ids = prospects.map(p => p.id);
    await db.radarReply.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarSend.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarSequence.deleteMany({ where: { prospectId: { in: ids } } });
    await db.radarProspect.deleteMany({ where: { id: { in: ids } } });
    await db.radarSuppression.deleteMany({ where: { value: { contains: tag } } });
    await db.radarTemplate.deleteMany({ where: { code: { in: [codeA, codeB] } } });
    await db.radarMailbox.delete({ where: { id: mailbox.id } });
    await db.dailyAdInsight.deleteMany({ where: { reportKey: { in: markers } } });
    if (setting.radarConfig === null) await db.$executeRaw`UPDATE Setting SET radarConfig = NULL WHERE id = 'system'`;
    else await db.setting.update({ where: { id: 'system' }, data: { radarConfig: setting.radarConfig } });
  }
});

test('radar stats: the Gmail spam-report rate is read once a day; 0.3% pauses the domain, 0.1% warns, no access is said', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const domains = { pause: `pm-${tag}.com`, warn: `pw-${tag}.com`, denied: `pn-${tag}.com` };
  const boxes = await Promise.all(Object.values(domains).map(domain => db.radarMailbox.create({ data: { address: `jason@${domain}`, domain,
    credential: sealSecret(`refresh-${domain}`), warmupStartedAt: new Date(Date.now() - 60 * DAY), capLevel: 5 } })));
  const at = (day: string, time: string) => new Date(`${day}T${time}+08:00`);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + DAY));
  const now = at(day, '08:10:00'), yesterday = new Date(now.getTime() - DAY).toISOString().slice(0, 10), twoDaysAgo = new Date(now.getTime() - 2 * DAY).toISOString().slice(0, 10);
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'access', expires_in: 3600 });
    const m = url.match(/\/v1\/domains\/([^/]+)\/trafficStats\/(\d{8})$/);
    if (!m) return Response.json({}, { status: 404 });
    asked.push(`${m[1]} ${m[2]}`);
    const compact = (d: string) => d.replace(/-/g, '');
    if (m[1] === domains.denied) return Response.json({ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }, { status: 403 });
    if (m[1] === domains.pause && m[2] === compact(twoDaysAgo)) return Response.json({ name: 'x', userReportedSpamRatio: 0.004 });
    if (m[1] === domains.warn && m[2] === compact(yesterday)) return Response.json({ name: 'x', userReportedSpamRatio: 0.0015 });
    return Response.json({ error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } }, { status: 404 });
  });
  try {
    assert.deepEqual(await withEnv({ GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '' }, () => checkPostmaster(now)), { checked: false }, 'Google sign-in not set up');
    await withEnv({ GOOGLE_OAUTH_CLIENT_ID: 'client', GOOGLE_OAUTH_CLIENT_SECRET: 'secret' }, () => checks());
  } finally {
    await db.dailyAdInsight.deleteMany({ where: { reportKey: `radar-postmaster:${day}` } });
    await db.radarMailbox.deleteMany({ where: { id: { in: boxes.map(b => b.id) } } });
  }

  async function checks() {
    assert.deepEqual(await checkPostmaster(at(day, '07:50:00')), { checked: false }, 'before 08:00');
    const result = await checkPostmaster(now);
    assert.equal(result.checked, true);
    const of = (domain: string) => result.readings!.find(r => r.domain === domain)!;
    assert.deepEqual(of(domains.pause), { domain: domains.pause, day: twoDaysAgo, ratio: 0.004, note: '' }, 'yesterday has no data yet: the day before');
    assert.deepEqual([of(domains.warn).day, of(domains.warn).ratio], [yesterday, 0.0015]);
    assert.deepEqual([of(domains.denied).ratio, of(domains.denied).note.startsWith('没有读取权限')], [null, true]);
    const [paused, warned, denied] = await Promise.all(boxes.map(b => db.radarMailbox.findUniqueOrThrow({ where: { id: b.id } })));
    assert.equal(paused.status, 'PAUSED');
    assert.match(paused.pausedReason, /0\.40%.*0\.3%/);
    assert.deepEqual([warned.status, denied.status], ['ACTIVE', 'ACTIVE'], 'a warning or missing access never pauses');
    const calls = asked.length;
    assert.deepEqual(await checkPostmaster(at(day, '09:00:00')), { checked: false }, 'once a day');
    assert.equal(asked.length, calls, 'Google is not asked again the same day');
    const shown = (await radarStats(actorOf(admin))).postmaster!;
    assert.equal(shown.checkedOn, day);
    assert.equal(shown.readings.find(r => r.domain === domains.pause)!.percent, 0.4);
  }
});
