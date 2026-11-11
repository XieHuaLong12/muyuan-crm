import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { db } from '../lib/db';
import { guessKind, nextStatus, similarity, splitQuote, tagsOf, tidy } from '../lib/idea-wall';
import { SIGNS, advice, cnNumber, drawSign, streak, weekLine, type Facts } from '../lib/daily-sign';
import { createImageNote, createNote, noteImage, noteToTask, saveNote, updateNote, wall } from '../services/idea-wall-service';
import { dailySign, drawToday, updateSign } from '../services/daily-sign-service';

const at = (iso: string) => new Date(iso);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('想法墙 rules: kinds are guessed, quotes keep their source, tags are read, tidy finds twins, stale ideas and replies', () => {
  assert.equal(guessKind('https://www.facebook.com/business/help/123 投放时段要总预算'), 'USEFUL');
  assert.equal(guessKind('「付出不亚于任何人的努力。」'), 'QUOTE');
  assert.equal(guessKind('结硬寨，打呆仗。—— 曾国藩'), 'QUOTE');
  assert.equal(guessKind('慢慢来，比较快。'), 'QUOTE', 'one short sentence closed with 。');
  assert.equal(guessKind('要不要试一下 TikTok 广告？'), 'IDEA');
  assert.equal(guessKind('报价单有没有被客户打开'), 'IDEA');
  assert.equal(guessKind(''), 'IDEA');
  assert.deepEqual(splitQuote('「付出不亚于任何人的努力。」—— 稻盛和夫《六项精进》'), { text: '付出不亚于任何人的努力。', source: '稻盛和夫《六项精进》' });
  assert.deepEqual(splitQuote('“Done is better than perfect.”'), { text: 'Done is better than perfect.', source: '' });
  assert.deepEqual(tagsOf('法国 160×200 单独做素材 #广告 #产品 #广告', ['客户']), ['客户', '广告', '产品']);
  assert.deepEqual(['NEW', 'WANT', 'DOING', 'DONE'].map(nextStatus), ['WANT', 'DOING', 'DONE', 'NEW']);
  assert.ok(similarity('广告评论问价的，私信回过去变成线索', '评论里问价的自动回私信变成线索') >= 0.4);
  assert.ok(similarity('要不要试 TikTok 广告', '给老客户发圣诞问候') < 0.2);

  const now = at('2026-11-10T08:00:00Z'), old = at('2026-09-20T08:00:00Z'), recent = at('2026-11-08T08:00:00Z');
  const n = (id: string, kind: string, status: string, text: string, updatedAt = recent, extra = {}) => ({ id, kind, status, text, savedTo: '', linkUrl: '', imageKey: null, createdAt: updatedAt, updatedAt, ...extra });
  const tips = tidy([
    n('a', 'IDEA', 'NEW', '评论里问价的自动回私信变成线索', recent),
    n('b', 'IDEA', 'DOING', '广告评论问价的，私信回过去变成线索', recent),
    n('c', 'IDEA', 'NEW', '沙发床出一份摩洛哥专用价格表', old),
    n('d', 'USEFUL', '', '法国客户问价时，先问尺寸和数量再报，回复的人多很多'),
    n('e', 'USEFUL', '', '回客户前先看一眼时区', recent, { savedTo: 'QUICK_REPLY' }),
  ], now);
  assert.deepEqual(tips.map(t => t.kind), ['MERGE', 'STALE', 'REPLY']);
  assert.deepEqual(tips[0].kind === 'MERGE' && [tips[0].keep, tips[0].drop], ['b', 'a'], 'keep the one already moving');
  assert.equal(tips[1].kind === 'STALE' && tips[1].days, 51);
  assert.equal(tips[2].kind === 'REPLY' && tips[2].id, 'd', 'a saved line is not suggested again');
  assert.deepEqual(tidy([n('x', 'IDEA', 'NEW', '一个想法')], now), []);
});

