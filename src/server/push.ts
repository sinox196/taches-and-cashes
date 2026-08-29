import webpush from 'web-push';

/**
 * Web Push — the only way the running chronometer can still be seen once the
 * browser is fully closed. With the browser gone no page script runs at all,
 * so nothing client-side can keep a clock alive; the notification has to be
 * sent *by the server*, which is what this does.
 *
 * Optional, exactly like SMTP in email.ts: with the VAPID variables unset
 * (local dev, or a deploy that hasn't configured them) `pushEnabled()` is
 * false and every send is a no-op, so no caller has to special-case it.
 *
 * What it can and cannot do, so nobody "fixes" it later by mistake:
 *  - It cannot tick. Each push redraws the notification with the time as of
 *    that moment; between pushes the figure is simply stale. A per-second
 *    push would be one message per second per running task to a third-party
 *    push service — not something to attempt.
 *  - iOS only delivers Web Push to a site installed to the Home Screen
 *    (iOS 16.4+). In a plain Safari tab there is nothing to deliver to.
 *  - A device that is off or offline gets nothing; the push service queues
 *    briefly and then drops it. This is a status display, not a guarantee.
 */

let configured = false;

export function initPush(): boolean {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not set — the chronometer will not reach a closed browser.');
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:support@taches-and-cash.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    configured = true;
    console.log('[push] Web Push enabled.');
  } catch (error) {
    console.error('[push] Invalid VAPID configuration:', error);
    configured = false;
  }
  return configured;
}

export const pushEnabled = () => configured;

export const publicKey = () => process.env.VAPID_PUBLIC_KEY || null;

export interface PushResult {
  /** The subscription is permanently gone and its row should be deleted. */
  expired: boolean;
}

export async function sendPush(subscription: any, payload: unknown): Promise<PushResult> {
  if (!configured) return { expired: false };
  try {
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      JSON.stringify(payload),
      // Replaces any still-queued push for the same device instead of
      // delivering a burst of stale clocks when a phone comes back online.
      { TTL: 15 * 60, topic: 'chrono', urgency: 'low' } as any,
    );
    return { expired: false };
  } catch (error: any) {
    // 404/410 is the push service saying this subscription no longer exists
    // (app uninstalled, site data cleared). Anything else is transient —
    // a dropped connection, a rate limit — and must not delete the row.
    const status = error?.statusCode;
    if (status === 404 || status === 410) return { expired: true };
    console.error('[push] send failed:', status || error?.message || error);
    return { expired: false };
  }
}
