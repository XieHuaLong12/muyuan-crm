'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, Volume2, VolumeX, X } from 'lucide-react';
import type { NotificationItem } from '@/services/notification-service';

const SEEN_LIMIT = 400;
// Events older than this when first seen (e.g. opening the app in the morning) are listed, not announced.
const ANNOUNCE_WINDOW_MS = 6 * 3600_000;
const TOAST_MS = 20_000;
// A burst (first visit of the day, or many events at once) shows the newest few and one summary.
const MAX_TOASTS = 3, MAX_DESKTOP = 2;
const SOUND_KEY = 'crm:notify-sound';

function storage<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function store(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage can be unavailable */ }
}

/** Two short tones; browsers may block audio until the user has interacted with the page. */
function chime(urgent: boolean) {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    (urgent ? [880, 1175] : [660]).forEach((frequency, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = frequency;
      osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.start(start); osc.stop(start + 0.17);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch { /* audio not available */ }
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Announces each feed item once per browser: an in-page toast, a chime and, with permission, a desktop
 * notification (shown even when the tab is in the background). The seen list is shared by all tabs.
 */
export function LiveNotifications({ userId, items }: { userId: string; items: NotificationItem[] }) {
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const baseTitle = useRef('');
  const unread = useRef(0);
  const seenKey = `crm:seen-notifications:${userId}`;

  const dismiss = useCallback((id: string) => setToasts(list => list.filter(t => t.id !== id)), []);

  useEffect(() => {
    baseTitle.current = document.title;
    const reset = () => { if (!document.hidden && unread.current) { unread.current = 0; document.title = baseTitle.current; } };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const seen = new Set(storage<string[]>(seenKey, []));
    const fresh = items.filter(item => !seen.has(item.id));
    if (!fresh.length) return;
    store(seenKey, [...fresh.map(item => item.id), ...seen].slice(0, SEEN_LIMIT));
    const announce = fresh.filter(item => Date.now() - Date.parse(item.at) < ANNOUNCE_WINDOW_MS);
    if (!announce.length) return;
    const urgentFirst = [...announce].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.at.localeCompare(a.at));
    const shown = urgentFirst.slice(0, MAX_TOASTS - (urgentFirst.length > MAX_TOASTS ? 1 : 0));
    const rest = urgentFirst.length - shown.length;
    const summary: NotificationItem[] = rest > 0 ? [{ id: `summary:${Date.now()}`, kind: 'TASK_DUE', title: `还有 ${rest} 条新提醒`, body: '打开任务中心查看全部', href: '/tasks', at: new Date().toISOString(), urgent: false }] : [];
    setToasts(list => [...shown, ...summary, ...list.filter(t => !announce.some(a => a.id === t.id))].slice(0, MAX_TOASTS));
    if (storage<string>(SOUND_KEY, 'on') !== 'off') chime(announce.some(item => item.urgent));
    if (document.hidden) {
      unread.current += announce.length;
      document.title = `(${unread.current}) ${announce[0].title} · ${baseTitle.current}`;
    }
    if (notificationsSupported() && Notification.permission === 'granted') {
      const desktop = urgentFirst.length > MAX_DESKTOP
        ? [...urgentFirst.slice(0, MAX_DESKTOP - 1), { ...urgentFirst[0], id: `summary:${Date.now()}`, title: `${urgentFirst.length} 条新提醒`, body: urgentFirst.slice(0, 3).map(i => i.title).join('、'), href: urgentFirst[0].href }]
        : urgentFirst;
      for (const item of desktop) {
        try {
          const n = new Notification(item.title, { body: item.body, tag: item.id, requireInteraction: item.urgent });
          n.onclick = () => { window.focus(); window.location.href = item.href; n.close(); };
        } catch { /* some mobile browsers only allow notifications from a service worker */ }
      }
    }
  }, [items, seenKey]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts(list => list.slice(0, -1)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="bos-live-toasts" role="region" aria-label="实时提醒" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`bos-live-toast${t.urgent ? ' is-urgent' : ''}`}>
          <Link href={t.href} onClick={() => dismiss(t.id)}><strong>{t.title}</strong><span>{t.body}</span></Link>
          <button type="button" aria-label="关闭提醒" onClick={() => dismiss(t.id)}><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}

/** Asks for desktop notification permission (needs a click) and toggles the chime. */
export function NotificationControls() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [sound, setSound] = useState(true);
  useEffect(() => {
    setPermission(notificationsSupported() ? Notification.permission : 'unsupported');
    setSound(storage<string>(SOUND_KEY, 'on') !== 'off');
  }, []);
  return (
    <>
      {permission === 'default' && (
        <button type="button" className="bos-topbar-link bos-notify-enable" onClick={async () => setPermission(await Notification.requestPermission())}>
          <BellRing size={14} />开启桌面通知
        </button>
      )}
      {permission === 'denied' && <span className="bos-notify-denied" title="浏览器已拒绝通知：请在地址栏左侧的网站设置中允许通知">桌面通知已关闭</span>}
      <button type="button" className="bos-icon-button bos-notify-sound" aria-pressed={sound} aria-label={sound ? '关闭提示音' : '开启提示音'} title={sound ? '关闭提示音' : '开启提示音'}
        onClick={() => { const next = !sound; setSound(next); store(SOUND_KEY, next ? 'on' : 'off'); if (next) chime(false); }}>
        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
    </>
  );
}