test('每日一签 rules: one sign per person, day and question; only good signs; work advice from the facts', () => {
  assert.deepEqual([1, 5, 10, 12, 38, 61, 90].map(cnNumber), ['一', '五', '十', '十二', '三十八', '六十一', '九十']);
  for (const list of Object.values(SIGNS)) for (const s of list) {
    assert.ok(['大吉', '中吉', '吉'].includes(s.grade), `${s.no} is a good sign`);
    assert.equal(s.poem.length, 4);
    for (const line of s.poem) assert.equal(line.replace('{dir}', '西北').length, 7, `${s.no}: ${line} has seven characters`);
  }
  const facts: Facts = { country: '法国', countryCode: 'FR', luckyHours: '16:00–19:00', staleQuote: { name: 'Lucas Martin', days: 4 }, nightLeads: 3, pendingSuggestions: 2, costlyAd: '沙发_图片_客厅', oldIdea: { text: '沙发床出一份摩洛哥专用价格表', days: 34 } };
  const gift = { text: '结硬寨，打呆仗。', source: '曾国藩' };
  const a = drawSign('u1', '2026-11-10', 'DEAL', facts, gift), b = drawSign('u1', '2026-11-10', 'DEAL', facts, gift);
  assert.deepEqual(a, b, 'the same person, day and question always give the same sign');
  assert.ok(SIGNS.DEAL.some(s => s.no === a.no));
  assert.ok(a.stars.every(s => s.stars >= 3 && s.stars <= 5));
  assert.equal(a.stars.find(s => s.label === '成交运')!.stars, a.grade === '大吉' ? 5 : 4, 'the asked question gets the best luck');
  assert.equal(a.charms.hours, '16:00–19:00');
  assert.equal(a.charms.direction, '西北', 'France lies north-west of China');
  assert.match(a.read, /贵人在西北，往法国那边多看一眼/);
  assert.ok(!a.poem.some(line => line.includes('{dir}')));
  assert.deepEqual(a.gift, gift);
  assert.match(advice('DEAL', facts).yi[0], /Lucas Martin：报价发出 4 天还没回/);
  assert.match(advice('CLIENT', facts).yi[0], /夜里进线的 3 位/);
  assert.match(advice('ADS', facts).ji[0], /沙发_图片_客厅/);
  assert.match(advice('IDEA', facts).yi[0], /贴了 34 天/);
  assert.match(advice('DEAL', { ...facts, staleQuote: null, luckyHours: null }).yi.join(' '), /追一位报过价/);
  assert.equal(drawSign('u1', '2026-11-10', 'MOOD', facts, gift).charms.direction, '西北');
  assert.equal(streak(['2026-11-08', '2026-11-09', '2026-11-10'], '2026-11-10'), 3);
  assert.equal(streak(['2026-11-08', '2026-11-09'], '2026-11-10'), 2, 'before today’s draw the run ends yesterday');
  assert.equal(streak(['2026-11-07', '2026-11-09'], '2026-11-10'), 1);
  assert.equal(weekLine([{ topic: 'DEAL', grade: '大吉', verdict: 'YES' }]), '');
  assert.match(weekLine([{ topic: 'DEAL', grade: '大吉', verdict: 'YES' }, { topic: 'DEAL', grade: '吉', verdict: 'YES' }, { topic: 'MOOD', grade: '中吉', verdict: 'NO' }]), /问得最多的是「成交」（2 次）；抽到 1 次大吉，应验 2 次/);
});

