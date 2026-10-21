import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, HOUR, deriveOutreach, focusSignals, groupMessages, judgeArms, matchesExactly, nextVersionCode, readConfig, renderScript, ruleReply,
  winProbabilities, customerScriptLanguage, type FlowMessage, type Quality, type SignalInput } from '../lib/outreach';

const config = readConfig(null);
const t0 = new Date('2026-11-02T01:00:00Z');
const at = (hours: number) => new Date(t0.getTime() + hours * HOUR);
let seq = 0;
const out = (hours: number, content = 'Hi, which market do you sell to?', extra: Partial<FlowMessage> = {}): FlowMessage =>
  ({ id: `m${String(++seq).padStart(4, '0')}`, direction: 'OUTBOUND', sentAt: at(hours), content, messageType: 'TEXT', bos: false, templateName: null, senderId: null, ...extra });
const inn = (hours: number, content = 'We have 2 stores in Lyon'): FlowMessage =>
  ({ id: `m${String(++seq).padStart(4, '0')}`, direction: 'INBOUND', sentAt: at(hours), content, messageType: 'TEXT', bos: false, templateName: null, senderId: null });
/** Derive with replies judged by the rules, the way the engine does before the AI answers. */
function derive(messages: FlowMessage[], nowHours: number, verdicts: Record<string, Quality> = {}) {
  const groups = groupMessages(messages, config.groupMinutes);
  const byKey = new Map(groups.map(g => [g.key, g]));
  return deriveOutreach(groups, key => {
    const group = byKey.get(key)!;
    const text = group.messages.map(m => m.content).join('\n');
    const rule = ruleReply(text, false, true);
    return { quality: verdicts[key] ?? rule.quality, stop: rule.signals.includes('STOP_CONTACT') };
  }, config, at(nowHours));
}

test('messages sent within 10 minutes of the first are one group; the other side ends it', () => {
  const messages = [out(0, 'Hi'), out(0.05, '[图片]', { messageType: 'IMAGE' }), out(0.15, 'catalog.pdf'), out(0.2, 'one more'), inn(0.3), out(0.31)];
  const groups = groupMessages(messages, 10);
  assert.deepEqual(groups.map(g => [g.direction, g.messages.length]), [['OUTBOUND', 3], ['OUTBOUND', 1], ['INBOUND', 1], ['OUTBOUND', 1]]);
  assert.equal(groups[0].at.getTime(), at(0).getTime(), 'a group takes the time of its first message');
});

test('a form lead answered within 24 hours: T0 replied, the conversation starts, nothing more to send', () => {
  const t = out(0), reply = inn(3);
  const d = derive([t, reply], 5);
  assert.equal(d.state, 'CONVERSING');
  assert.equal(d.next, '');
  assert.deepEqual(d.touches.map(x => [x.code, x.replied24h, x.lateReply, x.windowOpen]), [['T0', true, false, false]], 'a form lead never wrote: outside the window');
  assert.equal(d.replyTouch.get(reply.id), t.id);
  assert.equal(d.firstAnsweredTouch, t.id);
  assert.equal(d.bestQuality, 'ENGAGED');
});

test('no reply: pending inside 24 hours, then "no", and T1 is planned for the next day', () => {
  const early = derive([out(0)], 10);
  assert.equal(early.touches[0].replied24h, null, 'not yet 24 hours');
  assert.equal(early.dueAt?.getTime(), at(24).getTime(), 'the engine looks again when the 24 hours are up');
  const later = derive([out(0)], 30);
  assert.equal(later.touches[0].replied24h, false);
  assert.equal(later.next, 'T1');
  assert.equal(later.nextTouchAt?.getTime(), at(24).getTime(), 'day 1 after T0');
});

