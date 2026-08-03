// GENERATED FILE — do not edit.
//
// Copied from lib/auth/ by scripts/vendor-engine.mjs so the deployed
// function behaves exactly as the app and its tests do. Edit the source and
// re-run the script; vendor-engine.test.ts fails if this copy is out of date.
/**
 * WebAuthn passkeys (US-40 / FR-K2 / BR-8 / R-4).
 *
 * ## Why this module is shared rather than written twice
 *
 * The ceremony runs in two places. The Edge Function verifies assertions under
 * the service-role key and mints sessions; the tests drive a real virtual
 * authenticator in Chromium and check the same code accepts what a browser
 * actually produces. If those were two implementations they would drift, and a
 * WebAuthn verifier that drifts does not fail loudly — it accepts something it
 * should have refused. So this file is the only implementation, and
 * `scripts/vendor-engine.mjs` copies it into the function for Deno.
 *
 * ## What actually protects the account
 *
 * The Edge Function behind this can mint a session for any user id. That makes
 * it the most dangerous piece of code in the repository, and four checks are
 * what stand between it and account takeover:
 *
 *   1. **The user id comes from the stored credential**, looked up by the
 *      credential id the authenticator returned. It is never read from the
 *      request body. A caller cannot ask to be signed in as somebody else
 *      because there is nowhere in the protocol to say who they are.
 *   2. **The challenge is consumed by deletion** before verification proceeds,
 *      and the delete's row count is the proof it was unused. A replayed
 *      assertion finds no row and stops there.
 *   3. **Origin and RP ID come from configuration**, never from the request.
 *      Trusting the `Origin` header would let any site relay a ceremony.
 *   4. **The signature counter must not go backwards.** That is the one check
 *      that distinguishes a cloned credential from the real one.
 *
 * ## R-4: a passkey is never the sole factor
 *
 * Two things enforce that, and neither is a comment. Email-and-password
 * sign-in always remains, so losing every passkey is not losing the account —
 * see `app/auth/actions.ts`. And `userVerification: 'required'` throughout
 * means the authenticator itself must have checked a biometric or a PIN, so a
 * stolen phone is not a stolen account. A ceremony that comes back with
 * `userVerified: false` is rejected rather than downgraded.
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@13.3.2';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from 'npm:@simplewebauthn/server@13.3.2';

/** Shown by the authenticator when it asks the user to confirm. */
export const RP_NAME = 'Fintec';

/**
 * How long a challenge is good for, in milliseconds.
 *
 * Two minutes: long enough to find a fingerprint reader, short enough that a
 * challenge captured in transit is worthless before anyone could use it. The
 * database has the same figure as a column default; this is the copy the
 * ceremony hands to the browser, and `passkeys.test.ts` asserts they agree.
 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Where this relying party lives.
 *
 * `rpId` is the domain the credential is bound to. `origins` is the exact set
 * of origins an assertion may come from — plural because preview deployments
 * and localhost are different origins from production, and singular in spirit
 * because every entry is one more site that can complete a ceremony.
 */
export interface RelyingParty {
  rpId: string;
  origins: string[];
}

/**
 * Reads the relying party out of configuration, or refuses.
 *
 * There is an obvious convenience here that is a vulnerability: deriving the
 * origin from the request's `Origin` header. It works in every test, it needs
 * no configuration, and it makes the origin check meaningless — the attacker
 * supplies the header. So an unset variable is an error and not a default, and
 * the message says which variable, because a WebAuthn deployment that silently
 * half-works is worse than one that will not start.
 */
