import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db';
import type { Actor } from '../lib/auth';
import { explainGraphError, graphGet } from '../lib/meta-graph';
import { metaLeadHealth } from '../services/meta-lead-intake-service';

const token = 'EAAdiagnosisPageToken0123456789abcdef', appId = 'diag-app', appSecret = 'diag-secret', pageId = 'diag-page';
const permissionError = { code: 100, error_subcode: 33, message: "Unsupported get request. Object with ID '123' does not exist, cannot be loaded due to missing permissions, or does not support this operation." };

test('Graph failures keep Meta\'s reason, never the credential, and map to steps an administrator can take', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => Response.json({ error: { code: 200, message: `(#200) Requires leads_retrieval permission; token ${token}` } }, { status: 403 })) as typeof fetch;
    const result = await graphGet('123', token, { fields: 'id' });
    assert.equal(result.ok, false);
    const error = result.ok ? '' : result.error;
    assert.match(error, /^GRAPH_ERROR HTTP 403 code 200 subcode unknown: \(#200\) Requires leads_retrieval permission/);
    assert.ok(!error.includes(token));
  } finally { globalThis.fetch = original; }

  assert.match(explainGraphError('GRAPH_ERROR HTTP 403 code 200 subcode unknown: (#200) Requires leads_retrieval permission')!.cause, /没有读取线索内容的权限/);
  const access = explainGraphError('Graph API HTTP 400 code 100 subcode 33: Unsupported get request.')!;
  assert.match(access.cause, /线索访问权限/);
  assert.ok(access.fix.some(step => step.includes('Leads Access')));
  assert.match(explainGraphError('TOKEN_EXPIRED HTTP 401 code 190 subcode 463: Session has expired')!.cause, /Token 已失效/);
  assert.match(explainGraphError('Graph API HTTP 400 code 17 subcode unknown: User request limit reached')!.cause, /次数超限/);
  assert.match(explainGraphError('Graph API HTTP 400 code 100 subcode unknown: (#100) Tried accessing nonexisting field (foo)')!.cause, /字段/);
  assert.match(explainGraphError('GRAPH_NETWORK_OR_RESPONSE_ERROR')!.cause, /连不上/);
  assert.match(explainGraphError('Graph API HTTP 502: 请求失败')!.cause, /临时故障/);
  assert.equal(explainGraphError('Prisma P2002'), null);
});

test('the intake panel names why leads cannot be read and checks the token live', async () => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  const admin: Actor = await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' }, select: { id: true, name: true, email: true, role: true } });
  const tag = randomUUID().slice(0, 8), formId = `form-diag-${tag}`, leadgenId = `diag-${tag}`;
  const otherForms = await db.metaLeadForm.findMany({ where: { status: 'ACTIVE' }, select: { formId: true } });
  const jobs: string[] = [];
  Object.assign(process.env, { META_PAGE_ACCESS_TOKEN: token, META_PAGE_ID: pageId, META_APP_ID: appId, META_APP_SECRET: appSecret });
  await db.metaLeadForm.updateMany({ where: { formId: { in: otherForms.map(f => f.formId) } }, data: { status: 'PAUSED_FOR_TEST' } });
  try {
    await db.metaLeadForm.create({ data: { formId, pageId, name: `Diagnosis ${tag}`, status: 'ACTIVE', leadsCount: 5 } });
    const stored = `Graph API HTTP 400 code 100 subcode 33: ${permissionError.message}`;
    await db.metaLeadEvent.create({ data: { leadgenId, pageId, formId, rawPayload: {}, status: 'FAILED', error: stored, attempts: 3, nextAttemptAt: new Date(Date.now() + 60_000) } });
    jobs.push((await db.syncJob.create({ data: { provider: 'META', jobType: 'LEAD_POLL', status: 'PARTIAL', startedAt: new Date(Date.now() + 1000), completedAt: new Date(),
      error: `${formId}: GRAPH_ERROR HTTP 400 code 100 subcode 33: Unsupported get request.`,
      detail: { errors: [{ error: 'GRAPH_ERROR HTTP 400 code 100 subcode 33: Unsupported get request.', forms: 11 }] } } })).id);

    const stale = await metaLeadHealth(admin);
    assert.equal(stale.problems.length, 1, 'one cause, reported once');
    const [problem] = stale.problems;
    assert.match(problem.cause, /线索访问权限/);
    assert.ok(problem.sources.some(source => source.startsWith('线索入库')));
    assert.ok(problem.sources.includes('定时补拉（11 个表单）'));
    assert.ok(problem.errors.includes(stored));

    const seen: { path: string; auth: string | null; input: string | null }[] = [];
    let leadsReadable = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)), path = url.pathname.split('/').slice(2).join('/');
      seen.push({ path, auth: new Headers(init?.headers).get('Authorization'), input: url.searchParams.get('input_token') });
      if (path === 'me') return Response.json({ id: pageId, name: 'Diagnosis Page' });
      if (path === 'debug_token') return Response.json({ data: { app_id: appId, type: 'PAGE', is_valid: true, expires_at: 0, scopes: ['pages_show_list', 'pages_read_engagement'] } });
      if (path === `${pageId}/subscribed_apps`) return Response.json({ data: [{ id: appId, name: 'CRM', subscribed_fields: ['leadgen'] }] });
      if (path === leadgenId || path === `${formId}/leads`) return leadsReadable ? Response.json(path === leadgenId ? { id: leadgenId } : { data: [] }) : Response.json({ error: permissionError }, { status: 400 });
      return Response.json({ error: { code: 803, message: 'unexpected path' } }, { status: 404 });
    }) as typeof fetch;

    const live = await metaLeadHealth(admin, { live: true });
    const debug = seen.find(call => call.path === 'debug_token')!;
    assert.equal(debug.auth, `Bearer ${appId}|${appSecret}`, 'the token is inspected with the app token');
    assert.equal(debug.input, token);
    assert.ok(live.live?.permissions.ok && live.live.permissions.missing.includes('leads_retrieval'));
    assert.ok(live.alerts.some(alert => alert.includes('leads_retrieval')));
    assert.deepEqual(live.live?.leadRead.map(check => check.ok), [false, false]);
    assert.ok(live.problems[0].sources.some(source => source.startsWith('检测连接')));

    leadsReadable = true;
    const fixed = await metaLeadHealth(admin, { live: true });
    assert.deepEqual(fixed.live?.leadRead.map(check => check.ok), [true, true]);
  } finally {
    globalThis.fetch = original;
    for (const key of ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID', 'META_APP_ID', 'META_APP_SECRET']) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await db.metaLeadEvent.deleteMany({ where: { leadgenId } });
    await db.syncJob.deleteMany({ where: { id: { in: jobs } } });
    await db.metaLeadForm.deleteMany({ where: { formId } });
    await db.metaLeadForm.updateMany({ where: { status: 'PAUSED_FOR_TEST' }, data: { status: 'ACTIVE' } });
    await db.$disconnect();
  }
});
