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

// Clicking the toast focuses an existing tab (rather than opening a second
// one) and tells the app which section the notification belongs to.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const nav = event.notification.data && event.notification.data.nav;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'notification-click', nav });
      return;
    }
    await self.clients.openWindow('/');
  })());
});
