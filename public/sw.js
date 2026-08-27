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

const TIMER_TAG = 'active-timer';

/**
 * Two different senders share one push subscription per device: the
 * chronometer sweep (this comment's original subject) and, separately,
 * server.ts's notify()/message-send routes for ordinary notifications —
 * task assigned, leave decisions, HR requests, new messages. They are told
 * apart by shape, not by a type field: a chrono payload always carries
 * `elapsed` (or `closed: true`); anything else that carries a `title` is a
 * plain notification.
 *
 * Either way this is the only path that still works once the browser is
 * closed: no page is running then, so nothing client-side could draw this.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) { payload = {}; }

  event.waitUntil((async () => {
    if (payload.closed) {
      const open = await self.registration.getNotifications({ tag: TIMER_TAG });
      open.forEach((n) => n.close());
      return;
    }
    if (payload.elapsed) {
      // With the app open and on screen the floating card already shows all
      // of this; a system notification on top of it would be pure noise.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows.some((c) => c.visibilityState === 'visible')) return;
      await showTimerNotification(payload);
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

function showTimerNotification(payload) {
  return self.registration.showNotification(
    payload.elapsed + ' — ' + (payload.running ? 'en cours' : 'en pause'),
    {
      body: [payload.client, payload.subtitle].filter(Boolean).join(' · '),
      tag: TIMER_TAG,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // Replaces the previous one in place and never re-alerts: this is a
      // status line refreshed every 15 minutes, not fifteen pieces of news.
      renotify: false,
      silent: true,
      requireInteraction: true,
      data: { timer: true, nav: 'Time Tracking' },
      actions: payload.running
        ? [{ action: 'pause', title: 'Pause' }, { action: 'stop', title: 'Arrêter' }]
        : [{ action: 'resume', title: 'Reprendre' }, { action: 'stop', title: 'Arrêter' }],
    },
  );
}

/**
 * Applies a notification button with the browser closed — there is no page to
 * hand the action to, and the JWT lives in the page's localStorage, which a
 * worker cannot read. The subscription endpoint is the credential instead:
 * the server maps it back to its owner and acts only on that user's own task.
 */
async function applyTimerActionViaServer(action) {
  const subscription = await self.registration.pushManager.getSubscription();
  if (!subscription) return;
  const res = await fetch('/api/push/timer-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint, action }),
  });
  if (!res.ok) return;
  const { entry } = await res.json();
  // Redraw straight away rather than leaving the old state up until the next
  // 15-minute sweep; a stopped task closes the notification outright.
  if (entry) await showTimerNotification(entry);
  else {
    const open = await self.registration.getNotifications({ tag: TIMER_TAG });
    open.forEach((n) => n.close());
  }
}

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
      // A live page is the better applier: it already holds the JWT and
      // updates its own UI optimistically in the same gesture.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows[0]) {
        windows[0].postMessage({ type: 'timer-action', action });
        return;
      }
      // No page at all — the browser-closed case this whole feature exists
      // for. Go straight to the server rather than dropping the tap or
      // yanking the user into an app they deliberately left.
      await applyTimerActionViaServer(action);
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
    // No tab open — the section has to travel in the URL instead of a
    // postMessage there's no window to receive it. App.tsx reads this once
    // on mount (there's no router in this app) and strips it.
    await self.clients.openWindow(nav ? `/?nav=${encodeURIComponent(nav)}` : '/');
  })());
});
