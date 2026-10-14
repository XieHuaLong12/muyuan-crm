/**
 * Server push on this device (Web Push), so lead alerts arrive while the CRM app is closed. The phone app
 * (Android; iPhone once added to the home screen, iOS 16.4+) and desktop browsers support it.
 */
const SESSION_KEY = 'crm:push-synced';

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(base64url: string) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
const sameKey = (current: ArrayBuffer | null | undefined, wanted: Uint8Array) =>
  !!current && current.byteLength === wanted.byteLength && new Uint8Array(current).every((byte, i) => byte === wanted[i]);

/**
 * Subscribes this device (or keeps its subscription) and tells the server which user it belongs to. Needs the
 * notification permission already granted. Safe to call on every visit: the server stores each device once.
 */
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const response = await fetch('/api/push', { cache: 'no-store' });
  const body = await response.json();
  if (!body.success) return false;
  const key = keyBytes(body.data.publicKey);
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another key (keys changed on the server) cannot receive pushes: replace it.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) { await subscription.unsubscribe(); subscription = null; }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const saved = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ }
  return saved.ok;
}

/** Once per browser session, quietly: re-registers devices whose address the browser renewed. */
export function syncPushSubscriptionOnce() {
  try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch { /* private mode */ }
  void syncPushSubscription().catch(() => { /* the page's own alerts still work */ });
}

/** Signing out: this device stops receiving the user's alerts (the next person to sign in registers it again). */
export async function forgetPushSubscription() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}
