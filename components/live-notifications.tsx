'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BellRing, Volume2, VolumeX, X } from 'lucide-react';
import type { NotificationItem } from '@/services/notification-service';
import { pushSupported, syncPushSubscription, syncPushSubscriptionOnce } from './push-notifications';

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
 * Phones (Android, the installed iPhone app) only show notifications through the service worker (public/sw.js),
 * which also opens item.href when one is tapped. Without a worker the page API is used, as desktop browsers allow.
 */
async function showSystemNotification(item: NotificationItem) {
  const options: NotificationOptions = { body: item.body, tag: item.tag ?? item.id, requireInteraction: item.urgent || item.ring === 'loop', icon: '/icons/icon-192.png', data: { href: item.href } };
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  if (registration?.active) return registration.showNotification(item.title, options);
  const n = new Notification(item.title, options);
  n.onclick = () => { window.focus(); window.location.href = item.href; n.close(); };
}

/**
 * A phone-like ring for a good new lead: four quick alternating tones, repeated by the pinned banner until someone
 * opens the lead or dismisses it. Vibrates too where the device allows it (Android).
 */
function ring() {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Context) {
      const ctx = new Context();
      [988, 1319, 988, 1319].forEach((frequency, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        osc.connect(gain); gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.16 + (i > 1 ? 0.25 : 0);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
        osc.start(start); osc.stop(start + 0.15);
      });
      setTimeout(() => void ctx.close(), 1200);
    }
    navigator.vibrate?.([400, 200, 400]);
  } catch { /* audio not available */ }
}

const RING_EVERY_MS = 4000, RING_FOR_MS = 3 * 60_000;

/**
 * Announces each feed item once per browser. Good new leads (ring 'loop') are pinned at the top and ring until
 * someone opens or dismisses them, or until they are handled elsewhere (e.g. another administrator assigned the
 * pooled lead); other items show a toast with one chime; D leads (ring 'none') stay quiet. With permission, a
 * system notification is shown as well (even when the tab is in the background). The seen list is shared by tabs.
 */
