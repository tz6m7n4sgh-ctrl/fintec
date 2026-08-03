import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  authenticationOptions,
  registrationOptions,
  toBase64Url,
  verifyAssertion,
  verifyRegistration,
  type RelyingParty,
  type StoredCredential,
} from '../lib/auth/passkeys';

/**
 * The WebAuthn ceremony, against a real authenticator (US-40 / HAD-6).
 *
 * ## Why this is an e2e test and not a unit test
 *
 * The verifier in `lib/auth/passkeys.ts` is the thing that decides whether
 * somebody gets into an account, and it is reached by an Edge Function that can
 * mint a session for any user id. A test of it built from hand-written fixtures
 * tests the fixtures: get the CBOR or the client-data hash subtly wrong and the
 * verifier fails for a reason the test then encodes as expected.
 *
 * So the input here is produced by Chromium's own WebAuthn implementation,
 * driven through CDP's virtual authenticator, using the same
 * `@simplewebauthn/browser` build the app ships. Nothing about the attestation
 * or the assertion is written by this file.
 *
 * ## The negative controls are the point
 *
 * A passing ceremony proves the code accepts what a browser produces. It says
 * nothing about what the code *refuses*, and a verifier that accepts everything
 * passes the happy path perfectly. Each check below therefore takes the one
 * genuine assertion and breaks exactly one thing about it:
 *
 *   - the challenge it was signed over
 *   - the origin it came from
 *   - the relying party it was scoped to
 *   - the signature itself
 *   - the user handle it claims
 *   - the counter, run backwards
 *
 * If any of those still verifies, the corresponding lock is not there.
 *
 * ## localhost, not 127.0.0.1
 *
 * An RP ID must be a domain, and an IP address is not one — Chromium rejects
 * the ceremony outright with `127.0.0.1`, which is the config's `baseURL`. So
 * these tests navigate to `localhost` on the same port. `localhost` is also a
 * secure context without TLS, which is the other thing WebAuthn insists on.
 */

/**
 * The exact bundle the app ships, not a re-implementation of it.
 *
 * Resolved through `require` rather than an `import.meta.url` relative path:
 * Playwright transpiles these specs to CommonJS, where `import.meta` is a
 * syntax error, and resolution also survives npm hoisting the package
 * somewhere other than this project's own `node_modules`. The package's
 * `exports` map does not publish the bundle as a subpath, so the entry point is
 * resolved and the package root derived from it.
 */
const BROWSER_BUNDLE = join(
  dirname(require.resolve('@simplewebauthn/browser')),
  '..',
  'dist/bundle/index.umd.min.js',
);

const PORT = 3210;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const ORIGIN = `http://localhost:${PORT}`;

const RP: RelyingParty = { rpId: 'localhost', origins: [ORIGIN] };

/** Stands in for the row in `auth.users`. Nothing here reaches Supabase. */
const USER_ID = 'abe825fc-f779-476b-8903-49cf66ca629e';
const USER_EMAIL = 'passkey-e2e@example.invalid';

declare global {
  interface Window {
    SimpleWebAuthnBrowser: {
      startRegistration: (opts: { optionsJSON: unknown }) => Promise<unknown>;
      startAuthentication: (opts: { optionsJSON: unknown }) => Promise<unknown>;
    };
  }
}

/**
 * A page on the app's own origin with a virtual authenticator attached.
 *
 * The page is the real sign-in screen rather than a blank document, so the
 * ceremony runs against the same origin, the same headers and the same CSP the
 * app actually serves — a test origin would quietly excuse a header that breaks
 * WebAuthn in production.
 */
async function withAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');

  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      // Discoverable credentials and user verification, because the app asks
      // for both — an authenticator without them would test a ceremony this
      // app never performs.
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(`${ORIGIN}${BASE_PATH}/sign-in/`);
  await page.addScriptTag({ path: BROWSER_BUNDLE });

  return { cdp, authenticatorId };
}

/** Runs the browser half of registration and hands back what it produced. */
async function createCredential(page: Page, options: unknown) {
  return page.evaluate(
    (optionsJSON) => window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON }),
    options,
  );
}

