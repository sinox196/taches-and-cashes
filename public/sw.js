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

const LEGACY_TIMER_TAG = 'active-timer';

self.addEventListener('install', () => self.skipWaiting());

/*
 * Claiming clients, plus transitional cleanup: the chronometer notification
 * this worker used to draw was created with `requireInteraction: true`, so
 * the OS keeps it on screen until something closes it. The code that closed
 * it went with the feature, which would leave a notification frozen at its
 * last time — above buttons that now reach a route that no longer exists —
 * on every device that had one showing. Closing it here catches those before
 * any page even loads. Safe to delete once every device has updated.
 */
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  await self.clients.claim();
  try {
    const stale = await self.registration.getNotifications({ tag: LEGACY_TIMER_TAG });
    stale.forEach((n) => n.close());
  } catch (e) {
    /* nothing to clean up */
  }
})()));

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
    // A chronometer push from a server still running the old build (its
    // 15-minute sweep keeps sending these until it is redeployed). Don't
    // draw it — and take down any it drew before, since this push is the
    // one moment the worker is guaranteed to be awake without a page open.
    // That is what stops a stale server re-showing a notification the user
    // asked to be rid of.
    if (payload.elapsed || payload.closed) {
      const stale = await self.registration.getNotifications({ tag: LEGACY_TIMER_TAG });
      stale.forEach((n) => n.close());
      return;
    }
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

  // A leftover chronometer notification from before that feature was
  // removed. Its Pause / Arrêter went to a route that no longer exists, so
  // closing it (above) is the whole response — don't also drag the user into
  // the app they deliberately left.
  if (data.timer) return;
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