test('an auto-reply is not a reply: the clock keeps running and the real answer is late', () => {
  const t = out(0), auto = inn(0.01, 'Thank you for contacting Maison Jean. We will get back to you as soon as possible.'), real = inn(30, 'What is the price for 50 pcs?');
  const d = derive([t, auto, real], 31);
  assert.equal(d.replyTouch.has(auto.id), false);
  assert.equal(d.replyTouch.get(real.id), t.id);
  assert.deepEqual([d.touches[0].replied24h, d.touches[0].lateReply], [false, true]);
  assert.equal(d.state, 'CONVERSING');
  assert.equal(d.bestQuality, 'HIGH');
});

test('the auto-reply opens the WhatsApp window: the next touch is sent inside it', () => {
  const d = derive([out(0), inn(0.01, 'Thanks for your message, we will reply shortly'), out(26)], 27);
  assert.deepEqual(d.touches.map(t => [t.code, t.windowOpen]), [['T0', false], ['T1', false]], 'more than 24 hours after the auto-reply');
  const inside = derive([out(0), inn(0.01, 'Thanks for your message, we will reply shortly'), out(5)], 6);
  assert.deepEqual(inside.touches.map(t => [t.code, t.windowOpen, t.tooSoon]), [['T0', false, false], ['T1', true, true]]);
});

test('the reply belongs to the last touch sent before it', () => {
  const first = out(0), second = out(2), reply = inn(3);
  const d = derive([first, second, reply], 4);
  assert.deepEqual(d.touches.map(t => [t.code, t.replyKey]), [['T0', null], ['T1', reply.id]]);
  assert.equal(d.touches[0].replied24h, null, 'T0 got no reply of its own and is not yet 24 hours old');
});

test('T0–T4 without an answer: 7 days after T4 the lead is dormant and a sixth message is no touch', () => {
  const messages = [out(0), out(24), out(72), out(168), out(336)];
  const waiting = derive(messages, 340);
  assert.equal(waiting.state, 'ICEBREAK');
  assert.equal(waiting.next, '', 'after T4 there is no T5');
  assert.equal(waiting.dueAt?.getTime(), at(336 + 24).getTime(), 'first T4 reaching 24 hours');
  assert.equal(derive(messages, 361).dueAt?.getTime(), at(336 + 168).getTime(), 'then the 7 days after T4');
  const dormant = derive([...messages, out(520)], 530);
  assert.equal(dormant.state, 'DORMANT');
  assert.deepEqual(dormant.touches.map(t => t.code), ['T0', 'T1', 'T2', 'T3', 'T4']);
  const back = derive([...messages, inn(600, 'Sorry for the late reply, send the catalog')], 601);
  assert.equal(back.state, 'CONVERSING', 'a dormant lead writing back is a conversation again');
  assert.equal(back.touches[4].lateReply, true, 'and answers T4 late');
});

test('a refusal makes the lead dormant; a stop request stops all outreach', () => {
  const refused = derive([out(0), inn(2, 'Not interested, thanks')], 3);
  assert.equal(refused.state, 'DORMANT');
  assert.equal(refused.touches[0].replied24h, true, 'a refusal still counts as a 24-hour reply');
  const stopped = derive([out(0), inn(1, 'Stop')], 2);
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(stopped.next, '');
  const later = derive([out(0), inn(1, 'Stop'), inn(100, 'Actually what is your price?')], 101);
  assert.equal(later.state, 'STOPPED', 'nothing leaves STOPPED on its own');
});

test('72 hours after the customer last wrote, the conversation is silent: R1–R3, then dormant', () => {
  const lead = inn(0, 'Hello, I saw your ad'), answer = out(0.2, 'Hi! Which market do you sell to?');
  assert.equal(derive([lead, answer], 1).touches.length, 0, 'a customer who wrote first is a conversation, our answer is no touch');
  const silent = derive([lead, answer], 80);
  assert.deepEqual([silent.state, silent.next, silent.cycle], ['SILENT', 'R1', 1]);
  assert.equal(silent.nextTouchAt?.getTime(), at(72).getTime(), 'R1 on the day the silence starts');
  const r1 = out(80), back = inn(90, 'Yes please send prices');
  const revived = derive([lead, answer, r1, back], 91);
  assert.deepEqual(revived.touches.map(t => [t.kind, t.code, t.cycle, t.replyKey]), [['REVIVE', 'R1', 1, back.id]]);
  assert.equal(revived.state, 'CONVERSING');
  const again = derive([lead, answer, r1, back], 200);
  assert.deepEqual([again.state, again.next, again.cycle], ['SILENT', 'R1', 2], 'a second silence starts a new round');
  const exhausted = derive([lead, answer, out(80), out(150), out(250)], 250 + 7 * 24 + 1);
  assert.equal(exhausted.state, 'DORMANT');
});