/** Runs the browser half of authentication. */
async function getAssertion(page: Page, options: unknown) {
  return page.evaluate(
    (optionsJSON) => window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON }),
    options,
  );
}

/**
 * One full ceremony: register a passkey, then sign in with it.
 *
 * Returned rather than asserted so every negative control below starts from a
 * genuine assertion — one that is known to verify — and breaks a single thing.
 */
async function completeCeremony(page: Page) {
  await withAuthenticator(page);

  const regOptions = await registrationOptions({
    rp: RP,
    userId: USER_ID,
    userName: USER_EMAIL,
    existing: [],
  });
  const attestation = await createCredential(page, regOptions);
  const credential = await verifyRegistration({
    rp: RP,
    userId: USER_ID,
    response: attestation as never,
    expectedChallenge: regOptions.challenge,
  });

  const authOptions = await authenticationOptions(RP);
  const assertion = (await getAssertion(page, authOptions)) as never;

  return { regOptions, attestation, credential, authOptions, assertion };
}

test.describe('a real authenticator', () => {
  test('registers a passkey the verifier accepts', async ({ page }) => {
    await withAuthenticator(page);

    const options = await registrationOptions({
      rp: RP,
      userId: USER_ID,
      userName: USER_EMAIL,
      existing: [],
    });

    /*
     * These three are what make the app's passkey a passkey rather than a
     * second password. Discoverable, so sign-in needs no email first; user
     * verification required, so the authenticator itself checks a biometric or
     * a PIN (R-4); and the RP ID scoping the credential to this site.
     */
    expect(options.authenticatorSelection?.residentKey).toBe('required');
    expect(options.authenticatorSelection?.userVerification).toBe('required');
    expect(options.rp.id).toBe(RP.rpId);

    const attestation = await createCredential(page, options);
    const credential = await verifyRegistration({
      rp: RP,
      userId: USER_ID,
      response: attestation as never,
      expectedChallenge: options.challenge,
    });

    expect(credential.credentialId).toBeTruthy();
    expect(credential.publicKey).toBeTruthy();
    expect(credential.userId).toBe(USER_ID);
  });

  test('signs in, and the account comes from the stored credential', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    const result = await verifyAssertion({
      rp: RP,
      response: assertion,
      expectedChallenge: authOptions.challenge,
      credential,
    });

    /*
     * The whole security model in one assertion: the user id the ceremony
     * yields is the one on the stored credential row. There is no field in the
     * request that could have named a different account.
     */
    expect(result.userId).toBe(USER_ID);
    expect(result.credentialId).toBe(credential.credentialId);
  });

  test('offers the credential without being told who is signing in', async ({ page }) => {
    // No `allowCredentials`, so the sign-in screen cannot be used to ask
    // whether an email has an account. The authenticator answers instead.
    const { authOptions } = await completeCeremony(page);
    expect(authOptions.allowCredentials ?? []).toEqual([]);
    expect(authOptions.userVerification).toBe('required');
  });
});

