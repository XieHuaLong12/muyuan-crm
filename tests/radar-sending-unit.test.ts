import test from 'node:test';
import assert from 'node:assert/strict';
import { fromZonedTime } from 'date-fns-tz';
import { DEFAULT_RADAR_CONFIG } from '../lib/radar';
import { DAY_MS, MINUTE, addWorkdays, compareQueue, dailyCap, inWindow, localParts, nextCapLevel, nextWindowStart, pickNext, planQueue, randomGap, type QueueItem } from '../lib/radar-schedule';
import { UNSUBSCRIBE_LINE, buildMessage, checkTemplate, encodeHeader, greetingFor, mailBody, nextTemplateCode, quotedPrintable, renderTemplate, replySubject } from '../lib/radar-mail';
import { classifyGmail } from '../lib/gmail';
import { acceptOpening } from '../services/radar-ai-service';

const FR = DEFAULT_RADAR_CONFIG.countries.FR, SA = DEFAULT_RADAR_CONFIG.countries.SA;
const paris = (local: string) => fromZonedTime(local, 'Europe/Paris');

test('radar schedule: the recipient\'s working days and hours, holidays, Saudi weekend, daylight saving', () => {
  // 2026-10-28 is a Wednesday; Paris is UTC+1 after the clocks went back on 25 October.
  assert.deepEqual(localParts(new Date('2026-10-28T08:30:00Z'), 'Europe/Paris'), { day: '2026-10-28', weekday: 3, minutes: 9 * 60 + 30 });
  assert.equal(inWindow(paris('2026-10-28T09:00:00'), FR, 'Europe/Paris'), true);
  assert.equal(inWindow(paris('2026-10-28T16:29:00'), FR, 'Europe/Paris'), true);
  assert.equal(inWindow(paris('2026-10-28T16:30:00'), FR, 'Europe/Paris'), false, 'the window ends at 16:30');
  assert.equal(inWindow(paris('2026-10-28T08:59:00'), FR, 'Europe/Paris'), false);
  assert.equal(inWindow(paris('2026-10-31T10:00:00'), FR, 'Europe/Paris'), false, 'Saturday');
  assert.equal(inWindow(paris('2026-11-11T10:00:00'), { ...FR, holidays: ['2026-11-11'] }, 'Europe/Paris'), false, 'a holiday');
  const riyadh = (local: string) => fromZonedTime(local, 'Asia/Riyadh');
  assert.equal(inWindow(riyadh('2026-10-30T10:00:00'), SA, 'Asia/Riyadh'), false, 'Friday is the Saudi weekend');
  assert.equal(inWindow(riyadh('2026-11-01T10:00:00'), SA, 'Asia/Riyadh'), true, 'Sunday is a Saudi working day');

  assert.equal(nextWindowStart(paris('2026-10-28T07:00:00'), FR, 'Europe/Paris')?.toISOString(), paris('2026-10-28T09:00:00').toISOString(), 'later the same morning');
  assert.equal(nextWindowStart(paris('2026-10-30T17:00:00'), FR, 'Europe/Paris')?.toISOString(), paris('2026-11-02T09:00:00').toISOString(), 'Friday evening → Monday');
  assert.equal(nextWindowStart(paris('2026-11-10T17:00:00'), { ...FR, holidays: ['2026-11-11'] }, 'Europe/Paris')?.toISOString(), paris('2026-11-12T09:00:00').toISOString());
  const inside = paris('2026-10-28T11:00:00');
  assert.equal(nextWindowStart(inside, FR, 'Europe/Paris'), inside);
  // Clocks go forward on 29 March 2026: Monday 09:00 in Paris is 07:00 UTC.
  assert.equal(nextWindowStart(new Date('2026-03-28T20:00:00Z'), FR, 'Europe/Paris')?.toISOString(), '2026-03-30T07:00:00.000Z');

  assert.equal(addWorkdays(paris('2026-10-28T15:00:00'), 3, FR, 'Europe/Paris').toISOString(), paris('2026-11-02T09:00:00').toISOString(), 'Wed + 3 working days = Mon');
  assert.equal(addWorkdays(paris('2026-10-28T15:00:00'), 3, { ...FR, holidays: ['2026-11-02'] }, 'Europe/Paris').toISOString(), paris('2026-11-03T09:00:00').toISOString());
  assert.equal(addWorkdays(fromZonedTime('2026-10-29T12:00:00', 'Asia/Riyadh'), 1, SA, 'Asia/Riyadh').toISOString(), fromZonedTime('2026-11-01T09:00:00', 'Asia/Riyadh').toISOString(), 'Thursday + 1 = Sunday in Riyadh');
});

