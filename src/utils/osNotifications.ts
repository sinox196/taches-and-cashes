/**
 * OS-level notifications — the toast the operating system draws, not an
 * in-page banner: bottom-right on Windows/macOS, the notification shade on
 * Android.
 *
 * Two things make this less trivial than `new Notification(...)`:
 *
 * 1. **Mobile needs a service worker.** On Android Chrome the `Notification`
 *    constructor throws (`Illegal constructor`); the only supported path is
 *    `registration.showNotification()`. So a worker is registered up front and
 *    preferred whenever it's available, with the constructor as the desktop
 *    fallback for browsers that have Notification but no SW (or a page served
 *    over plain http, where SW registration is refused).
 *
 * 2. **Permission must be asked for on a user gesture** to be reliable
 *    (Safari refuses otherwise), so `requestPermission` is exported for a
 *    button to call rather than fired automatically on load.
 *
 * Scope note: these fire only while the app is open, driven by the existing
 * notification poll. Delivery with the tab closed would need Web Push — VAPID
 * keys, a push subscription per device, and a server that can post to the push
 * service — which is a separate piece of infrastructure, not built here.
 */

let swRegistration: ServiceWorkerRegistration | null = null;

export const notificationsSupported = () =>
  typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = (): NotificationPermission =>
  notificationsSupported() ? Notification.permission : 'denied';

/** Registers the worker that lets mobile show notifications at all. */
export async function initOsNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js');
  } catch {
    // Registration is refused over plain http and in some privacy modes.
    // Desktop still works through the Notification constructor below.
    swRegistration = null;
  }
}

/** Must be called from a user gesture to be reliable across browsers. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface OsNotificationOptions {
  title: string;
  body: string;
  /** Which app section clicking it should open. */
  nav?: string;
  /** Collapses repeats of the same subject into one toast instead of stacking. */
  tag?: string;
}

export async function showOsNotification({ title, body, nav, tag }: OsNotificationOptions): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  const options: NotificationOptions = {
    body,
    tag,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { nav },
  };

  // Prefer the worker: it is the only path that works on mobile, and it is
  // what makes the toast clickable back into the right section.
  const registration = swRegistration ?? (('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null);
  if (registration) {
    try {
      await registration.showNotification(title, options);
      return;
    } catch {
      /* fall through to the constructor */
    }
  }

  try {
    new Notification(title, options);
  } catch {
    /* desktop-only API; nothing more to try */
  }
}

/* ------------------------------------------------------------------ *
 * The running chronometer, as an ongoing OS notification.
 *
 * This is what keeps the clock readable once the app is no longer on
 * screen — another window, a minimised browser, the phone's home screen.
 * It is shown only while the page is hidden and taken down the moment it
 * comes back, so it never duplicates the in-page floating card.
 *
 * Two honest limits, neither of them fixable from here:
 *  - Browsers clamp timers in a backgrounded page to roughly one tick a
 *    minute, so the time on the notification lags by up to a minute. It
 *    answers "still running, roughly how long" — not a live second hand.
 *  - With the browser fully closed no page script runs at all, so nothing
 *    refreshes it. A live clock there would need Web Push (or a native
 *    app), which is not built here.
 * ------------------------------------------------------------------ */

const TIMER_TAG = 'active-timer';

export interface TimerNotificationOptions {
  /** Pre-formatted HH:MM:SS — the caller already owns the formatting. */
  elapsed: string;
  client: string;
  subtitle?: string;
  running: boolean;
}

export async function showTimerNotification({ elapsed, client, subtitle, running }: TimerNotificationOptions): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;

  const registration = swRegistration ?? (('serviceWorker' in navigator) ? await navigator.serviceWorker.getRegistration() : null);
  // `actions` only exist on the service-worker path; the Notification
  // constructor silently ignores them, so a desktop browser without a
  // worker still gets the clock, just without the buttons.
  if (!registration) return;

  try {
    await registration.showNotification(`${elapsed} — ${running ? 'en cours' : 'en pause'}`, {
      body: [client, subtitle].filter(Boolean).join(' · '),
      tag: TIMER_TAG,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // Replaces the previous one in place instead of stacking a new toast
      // every refresh, and never re-alerts: this is a status line, not news.
      renotify: false,
      silent: true,
      requireInteraction: true,
      data: { timer: true, nav: 'Time Tracking' },
      actions: running
        ? [{ action: 'pause', title: 'Pause' }, { action: 'stop', title: 'Arrêter' }]
        : [{ action: 'resume', title: 'Reprendre' }, { action: 'stop', title: 'Arrêter' }],
    } as NotificationOptions);
  } catch {
    /* Notifications can be refused per-site at any time; nothing to retry. */
  }
}

/**
 * Registers this device for Web Push, which is what lets the chronometer
 * keep showing with the browser fully closed — at that point no page script
 * runs, so the notification has to come from the server.
 *
 * Safe to call repeatedly: an existing subscription is reused, and the
 * server upserts on the endpoint. Silently does nothing when push is not
 * configured or the browser refuses — the in-page and hidden-tab paths above
 * keep working regardless.
 */
export async function subscribeToPush(token: string): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const keyRes = await fetch('/api/push/public-key', { headers: { Authorization: `Bearer ${token}` } });
    const { key } = await keyRes.json();
    if (!key) return false; // VAPID not configured on this deployment.

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? (await registration.pushManager.subscribe({
      // Required by every browser: a push that shows nothing to the user is
      // not allowed, which suits us — every push here draws the clock.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    }));

    const raw = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: raw.endpoint, keys: raw.keys }),
    });
    return true;
  } catch {
    // Push is refused outright in several ordinary situations — private
    // windows, iOS Safari outside an installed PWA, a blocked push service.
    return false;
  }
}

/** VAPID keys travel as base64url; `applicationServerKey` wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export async function closeTimerNotification(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = swRegistration ?? (await navigator.serviceWorker.getRegistration());
    const open = await registration?.getNotifications({ tag: TIMER_TAG });
    open?.forEach(n => n.close());
  } catch {
    /* nothing to clean up */
  }
}