test('templates since the last real reply, for the two-template cap', () => {
  const template = (hours: number) => out(hours, 'Hi {{1}}', { messageType: 'TEMPLATE', bos: true });
  assert.equal(derive([template(0), template(30)], 31).templatesSinceReply, 2);
  assert.equal(derive([template(0), inn(1), template(100)], 101).templatesSinceReply, 1);
});

test('a script matches word for word apart from punctuation, spacing and its variables', () => {
  const script = 'Hi {客户名}! We make compressed sofas in Foshan. Do you sell in {国家} through stores or online?';
  assert.ok(matchesExactly('Hi Jean, we make compressed sofas in Foshan... do you sell in France through stores or online', script));
  assert.ok(matchesExactly('Hi Jean! We make compressed sofas in Foshan. Do you sell in France through stores or online?\n[图片]', script), 'an attached photo is not words');
  assert.equal(matchesExactly('Hi Jean! We make compressed sofas in Foshan. What quantity do you need?', script), false, 'a different closing question');
  assert.equal(renderScript(script, { firstName: 'Jean', country: 'France', product: '', owner: 'Sophie' }),
    'Hi Jean! We make compressed sofas in Foshan. Do you sell in France through stores or online?');
  assert.equal(renderScript('Hi {客户名}, {产品}', { firstName: '', country: '', product: '', owner: '' }), 'Hi {客户名}, {产品}', 'what the record cannot fill stays visible');
});

test('reply rules: auto-replies, stop, buying words, polite one-liners, photos', () => {
  assert.equal(ruleReply('Thank you for contacting us. We will get back to you shortly.', false, true).quality, 'INVALID');
  assert.equal(ruleReply('Thanks for your message, what is the price for 50 pcs?', false, true).quality, 'HIGH');
  assert.deepEqual(ruleReply('STOP', false, true), { quality: 'REJECT', signals: ['STOP_CONTACT'], reason: '客户要求停止联系' });
  assert.equal(ruleReply('Stop. Price?', false, true).signals.includes('STOP_CONTACT'), false, 'only a whole-message stop is taken from the words');
  assert.equal(ruleReply('ok 👍', false, true).quality, 'LOW');
  assert.deepEqual(ruleReply('[图片]', true, false).signals, ['NEEDS_HUMAN']);
  assert.equal(ruleReply('We have 2 stores in Lyon', false, true).quality, 'ENGAGED');
});

/** P(X > Y) for X ~ Beta(a1, b1), Y ~ Beta(a2, b2) by numeric integration, to check the sampler against. */
function exactWin(a1: number, b1: number, a2: number, b2: number) {
  const lgamma = (z: number): number => {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  };
  const pdf = (x: number, a: number, b: number) => Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b)));
  const steps = 20_000; let cdfY = 0, total = 0;
  for (let i = 1; i < steps; i++) { const x = i / steps; cdfY += pdf(x, a2, b2) / steps; total += pdf(x, a1, b1) * cdfY / steps; }
  return total;
}

test('win probability agrees with the exact value within 2 percentage points', () => {
  for (const [r1, n1, r2, n2] of [[13, 34, 7, 31], [10, 30, 10, 30], [20, 40, 8, 40], [5, 30, 9, 30]]) {
    const [p] = winProbabilities([{ replied: r1, sent: n1 }, { replied: r2, sent: n2 }]);
    const exact = exactWin(r1 + 1, n1 - r1 + 1, r2 + 1, n2 - r2 + 1);
    assert.ok(Math.abs(p - exact) <= 0.02, `${r1}/${n1} vs ${r2}/${n2}: sampled ${p}, exact ${exact}`);
  }
  assert.deepEqual(winProbabilities([{ replied: 9, sent: 30 }, { replied: 4, sent: 31 }]), winProbabilities([{ replied: 9, sent: 30 }, { replied: 4, sent: 31 }]), 'stable between page loads');
});

