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
  const data = event.notification.data || {};
  const action = event.action;

  // Pause / Reprendre / Arrêter pressed on the ongoing chronometer. The
  // worker cannot call the API itself — the JWT lives in the page's
  // localStorage, which a worker cannot read — so it hands the action to an
  // open window, which already knows how to apply it (optimistically, then
  // PUT). With no window open there is nothing to hand it to, so we open the
  // app instead of dropping the tap silently.
  //
  // Deliberately does NOT close the notification on pause/resume: the page
  // immediately redraws it in its new state, and closing first makes it
  // visibly blink out and back.
  if (data.timer && (action === 'pause' || action === 'resume' || action === 'stop')) {
    if (action === 'stop') event.notification.close();
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (existing) {
        existing.postMessage({ type: 'timer-action', action });
        return;
      }
      await self.clients.openWindow('/');
    })());
    return;
  }

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
    await self.clients.openWindow('/');
  })());
});
