import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { sessionUser, token, type Actor } from '../lib/auth';
import { appVersion, markNotificationsSeen, notificationSeen } from '../services/mobile-app-service';
import { signOutOtherDevices } from '../services/sales-account-service';
import { businessCockpit } from '../services/business-cockpit-service';

const actorOf = (u: { id: string; name: string; email: string; role: string }): Actor => ({ id: u.id, name: u.name, email: u.email, role: u.role });

test('检查更新：没配置就不提示；版本号、版本代码和 https 下载地址齐全才提示；平台只认 harmony / android', () => {
  assert.deepEqual(appVersion('harmony', {}), { platform: 'harmony', latest: null, minVersionCode: null });
  const env = {
    MOBILE_HARMONY_VERSION: ' 1.3.0 ', MOBILE_HARMONY_VERSION_CODE: '1003000', MOBILE_HARMONY_URL: 'https://avenlee.online/lvanjubos/',
    MOBILE_HARMONY_NOTES: '数据分析加入趋势图', MOBILE_HARMONY_MIN_VERSION_CODE: '1001000',
  };
  assert.deepEqual(appVersion('harmony', env), {
    platform: 'harmony', minVersionCode: 1001000,
    latest: { versionName: '1.3.0', versionCode: 1003000, url: 'https://avenlee.online/lvanjubos/', notes: '数据分析加入趋势图' },
  });
  // A plain-http or missing download page offers nothing rather than a broken link.
  assert.equal(appVersion('harmony', { ...env, MOBILE_HARMONY_URL: 'http://avenlee.online/app' }).latest, null);
  assert.equal(appVersion('harmony', { ...env, MOBILE_HARMONY_VERSION_CODE: 'abc' }).latest, null);
  // Each platform reads its own settings.
  assert.equal(appVersion('android', env).latest, null);
  assert.throws(() => appVersion('ios', env));
});

test('提醒已读：各设备共用一个时间点，只往后移、不超过现在', async () => {
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  await db.notificationSeen.deleteMany({ where: { userId: sales.id } });
  try {
    assert.deepEqual(await notificationSeen(sales), { seenAt: null });
    const now = new Date('2026-11-11T08:00:00.000Z');
    assert.deepEqual(await markNotificationsSeen(sales, { seenAt: '2026-11-11T07:00:00.000Z' }, now), { seenAt: '2026-11-11T07:00:00.000Z' });
    // An older phone cannot move the point back.
    assert.deepEqual(await markNotificationsSeen(sales, { seenAt: '2026-11-11T06:00:00+00:00' }, now), { seenAt: '2026-11-11T07:00:00.000Z' });
    // A phone clock ahead of the server stops at the server's now.
    assert.deepEqual(await markNotificationsSeen(sales, { seenAt: '2026-11-11T09:30:00.000Z' }, now), { seenAt: '2026-11-11T08:00:00.000Z' });
    await assert.rejects(markNotificationsSeen(sales, { seenAt: 'yesterday' }, now));
  } finally {
    await db.notificationSeen.deleteMany({ where: { userId: sales.id } });
  }
});

test('退出其他设备：旧登录凭证全部失效，当前设备拿到新的凭证继续使用', async () => {
  const row = await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } });
  const sales = actorOf(row);
  const before = token(row.id, row.sessionVersion);
  assert.equal((await sessionUser(before))?.id, row.id);
  const kept = await signOutOtherDevices(sales);
  assert.equal(kept.id, row.id);
  assert.equal(kept.sessionVersion, row.sessionVersion + 1);
  assert.equal(await sessionUser(before), null);
  assert.equal((await sessionUser(token(kept.id, kept.sessionVersion)))?.id, row.id);
  const audit = await db.accountAudit.findFirst({ where: { subjectId: row.id, action: 'SIGNED_OUT_OTHERS' }, orderBy: { createdAt: 'desc' } });
  assert.ok(audit);
});

test('App 数据页：驾驶舱接口给销售只看自己的客户，不给毛利', async () => {
  const sales = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'sales@example.com' } }));
  const admin = actorOf(await db.user.findUniqueOrThrow({ where: { email: 'admin@example.com' } }));
  const mine = await businessCockpit(sales, { range: 'quarter' });
  assert.equal(mine.scope, '个人');
  assert.equal(mine.kpis.grossProfit, null);
  assert.equal(mine.selected.range, 'quarter');
  assert.ok(Array.isArray(mine.trend.points) && mine.trend.points.length > 0);
  const team = await businessCockpit(admin, { range: 'year' });
  assert.equal(team.scope, '团队');
  assert.equal(team.trend.view, 'month');
  // The JSON the app reads: dates as strings, numbers as numbers.
  const json = JSON.parse(JSON.stringify(team)) as { selected: { start: unknown }; kpis: { periodRevenue: unknown } };
  assert.equal(typeof json.selected.start, 'string');
  assert.equal(typeof json.kpis.periodRevenue, 'number');
});