export function LiveNotifications({ userId, items: feedItems }: { userId: string; items: NotificationItem[] | undefined }) {
  const items = useMemo(() => feedItems ?? [], [feedItems]);
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const [pinned, setPinned] = useState<NotificationItem[]>([]);
  const [ringingSince, setRingingSince] = useState(0);
  const [muted, setMuted] = useState(false);
  const baseTitle = useRef('');
  const unread = useRef(0);
  const seenKey = `crm:seen-notifications:${userId}`;

  const pinnedKey = `crm:pinned-alerts:${userId}`;
  const dismiss = useCallback((id: string) => setToasts(list => list.filter(t => t.id !== id)), []);
  const unpin = useCallback((id: string) => setPinned(list => list.filter(t => t.id !== id)), []);

  // Pinned leads survive moving between pages (each page mounts its own shell) until handled or dismissed.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(pinnedKey) || 'null') as { items: NotificationItem[]; since: number } | null;
      if (saved?.items.length) { setPinned(saved.items); setRingingSince(saved.since); }
    } catch { /* storage unavailable */ }
  }, [pinnedKey]);
  useEffect(() => {
    try { window.sessionStorage.setItem(pinnedKey, JSON.stringify({ items: pinned, since: ringingSince })); } catch { /* storage unavailable */ }
  }, [pinned, ringingSince, pinnedKey]);

  useEffect(() => {
    baseTitle.current = document.title;
    const reset = () => { if (!document.hidden && unread.current) { unread.current = 0; document.title = baseTitle.current; } };
    document.addEventListener('visibilitychange', reset);
    return () => document.removeEventListener('visibilitychange', reset);
  }, []);

  // A pooled lead someone else has assigned leaves the feed: stop ringing for it. (Only judged once the feed has
  // loaded, so restored pins are not dropped before the first poll answers.)
  useEffect(() => {
    if (!feedItems) return;
    setPinned(list => list.filter(p => p.kind !== 'POOL_LEAD' || feedItems.some(item => item.id === p.id)));
  }, [feedItems]);

  useEffect(() => {
    if (!items.length) return;
    const seen = new Set(storage<string[]>(seenKey, []));
    const fresh = items.filter(item => !seen.has(item.id));
    if (!fresh.length) return;
    store(seenKey, [...fresh.map(item => item.id), ...seen].slice(0, SEEN_LIMIT));
    const announce = fresh.filter(item => Date.now() - Date.parse(item.at) < ANNOUNCE_WINDOW_MS && item.ring !== 'none');
    if (!announce.length) return;
    const urgentFirst = [...announce].sort((a, b) => Number(b.ring === 'loop') - Number(a.ring === 'loop') || Number(b.urgent) - Number(a.urgent) || b.at.localeCompare(a.at));
    const ringing = urgentFirst.filter(item => item.ring === 'loop');
    if (ringing.length) {
      setPinned(list => [...ringing, ...list.filter(p => !ringing.some(r => r.id === p.id))].slice(0, 20));
      setRingingSince(Date.now());
      setMuted(false);
    }
    // The message center already lists new customer messages; there they only chime (and notify while hidden).
    const onInbox = window.location.pathname === '/messages' && !document.hidden;
    const toastable = urgentFirst.filter(item => item.ring !== 'loop' && !(onInbox && item.kind === 'NEW_MESSAGE'));
    const shown = toastable.slice(0, MAX_TOASTS - (toastable.length > MAX_TOASTS ? 1 : 0));
    const rest = toastable.length - shown.length;
    const summary: NotificationItem[] = rest > 0 ? [{ id: `summary:${Date.now()}`, kind: 'TASK_DUE', title: `还有 ${rest} 条新提醒`, body: '打开任务中心查看全部', href: '/tasks', at: new Date().toISOString(), urgent: false }] : [];
    if (shown.length) setToasts(list => [...shown, ...summary, ...list.filter(t => !announce.some(a => a.id === t.id))].slice(0, MAX_TOASTS));
    if (!ringing.length && storage<string>(SOUND_KEY, 'on') !== 'off') chime(announce.some(item => item.urgent));
    if (document.hidden) {
      unread.current += announce.length;
      document.title = `(${unread.current}) ${announce[0].title} · ${baseTitle.current}`;
    }
    if (notificationsSupported() && Notification.permission === 'granted') {
      const desktop = urgentFirst.length > MAX_DESKTOP
        ? [...urgentFirst.slice(0, MAX_DESKTOP - 1), { ...urgentFirst[0], id: `summary:${Date.now()}`, tag: undefined, title: `${urgentFirst.length} 条新提醒`, body: urgentFirst.slice(0, 3).map(i => i.title).join('、'), href: urgentFirst[0].href }]
        : urgentFirst;
      for (const item of desktop) showSystemNotification(item).catch(() => { /* the in-page toast and chime still announce it */ });
    }
  }, [items, seenKey]);

  // The ring repeats while a good lead is pinned, for up to three minutes after the latest one arrived.
  useEffect(() => {
    if (!pinned.length || muted || storage<string>(SOUND_KEY, 'on') === 'off') return;
    const tick = () => { if (Date.now() - ringingSince < RING_FOR_MS) ring(); };
    tick();
    const timer = setInterval(tick, RING_EVERY_MS);
    return () => clearInterval(timer);
  }, [pinned.length, muted, ringingSince]);

  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts(list => list.slice(0, -1)), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toasts]);

  return (
    <>
      {!!pinned.length && (
        <div className="bos-lead-banner" role="alert" aria-label="新线索提醒">
          {pinned.slice(0, 3).map(t => (
            <div key={t.id} className={`bos-lead-banner-item${t.urgent ? ' is-urgent' : ''}`}>
              <BellRing size={18} aria-hidden className="bos-lead-banner-bell" />
              <Link href={t.href} onClick={() => unpin(t.id)}><strong>{t.title}</strong><span>{t.body}</span></Link>
              <Link className="bos-lead-banner-go" href={t.href} onClick={() => unpin(t.id)}>去处理</Link>
              <button type="button" aria-label="稍后处理" title="稍后处理" onClick={() => unpin(t.id)}><X size={15} /></button>
            </div>
          ))}
          <div className="bos-lead-banner-foot">
            {pinned.length > 3 && <span>还有 {pinned.length - 3} 条新线索</span>}
            {!muted && <button type="button" onClick={() => setMuted(true)}><VolumeX size={14} />停止响铃</button>}
          </div>
        </div>
      )}
      {!!toasts.length && (
        <div className="bos-live-toasts" role="region" aria-label="实时提醒" aria-live="polite">
          {toasts.map(t => (
            <div key={t.id} className={`bos-live-toast${t.urgent ? ' is-urgent' : ''}`}>
              <Link href={t.href} onClick={() => dismiss(t.id)}><strong>{t.title}</strong><span>{t.body}</span></Link>
              <button type="button" aria-label="关闭提醒" onClick={() => dismiss(t.id)}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Asks for notification permission (needs a click), registers this device for server push so alerts arrive while
 * the app is closed, and toggles the sound. Devices that already allowed notifications re-register quietly.
 */
export function NotificationControls() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [sound, setSound] = useState(true);
  useEffect(() => {
    const current = notificationsSupported() ? Notification.permission : 'unsupported';
    setPermission(current);
    setSound(storage<string>(SOUND_KEY, 'on') !== 'off');
    if (current === 'granted') syncPushSubscriptionOnce();
  }, []);
  return (
    <>
      {permission === 'default' && (
        <button type="button" className="bos-topbar-link bos-notify-enable" title={pushSupported() ? 'App 关着也能收到新线索提醒' : undefined} onClick={async () => {
          const result = await Notification.requestPermission();
          setPermission(result);
          if (result === 'granted') void syncPushSubscription().catch(() => { /* the page's own alerts still work */ });
        }}>
          <BellRing size={14} />开启通知
        </button>
      )}
      {permission === 'denied' && <span className="bos-notify-denied" title="已拒绝通知：在浏览器地址栏左侧的网站设置，或手机的「设置 → 通知」里允许">通知已关闭</span>}
      <button type="button" className="bos-icon-button bos-notify-sound" aria-pressed={sound} aria-label={sound ? '关闭提示音' : '开启提示音'} title={sound ? '关闭提示音' : '开启提示音'}
        onClick={() => { const next = !sound; setSound(next); store(SOUND_KEY, next ? 'on' : 'off'); if (next) chime(false); }}>
        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
    </>
  );
}