test('想法墙 service: my notes only, guessing, moving, tasks, saving to quick replies and materials, screenshots', async () => {
  const tag = randomUUID().slice(0, 8);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wall-'));
  const before = process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR = dir;
  const me = await db.user.create({ data: { name: `Wall ${tag}`, email: `wall-${tag}@example.test`, passwordHash: 'x', role: 'ADMIN' } });
  const other = await db.user.create({ data: { name: `Other ${tag}`, email: `wall-other-${tag}@example.test`, passwordHash: 'x', role: 'SALES' } });
  const actor = { id: me.id, name: me.name, email: me.email, role: 'ADMIN' } as never;
  const stranger = { id: other.id, name: other.name, email: other.email, role: 'SALES' } as never;
  try {
    const quote = await createNote(actor, { text: '「付出不亚于任何人的努力。」—— 稻盛和夫《六项精进》', tags: ['心态'] });
    assert.deepEqual([quote.kind, quote.text, quote.source, quote.color, quote.status, quote.tags], ['QUOTE', '付出不亚于任何人的努力。', '稻盛和夫《六项精进》', 'cream', '', ['心态']]);
    const idea = await createNote(actor, { text: `法国 160×200 单独做一条素材 #广告 ${tag}`, color: 'green', capturedOn: '经营总览 · 国家作战卡 · 法国' });
    assert.deepEqual([idea.kind, idea.status, idea.color, idea.tags, idea.capturedOn], ['IDEA', 'NEW', 'green', ['广告'], '经营总览 · 国家作战卡 · 法国']);
    const link = await createNote(actor, { text: '投放时段要总预算 https://www.facebook.com/business/help/123' });
    assert.equal(link.kind, 'USEFUL');
    assert.equal(link.linkUrl, 'https://www.facebook.com/business/help/123');
    const tip = await createNote(actor, { text: `法国客户问价时，先问尺寸和数量再报 ${tag}`, kind: 'USEFUL' });

    let w = await wall(actor);
    assert.deepEqual([w.counts.all, w.counts.IDEA, w.counts.QUOTE, w.counts.USEFUL, w.counts.open], [4, 1, 1, 2, 1]);
    assert.equal(w.quote?.text, '付出不亚于任何人的努力。', '今日一句 comes from my own quotes');
    assert.deepEqual((await wall(actor, { kind: 'QUOTE' })).notes.map(n => n.id), [quote.id]);
    assert.deepEqual((await wall(actor, { q: '稻盛' })).notes.map(n => n.id), [quote.id], 'search reads sources too');
    assert.deepEqual((await wall(actor, { tag: '广告' })).notes.map(n => n.id), [idea.id]);
    assert.equal((await wall(stranger)).notes.length, 0, 'nobody else sees my wall');
    await assert.rejects(updateNote(stranger, idea.id, { pinned: true }), /不存在/);

    await updateNote(actor, idea.id, { status: 'WANT', pinned: true });
    w = await wall(actor);
    assert.equal(w.notes[0].id, idea.id, 'pinned first');
    await assert.rejects(updateNote(actor, quote.id, { status: 'DOING' }), /只有想法有进度/);

    const tasked = await noteToTask(actor, idea.id, at('2026-11-10T02:00:00Z'));
    assert.equal(tasked.status, 'DOING');
    const task = await db.task.findUniqueOrThrow({ where: { id: tasked.taskId! } });
    assert.equal(task.dueDate.toISOString(), '2026-11-11T02:00:00.000Z', 'tomorrow 10:00 Beijing');
    assert.equal(task.description, '来自想法墙');
    await db.task.update({ where: { id: task.id }, data: { status: 'DONE', completedAt: new Date() } });
    assert.equal((await wall(actor)).notes.find(n => n.id === idea.id)?.status, 'DONE', 'the idea follows its task');

    const saved = await saveNote(actor, tip.id, { target: 'QUICK_REPLY' });
    assert.equal(saved.savedTo, 'QUICK_REPLY');
    const reply = await db.quickReply.findUniqueOrThrow({ where: { id: saved.savedId! } });
    assert.deepEqual([reply.ownerId, reply.zh], [me.id, tip.text]);
    await assert.rejects(saveNote(actor, tip.id, { target: 'MATERIAL' }), /只有截图/);

    const shot = await createImageNote(actor, new File([PNG], 'shot.png', { type: 'image/png' }), { text: `装柜照片 ${tag}` });
    assert.equal(shot.hasImage, true);
    assert.equal((await noteImage(actor, shot.id)).bytes.length, PNG.length);
    await assert.rejects(noteImage(stranger, shot.id), /不存在/);
    await assert.rejects(createImageNote(actor, new File(['x'], 'a.pdf', { type: 'application/pdf' }), {}), /PNG/);
    const material = await saveNote(actor, shot.id, { target: 'MATERIAL' });
    assert.equal(material.savedTo, 'MATERIAL');
    assert.equal((await db.salesMaterial.findUniqueOrThrow({ where: { id: material.savedId! } })).mimeType, 'image/png');

    await updateNote(actor, link.id, { archived: true });
    assert.equal((await wall(actor)).notes.some(n => n.id === link.id), false);
    assert.deepEqual((await wall(actor, { archived: '1' })).notes.map(n => n.id), [link.id], '收起来的 are kept, not deleted');
  } finally {
    const notes = await db.wallNote.findMany({ where: { userId: { in: [me.id, other.id] } }, select: { taskId: true, savedTo: true, savedId: true } });
    await db.task.deleteMany({ where: { id: { in: notes.flatMap(n => n.taskId ? [n.taskId] : []) } } });
    await db.quickReply.deleteMany({ where: { id: { in: notes.flatMap(n => n.savedTo === 'QUICK_REPLY' && n.savedId ? [n.savedId] : []) } } });
    await db.salesMaterial.deleteMany({ where: { id: { in: notes.flatMap(n => n.savedTo === 'MATERIAL' && n.savedId ? [n.savedId] : []) } } });
    await db.wallNote.deleteMany({ where: { userId: { in: [me.id, other.id] } } });
    await db.user.deleteMany({ where: { id: { in: [me.id, other.id] } } });
    if (before === undefined) delete process.env.MEDIA_STORAGE_DIR; else process.env.MEDIA_STORAGE_DIR = before;
    await rm(dir, { recursive: true, force: true });
  }
});

