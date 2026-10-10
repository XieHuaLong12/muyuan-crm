'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Bootstrap } from '@/lib/types';
import type { NotificationFeed } from '@/services/notification-service';
import { activeWorkspace } from '@/lib/role-workspace';
import { Sidebar } from '@/components/ui/Sidebar';
import { Search } from '@/components/ui/bos';
import { LiveNotifications, NotificationControls } from '@/components/live-notifications';

// New leads must reach someone within minutes, so the feed refreshes every 20 seconds (every minute while the
// tab is in the background, where desktop notifications still fire). The full task sync is only a safety net
// (business events sync their own customer), so the browser asks for it at most every 15 minutes.
const VISIBLE_POLL_MS = 20_000, HIDDEN_POLL_MS = 60_000, SYNC_EVERY_MS = 15 * 60_000;
let lastSyncRequest = 0;

const minutesSince = (iso: string | null) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 60_000) : 0;

/** Pages that belong together (e.g. list and kanban of the same customers) share one sidebar entry and these tabs. */
function SectionTabs({ path, role }: { path: string; role: string }) {
  const active = activeWorkspace(path, role);
  if (!active?.section.tabs) return null;
  return (
    <nav className="bos-section-tabs" aria-label={`${active.section.label}页面`}>
      {active.section.tabs.map(tab => (
        <Link key={tab.href} href={tab.href} aria-current={active.tab?.href === tab.href ? 'page' : undefined}>{tab.label}</Link>
      ))}
    </nav>
  );
}

export function BOSShell({ boot, children }: { boot: Bootstrap; children: React.ReactNode }) {
  const path = usePathname();
  const [feed, setFeed] = useState<NotificationFeed>();
  const [error, setError] = useState('');
  const admin = boot.user.role === 'ADMIN';
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/notifications', { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!body.success) throw new Error('提醒暂时不可用');
        if (!controller.signal.aborted) { setFeed(body.data); setError(''); }
        if (!document.hidden && Date.now() - lastSyncRequest >= SYNC_EVERY_MS) {
          lastSyncRequest = Date.now();
          const sync = await fetch('/api/workflows/sync', { method: 'POST', signal: controller.signal });
          if (!sync.ok) throw new Error('自动任务同步暂时不可用');
        }
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, document.hidden ? HIDDEN_POLL_MS : VISIBLE_POLL_MS);
    }
    const wake = () => { if (!document.hidden) { clearTimeout(timer); void refresh(); } };
    document.addEventListener('visibilitychange', wake);
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, []);
  const counts = feed?.counts;
  const poolWait = minutesSince(counts?.poolOldestAt ?? null);
  const poolLate = !!counts?.pool && !!feed && poolWait >= feed.adLeadMinutes;
  const badges = admin
    ? { pool: counts ? { count: counts.pool, urgent: poolLate } : undefined }
    : { today: counts ? { count: counts.today, urgent: counts.todayOverdue > 0 } : undefined };
  return (
    <div className="bos bos-v2">
      <a className="bos-skip" href="#bos-main">跳到主要内容</a>
      <Sidebar name={boot.user.name} role={boot.user.role} badges={badges} />
      <div className="bos-main-frame">
        <div className="bos-topbar">
          <span className="bos-topbar-label">LVANJU <span>{admin ? '管理员 · 团队经营' : '销售 · 我的工作空间'}</span></span>
          <form action="/customers"><Search name="q" label={admin ? '搜索团队客户' : '搜索我的客户'} placeholder="搜索客户、公司或联系方式" /></form>
          {admin && !!counts?.pool && (
            <Link href="/customers?assign=pending" className={`bos-lead-notice${poolLate ? ' is-urgent' : ''}`} title={poolLate ? `最早的线索已等待 ${poolWait} 分钟` : undefined}>
              待分配 {counts.pool}{poolLate ? ` · 已等 ${poolWait} 分钟` : ''}
            </Link>
          )}
          {admin && !!counts?.pendingFirstContact && (
            <Link href="/sales?queue=new" className={`bos-lead-notice${counts.overdueFirstContact ? ' is-urgent' : ''}`}>
              待首联 {counts.pendingFirstContact}{counts.overdueFirstContact ? ` · 超时 ${counts.overdueFirstContact}` : ''}
            </Link>
          )}
          {!admin && !!counts?.today && (
            <Link href="/sales" className={`bos-lead-notice${counts.todayOverdue ? ' is-urgent' : ''}`} title="今日工作：待首联、到期跟进和到期待办的客户">
              今日待办 {counts.today}{counts.todayOverdue ? ` · 超时 ${counts.todayOverdue}` : ''}
            </Link>
          )}
          <NotificationControls />
        </div>
        {error && <p className="bos-sync-error" role="status">{error}，将在后台重试。</p>}
        <main id="bos-main" className="bos-main"><SectionTabs path={path} role={boot.user.role} />{children}</main>
      </div>
      <LiveNotifications userId={boot.user.id} items={feed?.items ?? []} />
    </div>
  );
}