test('radar schedule: warm-up caps rise a level a week only after a clean week; gaps are random within bounds', () => {
  const levels = DEFAULT_RADAR_CONFIG.rampLevels;
  const start = new Date('2026-10-01T00:00:00Z');
  const at = (days: number) => new Date(start.getTime() + days * DAY_MS);
  assert.equal(dailyCap({ capLevel: 0, capOverride: null, warmupStartedAt: start }, levels, at(3)), 0, 'weeks 1–2 only warm up');
  assert.equal(dailyCap({ capLevel: 2, capOverride: null, warmupStartedAt: start }, levels, at(15)), 10);
  assert.equal(dailyCap({ capLevel: 9, capOverride: null, warmupStartedAt: start }, levels, at(60)), 40, 'the last level holds');
  assert.equal(dailyCap({ capLevel: 5, capOverride: 25, warmupStartedAt: start }, levels, at(60)), 25, 'a cap set by hand is lower');
  assert.equal(dailyCap({ capLevel: 5, capOverride: null, warmupStartedAt: at(10) }, levels, at(5)), 0, 'before the warm-up starts');
  const box = { capLevel: 2, rampedAt: at(14), warmupStartedAt: start };
  assert.equal(nextCapLevel(box, levels, at(20), true), 2, 'less than a week since the last step');
  assert.equal(nextCapLevel(box, levels, at(21), true), 3);
  assert.equal(nextCapLevel(box, levels, at(21), false), 2, 'a week with too many bounces holds the level');
  assert.equal(nextCapLevel({ ...box, capLevel: 3 }, levels, at(22), true), 3, 'never ahead of the weeks');
  const config = { intervalMin: 6, intervalMax: 15 };
  assert.equal(randomGap(config, () => 0), 6 * MINUTE);
  assert.equal(randomGap(config, () => 0.9999), 15 * MINUTE);
});

const item = (id: string, extra: Partial<QueueItem> = {}): QueueItem => ({ id, step: 1, dueAt: new Date(0), pinnedAt: null, grade: 'A', score: 80, createdAt: new Date(0),
  risky: false, timezone: 'Europe/Paris', country: FR, mailboxId: null, ...extra });

test('radar queue order and picking: pinned, follow-ups, grade, score; thread mailbox, window and risky cap', () => {
  const list = [item('b', { grade: 'B', score: 95 }), item('a2', { score: 70 }), item('a1', { score: 90 }), item('f', { step: 2, dueAt: new Date(5) }),
    item('p', { grade: 'B', pinnedAt: new Date(9) }), item('f0', { step: 3, dueAt: new Date(1) })];
  assert.deepEqual([...list].sort(compareQueue).map(i => i.id), ['p', 'f0', 'f', 'a1', 'a2', 'b']);
  const now = paris('2026-10-28T10:00:00');
  assert.equal(pickNext([item('x', { mailboxId: 'other', step: 2 }), item('y', { grade: 'B' })], { id: 'm1', riskyToday: 0 }, now, 5)?.id, 'y', 'a follow-up only leaves from its own mailbox');
  assert.equal(pickNext([item('r', { risky: true }), item('s', { grade: 'B' })], { id: 'm1', riskyToday: 5 }, now, 5)?.id, 's', 'risky cap reached');
  assert.equal(pickNext([item('later', { dueAt: new Date(now.getTime() + MINUTE) })], { id: 'm1', riskyToday: 0 }, now, 5), null, 'not due yet');
  assert.equal(pickNext([item('au', { timezone: 'Australia/Sydney', country: DEFAULT_RADAR_CONFIG.countries.AU })], { id: 'm1', riskyToday: 0 }, now, 5), null, 'it is evening in Sydney');
});

