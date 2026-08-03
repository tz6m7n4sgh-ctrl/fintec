# Architecture

## The stack

| | |
| --- | --- |
| **Next.js 15, App Router** | Server components by default; server actions for every write |
| **React 19** | `useActionState` throughout the forms |
| **Supabase** | Postgres, Auth, Storage, Edge Functions, Vault, `pg_cron` |
| **TypeScript** | Strict. No `any` in application code |
| **Vitest** | Unit tests, node environment — the engine needs no DOM |
| **Playwright** | End-to-end, against a production build |
| **No CSS framework** | Hand-written CSS with custom properties, one stylesheet |
| **No component library** | A handful of primitives in `components/ui.tsx` |

The last two are deliberate. This app has about ten screens and one visual language; a framework would have added a build step and a dependency surface to save less than it cost. **HAD-78 spent a whole pull request closing three advisories in packages nobody chose deliberately** — every dependency here has to earn its place against that.

## Layers

```
app/            screens (server components) + server actions
  ↓
lib/data/       read model: repository → store → ReadModel
  ↓
lib/engine/     pure calculation
lib/ingestion/  pure parsing and deduplication
```

**Nothing in `lib/engine` imports from `app/` or from Supabase.** It takes plain objects and returns plain objects. That is what makes it exhaustively testable and portable.

`lib/data/store.ts` assembles a single `ReadModel` — profile, readiness, projection, payments, reminders, budget, transactions — which every screen reads. One assembly point rather than each screen querying for itself.

## Where writes happen

**Every write is a server action.** No Supabase client is ever constructed in a client component.

That is not only a security property, it is a bundle-size one: `/profile` ships 5.5 kB of route JavaScript because the write path is on the server. The read model is server-rendered and the client bundle carries interaction only.

The pattern, established by `app/profile/actions.ts` and followed everywhere:

1. Resolve the user; refuse if signed out.
2. Parse and validate input, refusing rather than substituting (invariant I-11).
3. **Upsert on the natural key**, letting a unique constraint make it safe.
4. Let the *database* own validation, and **translate** its errors — `new row violates check constraint profiles_gross_gte_basic` becomes *"Gross salary cannot be less than basic — gross includes allowances, so it is always the larger figure."*
5. `revalidatePath('/', 'layout')` where every screen reads the changed data.

**Validation lives in the database on purpose.** Re-implementing a check constraint in TypeScript creates a second copy that drifts (invariant I-8). What the action adds is translation, not duplication.

## Why Edge Functions exist at all

Two jobs need to run where no user session exists. Both would otherwise have required the service-role key in the application, which invariant I-3 forbids.

**`send-reminders`** — reads every user's payments to compute the day's reminders. Invoked by `pg_cron`.

**`passkeys`** — runs the WebAuthn ceremony. Sign-in happens while the user is signed *out*, so there is no `auth.uid()` for a policy to key on.

Supabase injects the service-role key into a function at runtime, so it exists only where it must and never travels through a repository or a CI secret store.

> **This function can mint a session for any user id.** It is the most dangerous code in the repository, and four things stop it being an account-takeover primitive: the user id comes from the stored credential rather than the request; the challenge is consumed by `delete … returning`; origin and RP ID come from configuration rather than the `Origin` header; and the signature counter must move forward. See [`05-security-model.md`](./05-security-model.md).

## The vendored copies, and why they are generated

Edge Functions run on Deno and cannot import from `lib/`. Each carries a **generated** copy:

```
supabase/functions/send-reminders/_engine/   ← lib/engine/
supabase/functions/passkeys/_shared/         ← lib/auth/
```

Produced by `scripts/vendor-engine.mjs`, which adds the `.ts` extensions Deno requires and rewrites npm specifiers to `npm:` form **pinned to the version in `package-lock.json`** — not the range in `package.json`, or Deno could resolve a version Node never ran.

`scripts/vendor-engine.test.ts` re-runs the transform in memory and **fails the build if a copy is stale**. Without that, the reminder job and the screen listing the same reminders would drift, and both would keep producing plausible schedules.

## Auth

Email and password, completed entirely in-app. **Nothing is emailed** — no confirmation, no code, no reset link.

That is a deliberate trade for a flow that never depends on a mailbox, an SMTP provider or a redirect allow-list. The cost is honest and stated on screen: a *forgotten* password can only be cleared from the Supabase dashboard.

**Passkeys** are an alternative sign-in, never a replacement (invariant I-5).

**Idle auto-lock** ends the session after 15 minutes, with a warning at 14. It signs out rather than drawing a lock screen: by the time an overlay renders, the figures are in the DOM and the cookie is still valid, and both survive the overlay being deleted from devtools. It uses `scope: 'local'` — walking away from a laptop says nothing about the phone in your pocket.

## The unconfigured state is a supported state

**The application must render with Supabase unreachable.** Signed out, or with no credentials configured, every screen shows the §11 reference dataset and says so.

This is not a convenience. A missing environment variable should degrade to *"you cannot sign in"* rather than crash a screen showing someone their termination deadlines. The entire e2e suite runs in this state, which is what keeps it true.

> It also has an unused benefit worth taking: **preview deployments should run unconfigured.** They currently inherit committed defaults and point at the production database, so anyone opening a preview URL creates a real account. The degradation path is already built and tested.

## CI

`.github/workflows/ci.yml`:

1. `npm test` — Vitest
2. `npm run typecheck`
3. `npm run build`
4. `scripts/secret-guard.mjs`
5. `npm audit --omit=dev --audit-level=high`
6. Playwright e2e against the production build
7. Lighthouse, with **median** aggregation and ratcheted thresholds
8. **SEC-1** — cross-tenant isolation, as a separate job

Lighthouse asserts on the **median** of three runs, not the optimistic best, which is `lhci`'s default. The diagnostic prints every run and flags a spread wide enough to make the gate flaky — a gate graded on its best run is a gate that reports green while failing a third of the time.

> **SEC-1 currently passes by skipping.** Without a `SUPABASE_DB_URL` secret it completes in about seven seconds and exits zero. A check that skips must fail rather than pass (invariant I-15); this one does not yet, and it is the check that proves the property the whole system rests on.
