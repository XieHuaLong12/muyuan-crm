/*
 * Service worker for the installed phone app (see docs/MOBILE_APP.md).
 * It never caches pages or API data: customer data is private and must always be current. It only keeps an
 * offline page for when a page cannot load, and opens the right page when a notification is tapped.
 */
const CACHE = 'crm-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
    // Starts the page request while the worker boots, so pages are not slower than without a worker.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

// Only full page loads are handled; data requests and in-app navigation go straight to the network.
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      return preloaded || await fetch(event.request);
    } catch {
      return (await caches.match(OFFLINE_URL)) || Response.error();
    }
  })());
});

// A lead pushed by the server (services/push-service.ts) while the app may be closed. Good leads stay on screen
// until tapped and vibrate longer; the same tag replaces the page's own notification instead of doubling it.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: '新提醒', body: event.data ? event.data.text() : '' }; }
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.urgent),
    vibrate: data.urgent ? [500, 250, 500, 250, 500, 250, 500] : [200],
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    timestamp: data.at ? Date.parse(data.at) : Date.now(),
    data: { href: data.href || '/' },
  };
  event.waitUntil(self.registration.showNotification(data.title || '新提醒', options));
});

// The browser renewed this device's push address: register the new one (the CRM also re-registers on every visit).
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const options = event.oldSubscription && event.oldSubscription.options;
    if (!options) return;
    const subscription = await self.registration.pushManager.subscribe(options);
    await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription) });
  })());
});

// Notifications carry the page to open in data.href (components/live-notifications.tsx).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.href || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const focused = await client.focus();
        await focused.navigate(target.href);
        return;
      } catch {
        // This window cannot be focused or navigated; try the next one or open a new one.
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