test('radar planner: simulates caps, gaps and windows to estimate when the queue is done', () => {
  const now = paris('2026-10-28T10:00:00');
  const config = { intervalMin: 6, intervalMax: 14, riskyPerMailboxPerDay: 1 };
  const plan = planQueue({ now, items: ['a', 'b', 'c', 'd', 'e'].map(id => item(id)), config, dayTz: 'Asia/Shanghai',
    mailboxes: [{ id: 'm1', cap: 2, sentToday: 0, riskyToday: 0, nextSendAt: null }, { id: 'm2', cap: 2, sentToday: 1, riskyToday: 0, nextSendAt: new Date(now.getTime() + 30 * MINUTE) }] });
  const at = (id: string) => plan.get(id)?.at.toISOString();
  assert.equal(at('a'), now.toISOString());
  assert.equal(at('b'), new Date(now.getTime() + 10 * MINUTE).toISOString(), 'average gap 10 minutes');
  assert.equal(plan.get('c')?.mailboxId, 'm2', 'm1 used its cap of two');
  assert.equal(at('c'), new Date(now.getTime() + 30 * MINUTE).toISOString());
  // m2 had sent one already: its cap is reached after c; d and e wait for the next Beijing day and the next Paris window.
  assert.equal(at('d'), paris('2026-10-29T09:00:00').toISOString());
  assert.equal(plan.size, 5);
  const risky = planQueue({ now, items: [item('r1', { risky: true }), item('r2', { risky: true })], config, dayTz: 'Asia/Shanghai', mailboxes: [{ id: 'm1', cap: 10, sentToday: 0, riskyToday: 0, nextSendAt: null }] });
  assert.equal(risky.get('r2')?.at.toISOString(), paris('2026-10-29T09:00:00').toISOString(), 'one risky address a day');
  const none = planQueue({ now, items: [item('z')], config, dayTz: 'Asia/Shanghai', mailboxes: [{ id: 'm1', cap: 0, sentToday: 0, riskyToday: 0, nextSendAt: null }] });
  assert.equal(none.size, 0, 'no capacity, no plan');
  const followUp = planQueue({ now, items: [item('f', { step: 2, mailboxId: 'gone' })], config, dayTz: 'Asia/Shanghai', mailboxes: [{ id: 'm1', cap: 10, sentToday: 0, riskyToday: 0, nextSendAt: null }] });
  assert.equal(followUp.size, 0, 'a follow-up whose mailbox is paused waits for it');
});

test('radar templates: variables, the opening line, checks, footer and threading subject', () => {
  const values = { greeting: greetingFor('fr'), company: 'Meubles Dupont', city: 'Lyon', opening: '', catalogUrl: 'https://x.fr/catalogue' };
  const body = '{称呼}\n\n{个性化开头}\n\nNous fabriquons des canapés compressés pour {公司名} à {城市}.\nCatalogue : {目录链接}';
  assert.equal(renderTemplate(body, values), 'Bonjour,\n\nNous fabriquons des canapés compressés pour Meubles Dupont à Lyon.\nCatalogue : https://x.fr/catalogue', 'no opening: its line disappears');
  assert.match(renderTemplate(body, { ...values, opening: 'Vos 3 magasins à Lyon.' }), /^Bonjour,\n\nVos 3 magasins à Lyon\.\n\nNous/);
  assert.equal(greetingFor('en', 'Sarah'), 'Hello Sarah,');
  assert.deepEqual(checkTemplate({ step: 1, subject: 'Canapés', body }).errors, []);
  assert.match(checkTemplate({ step: 1, subject: '', body: '{客户名} https://a.fr https://b.fr {目录链接}' }).errors.join('|'), /不认识的变量：\{客户名\}.*\|第 1 封必须写主题\|每封最多 2 个链接，现在有 3 个/);
  assert.match(checkTemplate({ step: 3, subject: '', body: Array.from({ length: 60 }, () => 'mot').join(' ') }).warnings[0], /第 3 封建议 50 词以内，现在约 60 词/);
  assert.equal(mailBody('Bonjour,', 'Jason · LVANJU', 'fr'), `Bonjour,\n\nJason · LVANJU\n\n${UNSUBSCRIBE_LINE.fr}`);
  assert.equal(replySubject('Canapés'), 'Re: Canapés');
  assert.equal(replySubject('RE: Canapés'), 'RE: Canapés');
  assert.equal(nextTemplateCode('FR-1-A', ['FR-1-A', 'FR-1-B']), 'FR-1-C');
});

