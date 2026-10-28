import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { radarSecretValid } from '../lib/secret';
import { createSearches, deleteSearch, radarSettings, saveRadarConfig, updateSearch } from '../services/radar-config-service';
import { crawlPlan, ingestProspects, reportCrawl } from '../services/radar-ingest-service';
import { scoreProspects, verifyEmails } from '../services/radar-scoring-service';
import { listProspects, updateProspect } from '../services/radar-prospect-service';
import { DEFAULT_RADAR_CONFIG } from '../lib/radar';
import { deleteTestCustomers } from './identity-test-cleanup';

const actorOf = (u: { id: string; name: string; email: string; role: string }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function withEnv<T>(values: Record<string, string>, run: () => Promise<T>) {
  const saved = { ...process.env };
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('radar intake: keyword plan, deduplicated ingest, existing customers skipped, scoring, e-mail checks, card wall', async t => {
  const tag = randomUUID().replace(/-/g, '').slice(0, 8);
  const setting = await db.setting.findUniqueOrThrow({ where: { id: 'system' }, select: { radarConfig: true } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } });
  const sales = await db.user.create({ data: { name: `Radar ${tag}`, email: `radar-${tag}@example.com`, role: 'SALES', passwordHash: hashPassword('x') } });
  const boss = actorOf(admin), seller = actorOf(sales);
  const bos = await db.customer.create({ data: { name: `Radar BOS ${tag}`, companyName: `BOS Shop ${tag}`, ownerId: admin.id, email: `buyer@bos-${tag}.fr`,
    emailNormalized: `buyer@bos-${tag}.fr`, phone: '+33478009999', phoneE164: '+33478009999', contactKeysAt: new Date() } });
  const jobIds: string[] = [];
  try {
    await saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, searchesPerDay: 500 }, boss);
    await assert.rejects(saveRadarConfig({ ...DEFAULT_RADAR_CONFIG, intervalMin: 30, intervalMax: 10 }, boss), /最短间隔不能大于最长间隔/);
    await assert.rejects(saveRadarConfig(DEFAULT_RADAR_CONFIG, seller), (e: { status?: number }) => e.status === 403);

    // ── Keyword × city ──
    const added = await createSearches({ country: 'FR', cities: `Lyon${tag}\nParis${tag}`, keywords: `grossiste meuble, literie ${tag}` }, boss);
    assert.deepEqual(added, { created: 4, skipped: 0 });
    assert.deepEqual(await createSearches({ country: 'FR', cities: [`Lyon${tag}`], keywords: [`grossiste meuble`] }, boss), { created: 0, skipped: 1 });
    await assert.rejects(createSearches({ country: 'ZZ', cities: 'X', keywords: 'y' }, boss), /没有国家 ZZ/);
    await assert.rejects(createSearches({ country: 'FR', cities: 'X', keywords: 'y' }, seller), (e: { status?: number }) => e.status === 403);
    const searches = await db.radarSearch.findMany({ where: { city: { endsWith: tag } }, orderBy: [{ city: 'asc' }, { keyword: 'asc' }] });
    const lyon = searches.find(s => s.city === `Lyon${tag}` && s.keyword === 'grossiste meuble')!;
    const paris = searches.find(s => s.city === `Paris${tag}` && s.keyword === 'grossiste meuble')!;
    let plan = (await crawlPlan()).searches;
    assert.ok(searches.every(s => plan.some(p => p.id === s.id)), 'every new row is in the plan');
    assert.equal(plan.find(p => p.id === lyon.id)?.query, `grossiste meuble Lyon${tag}`);
    assert.equal(plan.find(p => p.id === lyon.id)?.language, 'fr');

    // ── Ingest ──
    await assert.rejects(ingestProspects({ searchId: 'nope', places: [{ placeKey: 'x', name: 'x' }] }), (e: { status?: number }) => e.status === 404);
    await assert.rejects(ingestProspects({ places: [{ placeKey: 'x', name: 'x' }] }), /缺少国家/);
    const site = `Bienvenue chez Meubles Dupont ${tag}. Nos 3 magasins à Lyon proposent canapés et literie depuis 1985.`;
    const batch = { searchId: lyon.id, places: [
      { placeKey: `p1-${tag}`, name: `Meubles Dupont ${tag}`, city: `Lyon${tag}`, website: `https://www.shop1-${tag}.fr/`, phone: '04 78 00 00 01', category: 'Magasin de meubles',
        rating: '4,6', reviewCount: 120, siteText: site, socials: { facebook: 'https://facebook.com/dupont', evil: 'javascript:alert(1)' },
        emails: [{ address: `mailto:Achat@Shop1-${tag}.fr`, foundOn: `https://www.shop1-${tag}.fr/contact` }, { address: `contact@shop1-${tag}.fr` }, { address: 'logo@2x.png' }] },
      { placeKey: `p2-${tag}`, name: `Dupont Literie ${tag}`, city: `Lyon${tag}`, website: `shop1-${tag}.fr`, emails: [{ address: `info@shop1-${tag}.fr` }] },
      { placeKey: `p3-${tag}`, name: `Phone Twin ${tag}`, city: `Lyon${tag}`, phone: '04 78 00 99 99' },
      { placeKey: `p4-${tag}`, name: `Domain Twin ${tag}`, city: `Lyon${tag}`, website: `https://bos-${tag}.fr` },
      { placeKey: `p5-${tag}`, name: `Restaurant ${tag}`, city: `Lyon${tag}`, category: 'Restaurant' },
      { placeKey: `p6-${tag}`, name: `Meubles Dupont ${tag} S.A.R.L.`, city: `Lyon${tag}` },
      { placeKey: `p7-${tag}`, name: `Canapés Martin ${tag}`, city: `Lyon${tag}`, website: `https://martin-${tag}.fr`, siteText: 'Canapés sur mesure',
        emails: [{ address: `vente@martin-${tag}.fr` }, { address: `contact@martin-${tag}.fr` }] },
    ] };
    assert.deepEqual(await ingestProspects(batch), { created: 3, duplicates: 2, inBos: 2 }, 'p2 and p6 are p1 again; p3 (phone) and p4 (domain) are customers');
    assert.deepEqual(await ingestProspects(batch), { created: 0, duplicates: 7, inBos: 0 }, 'the same batch twice changes nothing');
    const au = await ingestProspects({ country: 'AU', places: [{ placeKey: `p8-${tag}`, name: `Sleepwell ${tag}`, city: 'Perth', website: `https://sleepwell-${tag}.com.au`,
      emails: [{ address: `hello@sleepwell-${tag}.com.au` }] }] });
    assert.deepEqual(au, { created: 1, duplicates: 0, inBos: 0 });

    const byKey = async (key: string) => db.radarProspect.findUniqueOrThrow({ where: { placeKey: `${key}-${tag}` }, include: { emails: { orderBy: { address: 'asc' } } } });
    const p1 = await byKey('p1');
    assert.equal(p1.domain, `shop1-${tag}.fr`);
    assert.equal(p1.phoneE164, '+33478000001');
    assert.equal(Number(p1.rating), 4.6);
    assert.deepEqual(p1.socials, { facebook: 'https://facebook.com/dupont' }, 'only real social links are kept');
    assert.deepEqual(p1.emails.map(e => [e.address, e.kind]), [[`achat@shop1-${tag}.fr`, 'DIRECT'], [`contact@shop1-${tag}.fr`, 'GENERIC'], [`info@shop1-${tag}.fr`, 'GENERIC']],
      'the duplicate brought info@, the image name was dropped');
    assert.equal(p1.emails[0].foundOn, `https://www.shop1-${tag}.fr/contact`);
    assert.equal(p1.searchId, lyon.id);
    assert.equal(p1.timezone, 'Europe/Paris');
    assert.equal((await byKey('p3')).status, 'EXCLUDED', 'same phone as a customer');
    assert.match((await byKey('p3')).excludedReason, new RegExp(`^已在 BOS：BOS Shop ${tag}`));
    assert.equal((await db.radarProspect.findUnique({ where: { placeKey: `p4-${tag}` } }))?.status, 'EXCLUDED');
    assert.equal((await byKey('p5')).status, 'NO_EMAIL');
    assert.equal(await db.radarProspect.count({ where: { placeKey: `p6-${tag}` } }), 0);
    assert.equal((await byKey('p8')).timezone, 'Australia/Perth');

    // ── Run report ──
    const report = await reportCrawl({ status: 'DONE', startedAt: new Date(Date.now() - 60_000).toISOString(), searches: [{ id: lyon.id, found: 7 }] });
    jobIds.push(report.jobId);
    assert.equal(report.created, 5, 'p1, p3, p4, p5, p7 came from Lyon; p8 has no search');
    const ran = await db.radarSearch.findUniqueOrThrow({ where: { id: lyon.id } });
    assert.deepEqual([ran.lastFound, ran.lastNew, !!ran.lastRunAt], [7, 5, true]);
    plan = (await crawlPlan()).searches;
    assert.ok(plan.findIndex(p => p.id === paris.id) < plan.findIndex(p => p.id === lyon.id), 'rows that never ran come first');
    const captcha = await reportCrawl({ status: 'CAPTCHA', startedAt: new Date().toISOString(), error: `captcha ${tag}` });
    jobIds.push(captcha.jobId);
    assert.equal((await db.syncJob.findUniqueOrThrow({ where: { id: captcha.jobId } })).status, 'CAPTCHA');

    // ── Scoring (DeepSeek) and e-mail checks (MillionVerifier) ──
    assert.deepEqual(await withEnv({ DEEPSEEK_API_KEY: '' }, () => scoreProspects()), { scored: 0, failed: 0, skipped: 'DEEPSEEK_NOT_CONFIGURED' });
    let failures = 0;
    t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://deepseek.test/chat/completions') {
        const context = JSON.parse(JSON.parse(String(init?.body)).messages[1].content) as { name: string };
        const answer = (body: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] });
        if (context.name.startsWith('Meubles Dupont')) return answer({ customerType: 'WHOLESALER', mainProducts: '沙发、床垫', scores: { type: 40, category: 18, scale: 10, intent: 6 },
          reason: '里昂多店家具批发', facts: [{ fact: '里昂有 3 家门店', quote: 'Nos 3 magasins à Lyon' }, { fact: '编造的', quote: 'Nos 30 entrepôts à Paris' }] });
        if (context.name.startsWith('Restaurant')) return answer({ customerType: 'UNRELATED', mainProducts: '餐饮', scores: { type: 0, category: 0, scale: 5, intent: 0 }, reason: '餐厅', facts: [] });
        if (context.name.startsWith('Sleepwell')) { failures++; return Response.json({ error: { message: 'overloaded' } }, { status: 503 }); }
        return answer({ customerType: 'FURNITURE_STORE', mainProducts: '定制沙发', scores: { type: 30, category: 20, scale: 5, intent: 5 }, reason: '单店', facts: [] });
      }
      if (url.startsWith('https://api.millionverifier.com/api/v3/')) {
        const email = new URL(url).searchParams.get('email') ?? '';
        const result = email.startsWith('achat@') ? 'ok' : email.startsWith('contact@shop1') ? 'catch_all' : email.startsWith('vente@') ? 'invalid' : email.startsWith('contact@martin') ? 'invalid' : 'unknown';
        return Response.json({ result, subresult: 'test' });
      }
      return new Response('unexpected', { status: 500 });
    });
    await withEnv({ DEEPSEEK_API_KEY: 'test', DEEPSEEK_BASE_URL: 'https://deepseek.test', EMAIL_VERIFY_API_KEY: 'verify-test', EMAIL_VERIFY_PROVIDER: '' }, async () => {
      for (let run = 0; run < 4; run++) await scoreProspects(200);
      const scored = await byKey('p1');
      assert.equal(scored.customerType, 'WHOLESALER');
      assert.deepEqual(scored.scoreParts, { type: 40, category: 18, scale: 10, contactability: 13, intent: 6 }, 'contactability from the unchecked direct address');
      assert.deepEqual([scored.score, scored.grade], [87, 'A']);
      assert.deepEqual((scored.siteFacts as { fact: string }[]).map(f => f.fact), ['里昂有 3 家门店'], 'the made-up fact is dropped');
      const restaurant = await byKey('p5');
      assert.equal(restaurant.status, 'EXCLUDED');
      assert.match(restaurant.excludedReason, /^不是目标行业/);
      const failing = await byKey('p8');
      assert.deepEqual([failing.scoredAt, failing.scoreAttempts, failures], [null, 3, 3], 'three tries, then it waits for someone to retry');
      assert.match(failing.scoreError, /overloaded/);
      assert.equal((await byKey('p3')).scoredAt, null, 'excluded prospects are not scored');

      await verifyEmails(200);
      const checked = await byKey('p1');
      assert.deepEqual(checked.emails.map(e => [e.address.split('@')[0], e.verifyStatus]), [['achat', 'VALID'], ['contact', 'RISKY'], ['info', '']], 'two addresses checked, the third never paid for');
      assert.equal((checked.scoreParts as { contactability: number }).contactability, 15);
      assert.deepEqual([checked.score, checked.grade, checked.status], [89, 'A', 'NEW']);
      const martin = await byKey('p7');
      assert.deepEqual(martin.emails.map(e => e.verifyStatus), ['INVALID', 'INVALID']);
      assert.equal(martin.status, 'NO_EMAIL', 'no sendable address is left');
    });

    // ── Card wall ──
    await assert.rejects(listProspects(seller), (e: { status?: number }) => e.status === 403);
    const wall = await listProspects(boss, { q: tag });
    const names = wall.rows.map(r => r.name);
    assert.ok(names.includes(`Meubles Dupont ${tag}`) && names.includes(`Canapés Martin ${tag}`));
    assert.ok(!names.includes(`Phone Twin ${tag}`) && !names.includes(`Restaurant ${tag}`), 'excluded ones are not on the default wall');
    assert.equal(names[0], `Meubles Dupont ${tag}`, 'highest score first');
    const top = wall.rows[0];
    assert.deepEqual([top.email?.address, top.email?.verifyStatus, top.sendable, top.fact, top.typeLabel], [`achat@shop1-${tag}.fr`, 'VALID', true, '里昂有 3 家门店', '批发商']);
    assert.deepEqual((await listProspects(boss, { q: tag, grade: 'A' })).rows.map(r => r.name), [`Meubles Dupont ${tag}`]);
    assert.deepEqual((await listProspects(boss, { q: tag, email: 'SENDABLE' })).rows.map(r => r.name), [`Meubles Dupont ${tag}`]);
    assert.deepEqual((await listProspects(boss, { q: tag, email: 'NONE' })).rows.map(r => r.name).sort(), [`Canapés Martin ${tag}`]);
    assert.deepEqual((await listProspects(boss, { q: `shop1-${tag}` })).rows.length, 1, 'search covers the domain');
    assert.equal((await listProspects(boss, { q: tag, view: 'EXCLUDED' })).total, 3);
    assert.equal((await listProspects(boss, { q: tag, today: '1' })).total, wall.total);
    assert.equal((await listProspects(boss, { q: tag, page: 'abc', grade: 'Z' })).query.page, 1, 'bad query values fall back');

    // ── Actions ──
    await updateProspect(top.id, { action: 'exclude', reason: '不做这个城市' }, boss);
    assert.deepEqual(await db.radarProspect.findUniqueOrThrow({ where: { id: top.id }, select: { status: true, excludedReason: true } }), { status: 'EXCLUDED', excludedReason: '不做这个城市' });
    await assert.rejects(updateProspect(top.id, { action: 'exclude' }, boss), (e: { status?: number }) => e.status === 409);
    await updateProspect(top.id, { action: 'restore' }, boss);
    assert.equal((await byKey('p1')).status, 'NEW');
    const twin = await byKey('p3');
    await assert.rejects(updateProspect(twin.id, { action: 'restore' }, boss), /已经在客户库里/);
    const martin = await byKey('p7');
    await updateProspect(martin.id, { action: 'contacted', note: '电话联系过' }, boss);
    assert.deepEqual(await db.radarProspect.findUniqueOrThrow({ where: { id: martin.id }, select: { status: true, notes: true } }), { status: 'CONTACTED', notes: '电话联系过' });
    await updateProspect((await byKey('p8')).id, { action: 'rescore' }, boss);
    assert.deepEqual(await db.radarProspect.findUniqueOrThrow({ where: { placeKey: `p8-${tag}` }, select: { scoreAttempts: true, scoreError: true } }), { scoreAttempts: 0, scoreError: '' });
    await assert.rejects(updateProspect(top.id, { action: 'delete' }, boss), /操作无效/);
    await assert.rejects(updateProspect('missing', { action: 'exclude' }, boss), (e: { status?: number }) => e.status === 404);
    await assert.rejects(updateProspect(top.id, { action: 'exclude' }, seller), (e: { status?: number }) => e.status === 403);

    // ── Settings view and the crawler's key ──
    const view = await radarSettings(boss);
    assert.equal(view.searches.find(s => s.id === lyon.id)?.prospects, 5);
    await updateSearch(paris.id, { active: false }, boss);
    assert.ok(!(await crawlPlan()).searches.some(p => p.id === paris.id), 'inactive rows are not crawled');
    await deleteSearch(lyon.id, boss);
    assert.equal((await byKey('p1')).searchId, null, 'prospects stay when their row is deleted');
    await withEnv({ RADAR_INGEST_SECRET: 'radar-secret' }, async () => {
      assert.equal(radarSecretValid('radar-secret'), true);
      assert.equal(radarSecretValid('wrong'), false);
      assert.equal(radarSecretValid(null), false);
    });
    await withEnv({ RADAR_INGEST_SECRET: '' }, async () => assert.equal(radarSecretValid(''), false, 'no key configured: nobody gets in'));
  } finally {
    await db.radarProspect.deleteMany({ where: { name: { contains: tag } } });
    await db.radarSearch.deleteMany({ where: { city: { endsWith: tag } } });
    await db.syncJob.deleteMany({ where: { id: { in: jobIds } } });
    await db.setting.update({ where: { id: 'system' }, data: { radarConfig: setting.radarConfig ?? undefined } });
    if (setting.radarConfig === null) await db.$executeRaw`UPDATE Setting SET radarConfig = NULL WHERE id = 'system'`;
    await deleteTestCustomers({ where: { id: bos.id } });
    await db.user.delete({ where: { id: sales.id } });
  }
});