test.describe('negative controls', () => {
  /**
   * Every one of these starts from an assertion that genuinely verified in the
   * test above, so a failure here means the lock is missing rather than that
   * the fixture was malformed.
   */

  test('refuses an assertion replayed against a different challenge', async ({ page }) => {
    const { credential, assertion } = await completeCeremony(page);

    // A challenge the authenticator never signed over. This is what a captured
    // assertion looks like when the original challenge has been consumed.
    const other = toBase64Url(new TextEncoder().encode('a-challenge-never-issued'));

    await expect(
      verifyAssertion({ rp: RP, response: assertion, expectedChallenge: other, credential }),
    ).rejects.toThrow();
  });

  test('refuses an assertion from another origin', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    await expect(
      verifyAssertion({
        rp: { rpId: RP.rpId, origins: ['https://not-this-app.example'] },
        response: assertion,
        expectedChallenge: authOptions.challenge,
        credential,
      }),
    ).rejects.toThrow();
  });

  test('refuses an assertion scoped to another relying party', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    await expect(
      verifyAssertion({
        rp: { rpId: 'not-this-app.example', origins: RP.origins },
        response: assertion,
        expectedChallenge: authOptions.challenge,
        credential,
      }),
    ).rejects.toThrow();
  });

  test('refuses an assertion whose signature has been altered', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    /*
     * One byte, in the signature only. Everything else — the challenge, the
     * origin, the credential id — still matches, so this isolates the signature
     * check from every other check around it.
     */
    const tampered = JSON.parse(JSON.stringify(assertion)) as {
      response: { signature: string };
    };
    const sig = tampered.response.signature;
    const flipped = sig[0] === 'A' ? 'B' : 'A';
    tampered.response.signature = flipped + sig.slice(1);

    await expect(
      verifyAssertion({
        rp: RP,
        response: tampered as never,
        expectedChallenge: authOptions.challenge,
        credential,
      }),
    ).rejects.toThrow();
  });

  test('refuses an assertion whose user handle names another account', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    /*
     * The stored row says one account and the authenticator's user handle says
     * another. It should never happen — and signing somebody in on the strength
     * of "one of these two user ids is probably right" is exactly the failure
     * the whole design is built around.
     */
    const mismatched: StoredCredential = {
      ...credential,
      userId: '00000000-0000-4000-8000-0000000000ff',
    };

    await expect(
      verifyAssertion({
        rp: RP,
        response: assertion,
        expectedChallenge: authOptions.challenge,
        credential: mismatched,
      }),
    ).rejects.toThrow(/does not belong/);
  });

  test('refuses a counter that did not move forward', async ({ page }) => {
    const { credential, authOptions, assertion } = await completeCeremony(page);

    /*
     * A stored counter ahead of the one the assertion carries is what a cloned
     * credential looks like: the real authenticator has counted past the copy.
     * The message must name the action rather than the mechanism, because this
     * is the one failure the user has to do something about.
     */
    const ahead: StoredCredential = { ...credential, counter: 9_000 };

    await expect(
      verifyAssertion({
        rp: RP,
        response: assertion,
        expectedChallenge: authOptions.challenge,
        credential: ahead,
      }),
    ).rejects.toThrow(/cloned/);
  });

  test('refuses a counter that repeated rather than advanced', async ({ page }) => {
    /*
     * The case `@simplewebauthn/server` allows and this app does not. Its rule
     * is "not lower"; a replayed assertion carries the counter it was signed
     * with, so an exact repeat has to be refused too.
     *
     * This test is why `verifyAssertion` passes `counter: 0` to the library and
     * applies the rule itself. Written the obvious way — stored counter handed
     * straight through — this passes for the wrong reason on the test above and
     * fails outright here.
     */
    const { credential, authOptions, assertion } = await completeCeremony(page);

    const verified = await verifyAssertion({
      rp: RP,
      response: assertion,
      expectedChallenge: authOptions.challenge,
      credential,
    });

    // Now replay it against a row that already recorded this exact counter.
    const replayed: StoredCredential = { ...credential, counter: verified.newCounter };

    await expect(
      verifyAssertion({
        rp: RP,
        response: assertion,
        expectedChallenge: authOptions.challenge,
        credential: replayed,
      }),
    ).rejects.toThrow(/cloned/);
  });

  test('refuses to register a passkey the account already has', async ({ page }) => {
    const { credential } = await completeCeremony(page);

    /*
     * `excludeCredentials` is enforced by the authenticator, not by this code,
     * so this asserts the browser is actually given the list — without it a
     * user re-registering the same device would silently accumulate duplicate
     * rows they cannot tell apart in the revoke list.
     */
    const options = await registrationOptions({
      rp: RP,
      userId: USER_ID,
      userName: USER_EMAIL,
      existing: [{ credentialId: credential.credentialId, transports: credential.transports }],
    });

    expect(options.excludeCredentials?.map((c) => c.id)).toContain(credential.credentialId);
    await expect(createCredential(page, options)).rejects.toThrow();
  });
});

test.describe('the sign-in screen', () => {
  test('offers the passkey button only once the browser has confirmed support', async ({
    page,
  }) => {
    await page.goto(`${ORIGIN}${BASE_PATH}/sign-in/`);

    // Chromium supports WebAuthn, so the button appears after hydration. On a
    // browser that does not, it never renders at all rather than failing on
    // click — see the component.
    await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

    // The password form is still there and is still the recovery path (R-4).
    await expect(page.getByLabel('Email address')).toBeVisible();
  });
});