export function relyingPartyFrom(env: {
  rpId?: string | null;
  origins?: string | null;
}): RelyingParty {
  const rpId = (env.rpId ?? '').trim();
  const origins = (env.origins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (!rpId) throw new Error('PASSKEY_RP_ID is not set, so no origin can be trusted.');
  if (origins.length === 0) {
    throw new Error('PASSKEY_ORIGINS is not set, so no origin can be trusted.');
  }

  return { rpId, origins };
}

/* ------------------------------------------------------------------ *
 * Bytes
 * ------------------------------------------------------------------ */

/**
 * base64url, hand-rolled rather than imported.
 *
 * `@simplewebauthn/server/helpers` exports this, but reaching a package
 * subpath is one more thing the Deno copy has to resolve, and the whole
 * function is six lines. `btoa`/`atob` exist in Node, Deno and the browser.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The `<ArrayBuffer>` argument is load-bearing rather than decorative: a plain
 * `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which includes views over a
 * `SharedArrayBuffer` and so does not satisfy the `BufferSource` that
 * `verifyAuthenticationResponse` wants. Allocating the buffer explicitly says
 * what is true instead of casting it away.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * The checks that matter
 * ------------------------------------------------------------------ */

/**
 * Whether a new signature counter is acceptable.
 *
 * The counter is the only clone detection WebAuthn has: an authenticator
 * increments it on every assertion, so a value that does not move forward means
 * two things are signing with the same private key.
 *
 * The subtlety is that a large family of authenticators — every Apple platform
 * one, and most passkeys synced through a password manager — always report
 * zero, because a credential that lives in several places at once cannot keep a
 * meaningful count. Requiring a strict increase would lock those users out
 * permanently on their second sign-in, which is why the zero case is allowed
 * explicitly rather than by rounding the rule down to "not lower".
 *
 * Once a credential has ever reported a non-zero counter it is held to strict
 * increase, including against a repeat of the same value — a replayed assertion
 * carries the counter it was signed with.
 */
export function counterAccepted(stored: number, next: number): boolean {
  if (stored === 0 && next === 0) return true;
  return next > stored;
}

/** Whether a challenge issued at `expiresAt` is still usable. */
export function challengeIsFresh(expiresAt: string | Date, now: Date): boolean {
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() > now.getTime();
}

/**
 * A name the user can tell two passkeys apart by, for the revoke list.
 *
 * Derived from the transports the authenticator reported rather than from the
 * user agent: the user agent describes the browser that ran the ceremony, and
 * the thing being named is the authenticator. A phone used as a security key
 * over Bluetooth reports `hybrid` from a laptop's Chrome, and calling it
 * "Chrome on macOS" would be a label pointing at the wrong object.
 */
export function deviceLabelFor(transports: readonly string[] | undefined): string {
  const set = new Set(transports ?? []);
  if (set.has('internal')) return 'This device';
  if (set.has('hybrid')) return 'Phone or tablet';
  if (set.has('usb') || set.has('nfc') || set.has('ble')) return 'Security key';
  return 'Passkey';
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

export interface StoredCredential {
  /** base64url, exactly as the authenticator reports it. */
  credentialId: string;
  /** base64url of the COSE public key. */
  publicKey: string;
  counter: number;
  transports: string[];
  userId: string;
}

/**
 * Options for creating a passkey.
 *
 * `excludeCredentials` carries what the user already has, so an authenticator
 * they have already enrolled says "you already have one of these" instead of
 * quietly creating a second credential the revoke list then shows twice with
 * no way to tell apart.
 *
 * `residentKey: 'required'` is what makes sign-in possible without typing an
 * email first — the credential is discoverable, so the authenticator can offer
 * it before anyone has said who they are. Without it the sign-in screen would
 * need an email box, and the passkey would be saving one field rather than a
 * password.
 */
export async function registrationOptions(args: {
  rp: RelyingParty;
  userId: string;
  userName: string;
  existing: readonly { credentialId: string; transports: string[] }[];
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: args.rp.rpId,
    userID: new TextEncoder().encode(args.userId),
    userName: args.userName,
    // No attestation. Verifying it would mean maintaining a list of trusted
    // authenticator models, and this app has no reason to care which vendor
    // made the key — only that the same one comes back next time.
    attestationType: 'none',
    timeout: CHALLENGE_TTL_MS,
    excludeCredentials: args.existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

/**
 * Checks an attestation and returns what to store, or throws.
 *
 * Throws rather than returning a flag deliberately: every caller of this is one
 * `if` away from writing a credential row, and a falsy return that someone
 * forgets to check writes an unverified public key into the table that then
 * signs people in forever.
 */
export async function verifyRegistration(args: {
  rp: RelyingParty;
  userId: string;
  response: RegistrationResponseJSON;
  expectedChallenge: string;
}): Promise<Omit<StoredCredential, 'userId'> & { userId: string }> {
  const result = await verifyRegistrationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: args.rp.origins,
    expectedRPID: args.rp.rpId,
    requireUserVerification: true,
  });

  if (!result.verified || !result.registrationInfo) {
    throw new Error('The passkey could not be verified.');
  }

  const { credential } = result.registrationInfo;

  return {
    credentialId: credential.id,
    publicKey: toBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: (credential.transports ?? []) as string[],
    userId: args.userId,
  };
}

/* ------------------------------------------------------------------ *
 * Authentication
 * ------------------------------------------------------------------ */

/**
 * Options for signing in with a passkey.
 *
 * No `allowCredentials`, on purpose. Listing them would mean knowing who is
 * signing in before they have proved anything, which turns the sign-in screen
 * into an account-enumeration oracle: ask for a passkey by email, and the
 * length of the list says whether that email has an account. Discoverable
 * credentials let the authenticator answer instead.
 */
export async function authenticationOptions(
  rp: RelyingParty,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: rp.rpId,
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required',
  });
}

