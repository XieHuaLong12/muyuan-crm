import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { handle, ok } from '@/lib/http';
import { requireUser, verifyPassword, token, HttpError, type Actor } from '@/lib/auth';
import { loginAllowed, recordLoginFailure, recordLoginSuccess, clientAddress } from '@/lib/login-throttle';
import {
  accessible, saveCustomer, addFollowUp, updateFollowUp, deleteFollowUp, addDeal, updateDeal, voidDeal, deleteCustomer,
} from '@/services/customer-service';
import { customerList, customerPreview } from '@/services/customer-list-service';
import { assignCustomers, saveLeadAssignMode } from '@/services/lead-assignment-service';
import { deliverLeadAlertsAfterResponse } from '@/lib/after-response';
import { createUserAccount, changeOwnPassword } from '@/services/sales-account-service';
import { allocateTargets, targetProgress } from '@/services/target-service';
import { workspaceBootstrap } from '@/services/sales-workspace-service';
import { batchCustomers, purgeCustomers } from '@/services/customer-batch-service';
import { previewMeta, commitMeta } from '@/services/meta-import-service';
import { translationSettings, saveTranslationSettings } from '@/services/meta-translation-service';
import { analyzeCustomerWithDeepSeek } from '@/services/deepseek-customer-service';

export const dynamic = 'force-dynamic';

const SESSION_MAX_AGE = 604800;
// Cross-site request checks for every API mutation live in middleware.ts.

/** Secure cookies whenever the browser talks HTTPS, including behind a TLS-terminating proxy. */
function secureCookie(req: NextRequest) {
  return req.nextUrl.protocol === 'https:'
    || req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'
    || process.env.COOKIE_SECURE === 'true';
}

function withSession(req: NextRequest, res: NextResponse, userId: string, sessionVersion: number) {
  res.cookies.set('crm_session', token(userId, sessionVersion), { httpOnly: true, sameSite: 'lax', secure: secureCookie(req), maxAge: SESSION_MAX_AGE, path: '/' });
  return res;
}

async function login(req: NextRequest) {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await req.json());
  const email = body.email.toLowerCase(), address = clientAddress(req.headers);
  if (!loginAllowed(email, address)) throw new HttpError(429, '尝试次数过多，请 15 分钟后重试');
  const u = await db.user.findUnique({ where: { email } });
  if (!u || !u.isActive || !verifyPassword(body.password, u.passwordHash)) {
    recordLoginFailure(email, address);
    throw new HttpError(401, '邮箱或密码错误');
  }
  recordLoginSuccess(email, address);
  return withSession(req, ok({ id: u.id, name: u.name, role: u.role }), u.id, u.sessionVersion);
}

async function customerDetail(id: string, user: Actor) {
  await accessible(id, user);
  return db.customer.findUnique({ where: { id }, include: {
    owner: { select: { name: true } },
    deals: { orderBy: { dealDate: 'desc' }, include: { order: { select: { id: true, orderNo: true, status: true } } } },
    followUps: { orderBy: { followUpAt: 'desc' } },
    stageHistory: { orderBy: { changedAt: 'desc' } },
    submissions: { orderBy: { ordinal: 'desc' } },
    whatsappMessages: user.role === 'ADMIN' ? { orderBy: { sentAt: 'desc' }, take: 50 } : false,
    intelligence: true,
  } });
}

/** /api/customers/... — path: [customers, id?, action?, subId?, subAction?] */
async function customers(req: NextRequest, user: Actor, path: string[]) {
  const [, id, action, subId, subAction] = path;
  const method = req.method;
  const body = async () => method === 'GET' ? {} : await req.json().catch(() => ({}));
  if (id === 'trash' && method === 'GET') {
    await requireUser(true);
    return ok(await db.customer.findMany({ where: { deletedAt: { not: null } }, include: { owner: { select: { name: true } } }, orderBy: { deletedAt: 'desc' } }));
  }
  if ((id === 'batch-delete' || id === 'batch-restore') && method === 'POST') {
    await requireUser(true);
    return ok(await batchCustomers(await body(), user, id === 'batch-restore'));
  }
  if (id === 'batch-purge' && method === 'POST') { await requireUser(true); return ok(await purgeCustomers(await body(), user)); }
  if (id === 'assign' && method === 'POST') { const assigned = await assignCustomers(await body(), user); deliverLeadAlertsAfterResponse(); return ok(assigned); }
  if (!id) {
    if (method === 'GET') return ok(await customerList(user, Object.fromEntries(req.nextUrl.searchParams)));
    if (method === 'POST') return ok(await saveCustomer(await body(), user), 201);
  }
  if (id && !action) {
    if (method === 'GET') return ok(await customerDetail(id, user));
    if (method === 'PUT') return ok(await saveCustomer(await body(), user, id));
    if (method === 'DELETE') return ok(await deleteCustomer(id, user));
  }
  if (action === 'preview' && method === 'GET') return ok(await customerPreview(id, user));
  if (action === 'analyze' && method === 'POST') return ok(await analyzeCustomerWithDeepSeek(id, user));
  if (action === 'followups') {
    if (!subId && method === 'POST') return ok(await addFollowUp(id, await body(), user), 201);
    if (subId && method === 'PATCH') return ok(await updateFollowUp(id, subId, await body(), user));
    if (subId && method === 'DELETE') return ok(await deleteFollowUp(id, subId, await body(), user));
  }
  if (action === 'deals') {
    if (!subId && method === 'POST') return ok(await addDeal(id, await body(), user), 201);
    if (subId && !subAction && method === 'PATCH') return ok(await updateDeal(id, subId, await body(), user));
    if (subId && subAction === 'void' && method === 'POST') return ok(await voidDeal(id, subId, await body(), user));
  }
  return null;
}

