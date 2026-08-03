# `passkeys`

The WebAuthn ceremony (US-40 / FR-K2 / R-4 / HAD-6). Four steps, one endpoint,
selected by `step` in the request body.

| `step` | Bearer must be | What it does |
| --- | --- | --- |
| `signin-options` | the publishable key | Issues an authentication challenge. |
| `signin-verify` | the publishable key | Verifies the assertion and **mints a session**. |
| `register-options` | a signed-in user's access token | Issues a registration challenge. |
| `register-verify` | a signed-in user's access token | Verifies the attestation and stores the credential. |

## Read this before changing anything in here

This function can issue a session for any user id. It is the most dangerous
code in the repository, and four things are what stand between it and account
takeover:

1. **The user id comes from the stored credential**, looked up by the credential
   id the authenticator returned. It is never read from the request body — there
   is no field that names an account, deliberately.
2. **The challenge is consumed by `delete … returning`**, which is atomic. A
   replay racing the original cannot also find a row.
3. **Origin and RP ID come from configuration.** Reading them from the request's
   `Origin` header would be convenient, would pass every test, and would let any
   website relay a ceremony.
4. **The signature counter must move forward**, including against an exact
   repeat. That is the only clone detection WebAuthn has.

## Why the ceremony lives here and not in the Next app

Sign-in happens while the user is signed *out*, so there is no `auth.uid()` and
row-level security has nothing to key a policy to. `webauthn_challenges`
therefore has RLS enabled with **no policies at all** — every ordinary client is
denied outright, and only the service-role key can reach it. SEC-3 established
that this project holds that key nowhere: not in the repository, not in CI, not
in the deployment environment. Supabase injects it into an Edge Function at
runtime. Same reasoning as `send-reminders`.

## Why the browser never calls this directly

`signin-verify` replies with an access token and a refresh token. The app's
server actions call this function and put those straight into the session
cookie, so the session never exists in client JavaScript. See
`lib/supabase/passkey-function.ts`.

## `_shared/` is generated

Do not edit anything under `_shared/`. It is copied from `lib/auth/` by:

```
node scripts/vendor-engine.mjs
```

A verifier that drifts from the code its tests exercise does not fail loudly; it
accepts something it should have refused. `scripts/vendor-engine.test.ts` runs
in the normal `npm test` gate and fails if the copy is out of date, if a `@/…`
alias survives, or if an `npm:` import is unpinned.

The npm version in the generated copy is read from `package-lock.json`, not from
the range in `package.json` — otherwise Deno could resolve a version of
`@simplewebauthn/server` that Node never ran.

## Deploying

```
supabase functions deploy passkeys --project-ref <ref>
```

`verify_jwt` stays **on**. For the sign-in steps the bearer is the publishable
key, which is public by design and proves nothing — the ceremony is the proof.
For the registration steps it must be a real user's access token.

## Configuration

Nothing works until both of these are set. The function returns **503** on every
request while either is missing, and says so in the log.

| Where | Name | Example | Why |
| --- | --- | --- | --- |
| Edge Function secrets | `PASSKEY_RP_ID` | `fintec.vercel.app` | The domain credentials are bound to. Must be the site's registrable domain — not a URL, no scheme, no port. |
| Edge Function secrets | `PASSKEY_ORIGINS` | `https://fintec.vercel.app` | Comma-separated exact origins an assertion may come from. Every entry is one more site that can complete a ceremony, so add preview URLs only if you mean it. |

Neither is a secret. They are here rather than in the repository because they
are per-deployment, and because an unset one has to be an error: the tempting
default — trusting the request's own `Origin` — is the vulnerability this check
exists to prevent, so `relyingPartyFrom` throws instead.

## Testing

The ceremony itself is verified in `e2e/passkeys.spec.ts`, against Chromium's
virtual authenticator through CDP, using the same `@simplewebauthn/browser`
build the app ships. Nothing about the attestation or the assertion is
hand-written. Seven negative controls break exactly one thing about a genuine
assertion — challenge, origin, RP ID, signature, user handle, counter backwards,
counter repeated — and each must be refused.
