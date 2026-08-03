# Security model

## The claim

**No code path anywhere in this system can bypass a row-level security policy.**

That is a stronger statement than "the queries are scoped correctly", and it is stronger on purpose. It does not depend on any particular query being written carefully, so it cannot be undone by a careless one.

Everything below exists to keep it true.

---

## What protects the data

### Row-level security, enabled and forced

Every table in `public`. **Forced** matters — without it the table owner bypasses its own policies. Four policies per table, keyed to `(select auth.uid()) = user_id`, with two documented deviations covered in [`03-data-model.md`](./03-data-model.md).

### No service-role key exists outside an Edge Function

Not in the repository, not in CI, not in the deployment environment. Supabase injects it into a function at runtime.

**Two features were not built in order to keep this true:**

- An unattended statement-parsing sweep. Parsing happens instead inside the upload request, under the user's own JWT.
- A reminder job in CI. It runs inside an Edge Function instead.

Both were reachable another way. Neither was worth the guarantee.

### The publishable key is not a secret

`lib/supabase/config.ts` commits a project URL and publishable key, and that is correct: the key is meant for the browser and ships in the bundle regardless. **The policies are the boundary; the key is not.**

Asserted rather than assumed — querying the live project as `anon` returns zero rows from every table, and an `anon` insert fails the `WITH CHECK` clause, because every policy is keyed to a uid an anonymous request does not have.

> **Open issue:** committing *defaults* means every preview deployment and every fork points at the same project, so a stranger opening a preview URL creates a real account in it. That is fine for a single-user app and not fine for Phase 2's audience. Tracked as HAD-75.

### Storage

One private bucket. Object keys are `<uid>/<uuid>.<ext>`; the policy matches the first path segment against `auth.uid()`. No user-supplied text reaches the key.

### Headers

Set in `middleware.ts` and asserted against a live response by the e2e suite. **CSP is currently Report-Only** — worth knowing, because it means a negative control against a CSP directive proves nothing. That was discovered by running such a control and finding it inert.

---

## The most dangerous code in the repository

`supabase/functions/passkeys` **can mint a session for any user id.** Four things stop it being an account-takeover primitive, and all four are load-bearing:

**1 · The user id comes from the stored credential.** Looked up by the credential id the *authenticator* returned. The request body has no field naming an account, deliberately — there is nothing to tamper with.

**2 · The challenge is consumed by deletion.** `delete … returning` is atomic, so a replay racing the original cannot also find a row. This is why challenges are rows and not signed tokens: a signed challenge is replayable until it expires, because there is nothing to consume.

**3 · Origin and RP ID come from configuration.** `PASSKEY_RP_ID` and `PASSKEY_ORIGINS`. Deriving them from the request's `Origin` header needs no setup, passes every test, and lets any website relay a ceremony. An unset variable **throws** rather than defaulting.

**4 · The signature counter must move forward**, including against an exact repeat — which is what a replayed assertion carries. The library's own rule permits equality; this app's does not.

Verified in `e2e/passkeys.spec.ts` against Chromium's virtual authenticator, with seven negative controls that each break exactly one thing about a genuine assertion. Removing the user-handle and counter checks turns three of them red.

---

## What must never be added

A reimplementation can undo this model without touching a policy. These are the specific ways:

**A redundant `user_id` filter** on a query RLS already scopes. It makes a broken policy produce correct results, so the tests pass and the guarantee is silently gone. (Inside a service-role Edge Function the filter **is** the boundary and is required — the rule is that the filter and the policy must never both be the boundary for the same query.)

**A service-role client in application code.** See above.

**An `Origin`-derived relying party** in the WebAuthn ceremony.

**A client-updatable signature counter.** A user who can rewind their own counter has disabled clone detection on their own credential.

**A stateless challenge.** Nothing to consume means nothing to replay-protect.

**Secrets in the repository.** `scripts/secret-guard.mjs` runs in CI. It is not a substitute for judgement.

**A CI check that skips and passes.** A green tick meaning "skipped" reads as coverage.

---

## Known gaps, stated rather than buried

**SEC-1 passes by skipping.** Without a `SUPABASE_DB_URL` repository secret, the cross-tenant isolation job completes in about seven seconds and exits zero. The 52 write refusals, the anon sweep and the storage phase are currently verified only by hand. **This is the check that proves the claim at the top of this document**, and it is not currently proving it.

**Leaked-password protection is disabled** on the live project, flagged by Supabase's own advisor. With passwords as a primary factor and no reset path, it is the natural compensating control.

**Rate limits are unverified.** With no mailbox in the loop there is no natural round-trip cost, so repeated password attempts against a known address are the cheapest attack on this system.

**The enumeration posture is inconsistent.** `signIn` is carefully generic — *"that email and password do not match an account"* — while `signUp` says *"an account already exists for that email"*. The generic sign-in message therefore buys nothing; an attacker enumerates through the weaker endpoint. For a single-user app the usability trade is probably right, but it should be a decision on record rather than an accident.

**Session minting is unverified end to end.** `generateLink` → `verifyOtp` rests on documented behaviour rather than on a check anyone has run, because it needs the service-role key that by design exists only inside the function.

All five are tracked. None is a code change — they are configuration, or a decision, or access nobody has yet granted.