test('below 30 sends a script is not compared; above it the system only suggests', () => {
  const few = judgeArms([{ replied: 12, sent: 29 }, { replied: 3, sent: 40 }], config);
  assert.deepEqual(few.map(r => r.suggestion), ['INSUFFICIENT', 'CONTINUE'], 'one qualified script has nothing to be compared with');
  assert.equal(few[0].probability, null);
  const clear = judgeArms([{ replied: 20, sent: 40 }, { replied: 6, sent: 40 }, { replied: 1, sent: 5 }], config);
  assert.deepEqual(clear.map(r => r.suggestion), ['WIN', 'RETIRE', 'INSUFFICIENT']);
  assert.ok(clear[0].probability! >= 0.9 && clear[1].probability! < 0.1);
});

const quiet: SignalInput = { t0Current: { sent: 20, replied: 4 }, t0Previous: [{ sent: 20, replied: 4 }, { sent: 18, replied: 4 }, { sent: 22, replied: 4 }, { sent: 20, replied: 4 }],
  leadsCurrent: { total: 20, business: 12 }, leadsPrevious: [{ total: 20, business: 12 }], hotBacklog: 0, staleQuotes: 2, slowFirstReplies: 2, nonStandard: [{ name: 'Sophie', share: 0.25, total: 8 }],
  energy: { CONVERT: 6, FRONTEND: 2, DATA: 2 } };

test('focus signals light up on the condition and go out when it no longer holds', () => {
  assert.deepEqual(focusSignals(quiet, config), [], 'nothing to say on a normal week');
  const keys = (input: SignalInput) => focusSignals(input, config).map(s => s.key);
  assert.deepEqual(keys({ ...quiet, t0Current: { sent: 20, replied: 2 } }), ['reply-rate'], '10% against ~20%');
  assert.deepEqual(keys({ ...quiet, t0Current: { sent: 5, replied: 0 } }), [], 'too few touches to judge');
  assert.deepEqual(keys({ ...quiet, leadsCurrent: { total: 20, business: 9 } }), ['lead-quality'], '45% against 60%');
  assert.deepEqual(keys({ ...quiet, hotBacklog: 1, staleQuotes: 3, slowFirstReplies: 3 }), ['hot-backlog', 'stale-quotes', 'slow-first-reply']);
  assert.deepEqual(keys({ ...quiet, nonStandard: [{ name: 'Sophie', share: 0.4, total: 10 }] }), ['non-standard:Sophie']);
  assert.deepEqual(keys({ ...quiet, energy: { CONVERT: 3, FRONTEND: 5, DATA: 2 } }), ['energy:CONVERT', 'energy:FRONTEND']);
  assert.deepEqual(keys({ ...quiet, energy: { CONVERT: 1, FRONTEND: 2, DATA: 0 } }), [], 'too few finished items to judge the split');
});

test('parameters fall back to the defaults, versions count up, languages map to scripts', () => {
  assert.equal(config.silentHours, 72);
  assert.deepEqual(readConfig({ silentHours: 48, followUpDays: [1, 2] }), readConfig(null), 'an invalid stored value falls back to the defaults');
  assert.equal(readConfig({ silentHours: 48 }).silentHours, 48);
  assert.equal(nextVersionCode('T0-A1', ['T0-A1', 'T0-A2']), 'T0-A3');
  assert.equal(nextVersionCode('T1-M1', []), 'T1-M2');
  assert.deepEqual(['fr', 'French', 'Arabic', '', 'en'].map(customerScriptLanguage), ['fr', 'fr', 'ar', 'en', 'en']);
  assert.equal(DAY, 24 * HOUR);
});