async function targets(req: NextRequest, id: string | undefined) {
  const q = req.nextUrl.searchParams;
  if (req.method === 'GET') {
    return ok(await db.salesTarget.findMany({ where: { year: Number(q.get('year') ?? new Date().getFullYear()) }, orderBy: [{ periodType: 'asc' }, { month: 'asc' }, { week: 'asc' }] }));
  }
  if (req.method === 'POST') {
    const v = z.object({ year: z.coerce.number().int().min(2000).max(2200), targetRevenue: z.coerce.number().finite().min(0).max(1e12), currency: z.enum(['CNY', 'USD', 'EUR']) }).parse(await req.json());
    await allocateTargets(v.year, v.targetRevenue, v.currency);
    return ok({ saved: true });
  }
  if (req.method === 'PUT' && id) {
    const v = z.object({ targetRevenue: z.coerce.number().finite().min(0).max(1e12) }).parse(await req.json());
    const target = await db.salesTarget.findUniqueOrThrow({ where: { id } });
    if (target.periodType === 'YEAR') await allocateTargets(target.year, v.targetRevenue, target.currency);
    else await db.salesTarget.update({ where: { id }, data: { targetRevenue: v.targetRevenue, manual: true } });
    return ok({ saved: true });
  }
  return null;
}

const settingsInput = z.object({
  companyName: z.string().min(1),
  currency: z.enum(['CNY', 'USD', 'EUR']),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }, '时区无效'),
});

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(async () => {
    const { path } = await ctx.params;
    const [resource, id] = path;
    const method = req.method;
    if (resource === 'auth' && id === 'login' && method === 'POST') return login(req);

    const user = await requireUser();
    if (['target-progress', 'targets', 'settings', 'users'].includes(resource) && user.role !== 'ADMIN') throw new HttpError(403, '需要管理员权限');
    if (resource === 'auth' && id === 'logout' && method === 'POST') { const res = ok({}); res.cookies.delete('crm_session'); return res; }
    if (resource === 'auth' && id === 'password' && method === 'POST') {
      const changed = await changeOwnPassword(await req.json(), user);
      return withSession(req, ok({ changed: true }), changed.id, changed.sessionVersion);
    }
    // The same bootstrap the server pages render with, so a refresh after saving settings has the same shape.
    if (resource === 'bootstrap' && method === 'GET') return ok(await workspaceBootstrap(user));
    if (resource === 'meta-import') {
      await requireUser(true);
      if (id === 'preview' && method === 'POST') return ok(await previewMeta(await req.json(), user));
      if (id === 'commit' && method === 'POST') { const committed = await commitMeta(await req.json(), user); deliverLeadAlertsAfterResponse(); return ok(committed); }
      if (id === 'translation' && method === 'GET') return ok(await translationSettings());
      if (id === 'translation' && method === 'PUT') return ok(await saveTranslationSettings(await req.json()));
    }
    if (resource === 'customers') { const res = await customers(req, user, path); if (res) return res; }
    if (resource === 'target-progress' && method === 'GET') return ok(await targetProgress(user, Object.fromEntries(req.nextUrl.searchParams)));
    if (resource === 'targets') { const res = await targets(req, id); if (res) return res; }
    if (resource === 'settings' && method === 'PUT' && id === 'lead-assignment') return ok(await saveLeadAssignMode(await req.json(), user));
    if (resource === 'settings' && method === 'PUT' && !id) {
      return ok(await db.setting.update({ where: { id: 'system' }, data: settingsInput.parse(await req.json()) }));
    }
    if (resource === 'users' && method === 'POST') return ok(await createUserAccount(await req.json(), user), 201);
    return NextResponse.json({ success: false, error: '接口不存在' }, { status: 404 });
  });
}

export { route as GET, route as POST, route as PUT, route as PATCH, route as DELETE };
