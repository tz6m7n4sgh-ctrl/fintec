import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_TTL_MS,
  challengeIsFresh,
  counterAccepted,
  deviceLabelFor,
  fromBase64Url,
  relyingPartyFrom,
  toBase64Url,
} from './passkeys';

/**
 * The parts of the ceremony that are decisions rather than cryptography.
 *
 * The cryptography is exercised against a real authenticator in
 * `e2e/passkeys.spec.ts` — a unit test of a signature check is a unit test of
 * `@simplewebauthn/server`. What is worth testing here is everything this
 * project decided: which counters are acceptable, what an unset origin does,
 * and whether the two places that say "two minutes" agree.
 */

describe('counterAccepted', () => {
  it('accepts a counter that moved forward', () => {
    expect(counterAccepted(4, 5)).toBe(true);
    expect(counterAccepted(0, 1)).toBe(true);
  });

  it('rejects a counter that went backwards', () => {
    // Two things are signing with one private key. This is the only signal
    // WebAuthn gives that a credential has been cloned.
    expect(counterAccepted(9, 3)).toBe(false);
  });

  it('rejects a repeat of the same non-zero counter', () => {
    /*
     * A replayed assertion carries the counter it was signed with. "Not lower"
     * would let it through, which is why the rule is "higher" everywhere except
     * the always-zero case below.
     */
    expect(counterAccepted(7, 7)).toBe(false);
  });

  it('accepts zero from an authenticator that always reports zero', () => {
    /*
     * Apple's platform authenticators and most synced passkeys never increment,
     * because a credential that exists on several devices cannot keep a
     * meaningful count. Requiring a strict increase would lock those users out
     * permanently on their *second* sign-in — the feature working exactly once.
     */
    expect(counterAccepted(0, 0)).toBe(true);
  });

  it('holds a credential to strict increase once it has ever counted', () => {
    // Falling back to zero after reporting 3 is not "an authenticator that does
    // not count"; it is a different authenticator.
    expect(counterAccepted(3, 0)).toBe(false);
  });
});

describe('challengeIsFresh', () => {
  const now = new Date('2026-08-03T10:00:00Z');

  it('accepts a challenge that has not expired', () => {
    expect(challengeIsFresh('2026-08-03T10:01:00Z', now)).toBe(true);
  });

  it('rejects one that has', () => {
    expect(challengeIsFresh('2026-08-03T09:59:59Z', now)).toBe(false);
  });

  it('rejects the exact moment of expiry rather than allowing it', () => {
    expect(challengeIsFresh('2026-08-03T10:00:00Z', now)).toBe(false);
  });

  it('rejects a timestamp it cannot read', () => {
    /*
     * An unparseable date must not read as "no expiry". `new Date('nonsense')`
     * gives NaN, and every comparison with NaN is false — including `expiry <
     * now`, which is how a naive version of this returns "fresh" for garbage.
     */
    expect(challengeIsFresh('not a date', now)).toBe(false);
  });
});

describe('CHALLENGE_TTL_MS', () => {
  it('is the two minutes the database also uses', () => {
    // Migration 0014 defaults `expires_at` to now() + interval '2 minutes'. If
    // these drift, the browser gives up before the row does or the other way
    // round, and the symptom is an intermittent "expired" on a live challenge.
    expect(CHALLENGE_TTL_MS).toBe(2 * 60 * 1000);
  });
});

describe('relyingPartyFrom', () => {
  it('reads an id and a list of origins', () => {
    expect(
      relyingPartyFrom({ rpId: 'fintec.app', origins: 'https://fintec.app, https://www.fintec.app' }),
    ).toEqual({ rpId: 'fintec.app', origins: ['https://fintec.app', 'https://www.fintec.app'] });
  });

  it('refuses rather than defaulting when the id is unset', () => {
    /*
     * The tempting default is the request's own Origin header, which works in
     * every test and makes the origin check meaningless — the attacker supplies
     * the header. An unset variable has to be an error for that reason.
     */
    expect(() => relyingPartyFrom({ rpId: '', origins: 'https://fintec.app' })).toThrow(
      /PASSKEY_RP_ID/,
    );
  });

  it('refuses when the origin list is unset or empty', () => {
    expect(() => relyingPartyFrom({ rpId: 'fintec.app', origins: '' })).toThrow(/PASSKEY_ORIGINS/);
    expect(() => relyingPartyFrom({ rpId: 'fintec.app', origins: ' , , ' })).toThrow(
      /PASSKEY_ORIGINS/,
    );
  });

  it('treats a missing variable the same as an empty one', () => {
    // Next inlines an unset variable as the empty string in some contexts and
    // leaves it undefined in others. Both must fail closed.
    expect(() => relyingPartyFrom({ rpId: null, origins: null })).toThrow();
    expect(() => relyingPartyFrom({})).toThrow();
  });
});

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    expect(Array.from(fromBase64Url(toBase64Url(bytes)))).toEqual(Array.from(bytes));
  });

  it('emits no character that would need escaping in a URL or a JSON body', () => {
    const bytes = new Uint8Array([251, 255, 190, 239]);
    expect(toBase64Url(bytes)).not.toMatch(/[+/=]/);
  });

  it('decodes input whose padding was stripped', () => {
    // Every credential id from a browser arrives unpadded. A decoder that needs
    // padding fails on the real input and passes on any fixture generated by
    // its own encoder, which is the worst combination available.
    expect(new TextDecoder().decode(fromBase64Url('YQ'))).toBe('a');
    expect(new TextDecoder().decode(fromBase64Url('YWI'))).toBe('ab');
    expect(new TextDecoder().decode(fromBase64Url('YWJj'))).toBe('abc');
  });

  it('round-trips a user id, which is what the user handle carries', () => {
    const uuid = 'abe825fc-f779-476b-8903-49cf66ca629e';
    const encoded = toBase64Url(new TextEncoder().encode(uuid));
    expect(new TextDecoder().decode(fromBase64Url(encoded))).toBe(uuid);
  });
});

describe('deviceLabelFor', () => {
  it('names the authenticator, not the browser', () => {
    expect(deviceLabelFor(['internal'])).toBe('This device');
    expect(deviceLabelFor(['hybrid'])).toBe('Phone or tablet');
    expect(deviceLabelFor(['usb'])).toBe('Security key');
    expect(deviceLabelFor(['nfc'])).toBe('Security key');
  });

  it('prefers the more specific transport when several are reported', () => {
    // A platform authenticator that also advertises hybrid is still this
    // device, and calling it "Phone or tablet" would point the revoke list at
    // the wrong object.
    expect(deviceLabelFor(['hybrid', 'internal'])).toBe('This device');
  });

  it('falls back to something true rather than something specific', () => {
    expect(deviceLabelFor([])).toBe('Passkey');
    expect(deviceLabelFor(undefined)).toBe('Passkey');
    expect(deviceLabelFor(['something-new'])).toBe('Passkey');
  });
});
