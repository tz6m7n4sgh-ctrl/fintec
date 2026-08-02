/**
 * Web push subscription helpers (US-47 / US-44 / D3).
 *
 * Pure, so the base64url decoding below is testable without a browser — it is
 * the classic place this goes wrong, and it goes wrong silently: an
 * `applicationServerKey` decoded with the wrong alphabet is accepted by
 * `pushManager.subscribe()` on some engines and produces a subscription the
 * sender can never deliver to.
 */

/**
 * The VAPID public key, from the environment.
 *
 * Public by design — it ships in the client bundle and is sent to the push
 * service on every subscribe. The **private** half is the secret, and it lives
 * in Supabase's Edge Function secrets alongside `RESEND_API_KEY`, never here.
 * Generate a pair with `npx web-push generate-vapid-keys`.
 *
 * `||` rather than `??`: an unset variable inlines as the empty string in
 * Next's client bundle, not as undefined, so `??` would keep `''` and the
 * "configured" check below would pass on a deployment that has no key.
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

/** Whether this deployment can offer push at all. */
export function isPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

/**
 * Decodes a base64url VAPID key into the `Uint8Array` `subscribe()` wants.
 *
 * VAPID keys are base64**url** — `-` and `_` where standard base64 has `+` and
 * `/` — and unpadded. `atob` implements standard base64 and does not accept
 * either difference, so the substitution and the padding are both required
 * rather than defensive.
 */
export function vapidKeyToBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  /*
   * Backed by an explicit `ArrayBuffer`, not the default `ArrayBufferLike`.
   * `applicationServerKey` is typed as `BufferSource`, which excludes a
   * `SharedArrayBuffer`-backed view — so `new Uint8Array(n)` alone does not
   * satisfy it, and the alternative to allocating precisely here is an `as`
   * cast at the call site that would hide any real mismatch later.
   */
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Why push cannot be offered here, in words the user can act on.
 *
 * Each branch names something different to do about it. "Push is unavailable"
 * would cover all four and help with none — and on iOS the answer really is
 * *"install the app first"*, which is not obvious and not discoverable.
 */
export function pushSupport(env: {
  configured: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  standalone: boolean;
  isIos: boolean;
}): PushSupport {
  if (!env.configured) {
    return {
      ok: false,
      reason:
        'This deployment has no web-push key configured, so no browser can subscribe. Email reminders are unaffected.',
    };
  }
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) {
    return {
      ok: false,
      reason:
        'This browser does not support web push. Email reminders are unaffected — they are the guaranteed channel for exactly this reason.',
    };
  }
  /*
   * iOS only exposes push to an installed PWA, and gives no useful error if you
   * ask from Safari — `PushManager` exists, `subscribe()` rejects. Naming the
   * install step is the difference between a user getting push and a user
   * concluding it is broken.
   */
  if (env.isIos && !env.standalone) {
    return {
      ok: false,
      reason:
        'On iPhone and iPad, push only works once the app is installed. Tap Share, then "Add to Home Screen", open it from there, and come back to this screen.',
    };
  }
  return { ok: true };
}

/** What gets stored in `notification_prefs.push_subscription`. */
export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Narrows a `PushSubscription` to what the sender needs.
 *
 * Stored as the three fields rather than `subscription.toJSON()` wholesale, so
 * a browser that decides to include something extra does not silently put it in
 * the database. `expirationTime` is deliberately dropped: it is null in every
 * engine that ships today, and a stored null that later becomes a date would be
 * a field nothing reads.
 */
export function toStored(sub: {
  endpoint: string;
  toJSON: () => { keys?: Record<string, string> };
}): StoredSubscription | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!sub.endpoint || !p256dh || !auth) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}
