/*
 * Minimal service worker — exists only so notifications can be shown on
 * mobile. `new Notification()` is a desktop-only API: on Android Chrome the
 * constructor throws outright, and the supported path is
 * `registration.showNotification()`, which requires a registered worker.
 *
 * This worker deliberately does NOT cache anything. The app is not offline-
 * capable, and a stale-serving cache here would be a permanent source of
 * "why am I seeing an old build" bugs for no benefit.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/**
 * Ordinary notifications pushed by server.ts's notify()/message-send routes —
 * task assigned, leave decisions, HR requests, new messages. This is the only
 * path that still works once the browser is closed: no page is running then,
 * so nothing client-side could draw it.
 *
 * The running chronometer used to be pushed here too, as an ongoing
 * notification carrying Pause / Arrêter. It was removed at the user's
 * request — the app no longer puts the timer in front of someone who has
 * left it.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }

  event.waitUntil((async () => {
    if (payload.title) {
      // No visibility gate here: with the app open, NotificationBell.tsx's
      // own poll already draws the same notification from the same tag
      // (`notif-<id>` / `msg-<senderId>`), and the platform's own tag
      // matching collapses the two into one instead of stacking a second.
      await self.registration.showNotification(payload.title, {
        body: payload.body || '',
        tag: payload.tag,
        renotify: !!payload.tag,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        data: { nav: payload.nav || 'Dashboard' },
      });
    }
  })());
});

// Clicking the toast focuses an existing tab (rather than opening a second
// one) and tells the app which section the notification belongs to.
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};

  event.notification.close();
  const nav = data.nav;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'notification-click', nav });
      return;
    }
    // No tab open — the section has to travel in the URL instead of a
    // postMessage there's no window to receive it. App.tsx reads this once
    // on mount (there's no router in this app) and strips it.
    await self.clients.openWindow(nav ? `/?nav=${encodeURIComponent(nav)}` : '/');
  })());
});
