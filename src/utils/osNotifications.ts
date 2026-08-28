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

/**
 * Takes down a chronometer notification left over from before that feature
 * was removed.
 *
 * It was drawn with `requireInteraction: true`, which means the OS keeps it
 * on screen until something closes it — and the code that used to do that
 * went with the feature. So a notification already showing when a device
 * last ran the old build stays there indefinitely, frozen at whatever time
 * it last displayed, above Pause / Arrêter buttons that now reach a route
 * that no longer exists.
 *
 * Called once on app start. Safe and cheap when there is nothing to close,
 * and safe to delete once every device has opened the app at least once —
 * it is transitional cleanup, not part of any feature.
 */
const LEGACY_TIMER_TAG = 'active-timer';

export async function closeLingeringTimerNotification(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    // `ready` rather than `getRegistration()`: the latter can resolve before
    // the worker is active, and a registration without one has no
    // notifications to hand back — which looked like "nothing to clean up"
    // on exactly the cold start where the leftover is most likely.
    const registration = swRegistration ?? (await navigator.serviceWorker.ready);
    const open = await registration?.getNotifications({ tag: LEGACY_TIMER_TAG });
    open?.forEach(n => n.close());
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Registers this device for Web Push — how an ordinary notification (task
 * assigned, a leave decision, a new message, sent from notify()/the message
 * route in server.ts) reaches a device with the browser fully closed, at
 * which point no page script runs and it has to come from the server.
 *
 * It deliberately no longer carries the running chronometer: that ongoing
 * notification, with its Pause / Arrêter buttons, was removed at the user's
 * request.
 *
 * Safe to call repeatedly: an existing subscription is reused, and the
 * server upserts on the endpoint. Silently does nothing when push is not
 * configured or the browser refuses — the in-page path above keeps working
 * regardless.
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

/**
 * Drops this device's subscription server-side on logout, so a shared
 * machine stops receiving the previous user's chronometer and notifications.
 * Does not unsubscribe the browser's own PushManager — a colleague logging
 * in right after would otherwise have to wait out a fresh permission prompt
 * for a capability the browser already granted to this site.
 */
export async function unsubscribeFromPush(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch {
    /* the row is pruned server-side on its next 404/410 either way */
  }
}