const decodeQp = (text: string) => Buffer.from(text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');
test('radar MIME: plain text, quoted-printable, encoded headers, thread headers, unsubscribe', () => {
  const text = `Bonjour,\n\nNous fabriquons des canapés compressés — livrés en carton, ${'très '.repeat(30)}compacts. 100% = qualité.\n\nCordialement `;
  const qp = quotedPrintable(text);
  assert.ok(qp.split('\r\n').every(line => line.length <= 76), 'lines stay under 76 characters');
  assert.equal(decodeQp(qp), text.replace(/\n/g, '\r\n'), 'decodes back exactly, trailing space included');
  assert.equal(encodeHeader('Canapes compresses'), 'Canapes compresses');
  const encoded = encodeHeader('Canapés compressés pour votre magasin à Lyon — catalogue 2026');
  assert.ok(encoded.split('\r\n ').every(w => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w) && w.length <= 75));
  assert.equal(encoded.split('\r\n ').map(w => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join(''), 'Canapés compressés pour votre magasin à Lyon — catalogue 2026');
  const first = buildMessage({ from: { name: 'Jason', address: 'jason@lvanju-mail.com' }, to: 'achat@shop.fr', subject: 'Canapés', body: 'Bonjour', date: new Date('2026-10-28T09:00:00Z') });
  assert.match(first, /^From: "Jason" <jason@lvanju-mail\.com>\r\nTo: <achat@shop\.fr>\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(first, /\r\nDate: Wed, 28 Oct 2026 09:00:00 \+0000\r\n/);
  assert.match(first, /\r\nList-Unsubscribe: <mailto:jason@lvanju-mail\.com\?subject=unsubscribe>\r\n/);
  assert.match(first, /Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBonjour\r\n$/);
  assert.doesNotMatch(first, /In-Reply-To|<html|<img/i);
  const reply = buildMessage({ from: { name: 'Jason · LVANJU', address: 'jason@lvanju-mail.com' }, to: 'achat@shop.fr', subject: 'Re: Canapés', body: 'x', thread: ['<a@mail>', '<b@mail>'] });
  assert.match(reply, /\r\nIn-Reply-To: <b@mail>\r\nReferences: <a@mail> <b@mail>\r\n/);
  assert.match(reply, /^From: =\?UTF-8\?B\?/, 'a display name with a middle dot is encoded');
});

test('radar AI opening: only short, factual sentences without prices, links, questions or invented numbers pass', () => {
  const facts = [{ quote: 'Nos 3 magasins à Lyon proposent canapés et literie depuis 1985.' }];
  assert.equal(acceptOpening('Vos 3 magasins à Lyon mettent en avant les canapés et la literie depuis 1985.', facts), 'Vos 3 magasins à Lyon mettent en avant les canapés et la literie depuis 1985.');
  assert.equal(acceptOpening('« Vos magasins à Lyon proposent de beaux canapés. »', facts), 'Vos magasins à Lyon proposent de beaux canapés.');
  assert.equal(acceptOpening('Vos 12 magasins à Lyon proposent des canapés.', facts), '', 'a number that is not on the site');
  assert.equal(acceptOpening('Nos prix sont imbattables pour vos magasins de Lyon.', facts), '', 'prices are for the price list');
  assert.equal(acceptOpening('Your MOQ needs are small, we can help.', facts), '');
  assert.equal(acceptOpening('Voir www.shop.fr pour vos canapés.', facts), '');
  assert.equal(acceptOpening('Vous vendez des canapés à Lyon ?', facts), '', 'the mail asks one question, at its end');
  assert.equal(acceptOpening(Array.from({ length: 31 }, () => 'mot').join(' '), facts), '');
  assert.equal(acceptOpening('', facts), '');
});

test('radar Gmail errors: what each one means for the sender', () => {
  assert.equal(classifyGmail(401, '', 'Invalid Credentials'), 'AUTH');
  assert.equal(classifyGmail(400, 'invalid_grant', 'Token has been expired or revoked.'), 'AUTH');
  assert.equal(classifyGmail(429, 'userRateLimitExceeded', 'User-rate limit exceeded'), 'TEMPORARY');
  assert.equal(classifyGmail(403, 'dailyLimitExceeded', 'Daily Limit Exceeded'), 'LIMIT');
  assert.equal(classifyGmail(400, 'failedPrecondition', 'Mail sending limit exceeded'), 'LIMIT');
  assert.equal(classifyGmail(503, 'backendError', 'Backend Error'), 'TEMPORARY');
  assert.equal(classifyGmail(400, 'invalidArgument', 'Invalid To header'), 'PERMANENT');
});