test('每日一签 service: once a day, the same sign on every ask, folded away, judged in the evening, kept in the week book', async () => {
  const tag = randomUUID().slice(0, 8);
  const me = await db.user.create({ data: { name: `Sign ${tag}`, email: `sign-${tag}@example.test`, passwordHash: 'x', role: 'SALES' } });
  const actor = { id: me.id, name: me.name, email: me.email, role: 'SALES' } as never;
  const morning = at('2026-11-10T00:05:00Z'), evening = at('2026-11-10T13:40:00Z'); // 08:05 and 21:40 Beijing
  try {
    await db.wallNote.create({ data: { userId: me.id, kind: 'QUOTE', text: '结硬寨，打呆仗。', source: '曾国藩', color: 'cream' } });
    await db.dailySign.create({ data: { userId: me.id, day: '2026-11-09', topic: 'MOOD', signNo: 1, grade: '大吉', content: {}, verdict: 'YES' } });
    let v = await dailySign(actor, morning);
    assert.equal(v.sign, null);
    assert.equal(v.streak, 1, 'yesterday counts until today is drawn');
    assert.equal(v.week[0].grade, '大吉', 'Monday is in the book');
    await assert.rejects(drawToday(actor, { topic: 'NOPE' }, morning), /先选今天想问什么/);

    v = await drawToday(actor, { topic: 'DEAL' }, morning);
    assert.equal(v.sign?.topic, 'DEAL');
    const first = v.sign!.content;
    assert.ok(['大吉', '中吉', '吉'].includes(first.grade));
    assert.deepEqual(first.gift, { text: '结硬寨，打呆仗。', source: '曾国藩' }, '赠言 comes from my wall');
    assert.equal(v.streak, 2);
    v = await drawToday(actor, { topic: 'MOOD' }, morning);
    assert.deepEqual([v.sign?.topic, v.sign?.content.no], ['DEAL', first.no], 'one sign a day: asking again changes nothing');
    assert.equal(await db.dailySign.count({ where: { userId: me.id, day: '2026-11-10' } }), 1);

    v = await updateSign(actor, { action: 'collect' }, morning);
    assert.equal(v.sign?.collected, true);
    assert.equal(v.canCheck, false);
    await assert.rejects(updateSign(actor, { action: 'verdict', verdict: 'YES' }, morning), /21:30 以后再来对签/);

    v = await dailySign(actor, evening);
    assert.equal(v.canCheck, true);
    assert.match(v.check ?? '', /今天没有新订单 · 跟进了 0 位报过价的客户/);
    v = await updateSign(actor, { action: 'verdict', verdict: 'YES' }, evening);
    assert.equal(v.sign?.verdict, 'YES');
    assert.equal(v.cameTrue, 2);
    assert.deepEqual(v.week.slice(0, 2).map(d => [d.grade !== '', d.verdict]), [[true, 'YES'], [true, 'YES']]);
    assert.equal(v.week[1].today, true);
  } finally {
    await db.dailySign.deleteMany({ where: { userId: me.id } });
    await db.wallNote.deleteMany({ where: { userId: me.id } });
    await db.user.delete({ where: { id: me.id } });
  }
});