export interface AssertionResult {
  userId: string;
  credentialId: string;
  newCounter: number;
}

/**
 * Checks an assertion and returns whose account it proves, or throws.
 *
 * The returned `userId` is the credential row's, never the request's. That is
 * the property the session-minting function depends on, so it is stated here
 * rather than left to the caller to remember.
 */
export async function verifyAssertion(args: {
  rp: RelyingParty;
  response: AuthenticationResponseJSON;
  expectedChallenge: string;
  credential: StoredCredential;
}): Promise<AssertionResult> {
  const { credential } = args;

  /*
   * The user handle is the user id we encoded at registration. It is optional
   * in the protocol, so its absence cannot be an error — but when it is present
   * and disagrees with the row we looked up, something is wrong in a way that
   * should never happen, and signing somebody in on the strength of "one of
   * these two user ids is probably right" is exactly the failure this whole
   * file exists to prevent.
   */
  const handle = args.response.response.userHandle;
  if (handle) {
    const claimed = new TextDecoder().decode(fromBase64Url(handle));
    if (claimed !== credential.userId) {
      throw new Error('The passkey does not belong to the account it is registered against.');
    }
  }

  const result = await verifyAuthenticationResponse({
    response: args.response,
    expectedChallenge: args.expectedChallenge,
    expectedOrigin: args.rp.origins,
    expectedRPID: args.rp.rpId,
    requireUserVerification: true,
    credential: {
      id: credential.credentialId,
      publicKey: fromBase64Url(credential.publicKey),
      /*
       * Zero, deliberately, and not the stored counter.
       *
       * The library applies its own counter rule and throws `Response counter
       * value 2 was lower than expected 9000` — which is correct, and is the
       * wrong thing to show somebody. It is also not quite this app's rule: it
       * allows a repeat of the same non-zero counter, which is what a replayed
       * assertion carries.
       *
       * Passing zero disables that check (the library only compares when one of
       * the two counters is above zero) and leaves the policy in one place —
       * `counterAccepted` below, which is what the unit tests exercise and what
       * produces a message naming what the user should do. The signature check,
       * which is the part worth delegating, is untouched.
       */
      counter: 0,
      transports: credential.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!result.verified) throw new Error('The passkey could not be verified.');

  const { newCounter } = result.authenticationInfo;
  if (!counterAccepted(credential.counter, newCounter)) {
    // Said plainly because the honest reading is alarming: two things are
    // signing with one private key, and only one of them is the user's.
    throw new Error(
      'This passkey reported a signature counter that did not move forward, which means it may have been cloned. Sign in with your password and remove it.',
    );
  }

  return {
    userId: credential.userId,
    credentialId: credential.credentialId,
    newCounter,
  };
}
