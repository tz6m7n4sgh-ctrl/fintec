import { describe, expect, it } from 'vitest';
import { pushSupport, toStored, vapidKeyToBytes } from './push';

/**
 * US-47 / D3. Two things are defended here.
 *
 * The base64url decoding, because it fails *silently*: a key decoded with the
 * standard alphabet is accepted by `subscribe()` on some engines and yields a
 * subscription the sender can never deliver to. Nothing errors; reminders just
 * never arrive, on the channel whose whole point is arriving.
 *
 * And the reason push is unavailable, because "push is unavailable" covers four
 * different situations and helps with none of them. On iOS the real answer is
 * "install the app first", which is neither obvious nor discoverable.
 */

const env = (over: Partial<Parameters<typeof pushSupport>[0]> = {}) => ({
  configured: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  standalone: false,
  isIos: false,
  ...over,
});

describe('vapidKeyToBytes', () => {
  it('decodes a standard-alphabet key', () => {
    // "hello" -> aGVsbG8=
    expect(Array.from(vapidKeyToBytes('aGVsbG8'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles the url alphabet, which is the whole point', () => {
    /*
     * 0xFB 0xEF 0xBE decodes from '++++' in standard base64 and '----' in
     * base64url. `atob` rejects the second, so the substitution is required
     * rather than defensive — and VAPID keys are base64url.
     */
    const urlSafe = '--__';
    const standard = '++//';
    expect(Array.from(vapidKeyToBytes(urlSafe))).toEqual(
      Array.from(vapidKeyToBytes(standard)),
    );
  });

  it('adds the padding VAPID keys are published without', () => {
    // 65 bytes is the real length of an uncompressed P-256 public key, which
    // encodes to 87 base64url characters — not a multiple of four.
    const key = 'A'.repeat(87);
    expect(() => vapidKeyToBytes(key)).not.toThrow();
    expect(vapidKeyToBytes(key).length).toBe(65);
  });
});

describe('pushSupport', () => {
  it('allows push when everything is present', () => {
    expect(pushSupport(env())).toEqual({ ok: true });
  });

  it('names a missing deployment key, and says email is unaffected', () => {
    const r = pushSupport(env({ configured: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('no web-push key');
      expect(r.reason).toContain('Email reminders are unaffected');
    }
  });

  it('names an unsupporting browser separately from an unconfigured server', () => {
    // Different situations, different things to do. Merging them would tell a
    // Firefox user to go and set an environment variable.
    const r = pushSupport(env({ hasPushManager: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('does not support web push');
  });

  it('tells an iPhone user to install the app, which is the actual fix', () => {
    /*
     * iOS exposes `PushManager` in Safari and then rejects `subscribe()` with
     * nothing useful. Without this branch the user sees a generic failure and
     * concludes push is broken, when it is one Share-sheet tap away.
     */
    const r = pushSupport(env({ isIos: true, standalone: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Add to Home Screen');
  });

  it('allows push on an installed iOS app', () => {
    expect(pushSupport(env({ isIos: true, standalone: true }))).toEqual({ ok: true });
  });

  it('checks configuration before browser support', () => {
    // An unconfigured deployment is the operator's problem on every browser, so
    // it must not be reported as the browser's fault.
    const r = pushSupport(env({ configured: false, hasPushManager: false }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('no web-push key');
  });
});

describe('toStored', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ keys: { p256dh: 'P', auth: 'A' }, ...over }),
  });

  it('keeps exactly the three fields the sender needs', () => {
    expect(toStored(sub())).toEqual({
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'P', auth: 'A' },
    });
  });

  it('drops anything else the browser volunteers', () => {
    // Stored wholesale, a browser adding a field would silently put it in the
    // database — on a row that belongs to someone's financial account.
    const stored = toStored(sub({ expirationTime: 12345, vendorExtra: 'x' }));
    expect(Object.keys(stored ?? {})).toEqual(['endpoint', 'keys']);
  });

  it('refuses a subscription missing its keys rather than storing half of one', () => {
    /*
     * A stored subscription without `auth` cannot be encrypted to, so every
     * send against it fails — and the app would show push as enabled. Better to
     * refuse and let the user see it did not work.
     */
    expect(toStored({ endpoint: 'https://push.example/abc', toJSON: () => ({}) })).toBeNull();
  });
});
