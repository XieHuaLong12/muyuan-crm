'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, dateTimeText } from '@/lib/client';
import type { MetaLeadHealth } from '@/services/meta-lead-intake-service';

const seconds = (value: number | null) => value === null ? '—' : value < 90 ? `${Math.round(value)} 秒` : `${Math.round(value / 60)} 分钟`;

/**
 * Administrator view of the ad lead pipeline: is every form submission reaching the CRM, how fast, and what
 * needs fixing. The webhook is the real-time path; the 5-minute poll recovers anything it missed.
 */
export function MetaLeadIntake({ timezone }: { timezone: string }) {
  const [health, setHealth] = useState<MetaLeadHealth>();
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [days, setDays] = useState(7);
  const load = useCallback(async (live = false) => {
    try { setHealth(await api<MetaLeadHealth>(`meta/leads${live ? '?live=1' : ''}`)); setError(''); }
    catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (key: string, action: () => Promise<string>) => {
    setBusy(key); setError(''); setMessage('');
    try { setMessage(await action()); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const live = health?.live;
  return (
    <section className="card full" id="meta-leads">
      <h3>Meta 广告线索接入</h3>
      <p className="muted">
        客户提交 Meta 表单后，Webhook 实时推送并立即建档（通常几秒）；每 5 分钟的定时补拉会把 Webhook 没送到的线索补回来。
        新线索进入待分配池，管理员分配后销售须在 {health?.adLeadFirstContactMinutes ?? 5} 分钟内首次联系（可在销售团队页调整）。
      </p>
      {!health && !error && <p className="muted">加载中…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {health && (
        <>
          {health.alerts.length ? (
            <ul className="notice" role="status">{health.alerts.map(alert => <li key={alert}>⚠ {alert}</li>)}</ul>
          ) : <div className="notice">● 线索接入正常</div>}
          <dl>
            <div><dt>今天收到</dt><dd>{health.today.received} 条（Webhook {health.today.viaWebhook} · 补拉 {health.today.viaPoll}）</dd></div>
            <div><dt>今天建档</dt><dd>新客户 {health.today.created} · 老客户再次留资 {health.today.linked} · 失败 {health.today.failed}</dd></div>
            <div><dt>提交到入库</dt><dd>中位 {seconds(health.latencySeconds.p50)} · 90% 在 {seconds(health.latencySeconds.p90)} 内（近 7 天 {health.latencySeconds.samples} 条）</dd></div>
            <div><dt>待分配</dt><dd>{health.pool.count} 位{health.pool.oldestAt ? ` · 最早 ${dateTimeText(health.pool.oldestAt, timezone)} 进入` : ''} <Link href="/customers?assign=pending">去分配 →</Link></dd></div>
            <div><dt>最近一次 Webhook 线索</dt><dd>{health.lastWebhookAt ? dateTimeText(health.lastWebhookAt, timezone) : '还没有收到'}</dd></div>
            <div><dt>最近一次定时补拉</dt><dd>{health.lastPoll ? `${dateTimeText(health.lastPoll.at, timezone)} · ${health.lastPoll.status === 'OK' ? '成功' : health.lastPoll.status === 'RUNNING' ? '进行中' : '部分失败'}` : '尚未运行'}</dd></div>
            <div><dt>自动重试中</dt><dd>{health.retrying} 条</dd></div>
          </dl>
          {live && (
            <dl>
              <div><dt>主页 Token</dt><dd>{live.token.ok ? `可用 · ${live.token.pageName ?? ''}${live.token.pageMatches === false ? '（不是 META_PAGE_ID 对应的主页）' : ''}` : `不可用 · ${live.token.error}`}</dd></div>
              <div><dt>leadgen 订阅</dt><dd>{!live.subscription ? '未配置 META_PAGE_ID，无法检测' : !live.subscription.ok ? `检测失败 · ${live.subscription.error}` : live.subscription.leadgen ? `已订阅（${live.subscription.appName ?? '本应用'}）` : live.subscription.appFound ? '本应用未订阅 leadgen' : '主页没有订阅本应用'}</dd></div>
            </dl>
          )}
          {health.forms.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th>表单</th><th>Meta 累计线索</th><th>CRM 已入库</th><th>最近补拉</th></tr></thead>
                <tbody>
                  {health.forms.map(f => (
                    <tr key={f.formId}><td>{f.name || f.formId}</td><td>{f.leadsCount}</td><td>{f.crmLeads}</td><td>{f.polledAt ? dateTimeText(f.polledAt, timezone) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">Meta 累计数包含接入 CRM 之前的线索，两列不必相等；补拉会读取最近 90 天内未入库的线索。</p>
            </div>
          )}
          {health.needsHuman.total > 0 && (
            <>
              <h3>需要人工处理（{health.needsHuman.total}）</h3>
              <ul>{health.needsHuman.rows.map(r => <li key={r.leadgenId}>{dateTimeText(r.createdAt, timezone)} · {r.error.slice(0, 80)}</li>)}</ul>
              <Link href="/analytics/data-quality">去认领留资 →</Link>
            </>
          )}
        </>
      )}
      <div className="inline-form meta-lead-actions">
        <button disabled={!!busy} onClick={() => run('live', async () => { await load(true); return '已完成连接检测'; })}>{busy === 'live' ? '检测中…' : '检测连接'}</button>
        <button className="primary" disabled={!!busy} onClick={() => run('poll', async () => {
          const r = await api<{ status: string; fetched: number; recovered: number; retried: number; failed: number; errors: unknown[] }>('meta/leads', 'POST', { action: 'poll', days });
          await load();
          return r.status === 'NOT_CONNECTED' ? '未配置 META_PAGE_ACCESS_TOKEN，无法补拉' : `读取 ${r.fetched} 条，补回 ${r.recovered} 条，重新导入 ${r.retried} 条，失败 ${r.failed} 条${r.errors.length ? `，${r.errors.length} 个表单读取失败` : ''}`;
        })}>{busy === 'poll' ? '补拉中…' : `补拉最近 ${days} 天`}</button>
        <select aria-label="补拉天数" value={days} onChange={e => setDays(Number(e.target.value))}>
          {[1, 7, 30, 90].map(d => <option key={d} value={d}>{d} 天</option>)}
        </select>
        <button disabled={!!busy} onClick={() => run('retry', async () => {
          const r = await api<{ succeeded: number; failed: number }>('meta/leads', 'POST', { action: 'retry' });
          await load();
          return `重试成功 ${r.succeeded} 条，仍失败 ${r.failed} 条`;
        })}>{busy === 'retry' ? '重试中…' : '立即重试失败线索'}</button>
        {live?.subscription?.ok && !live.subscription.leadgen && (
          <button disabled={!!busy} onClick={() => run('subscribe', async () => {
            await api('meta/leads', 'POST', { action: 'subscribe' });
            await load(true);
            return '已为主页订阅 leadgen，请用 Meta 线索测试工具提交一条测试线索确认';
          })}>{busy === 'subscribe' ? '订阅中…' : '订阅 leadgen'}</button>
        )}
      </div>
      {message && <p className="muted" role="status">{message}</p>}
    </section>
  );
}
