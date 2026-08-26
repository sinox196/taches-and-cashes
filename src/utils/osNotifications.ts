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
