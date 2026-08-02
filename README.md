# Readiness — personal finance & termination planning (UAE)

A single-user web app for a UAE private-sector employee facing likely termination. It answers one
question precisely: **if my job ends on date X, what am I owed, what must I still pay, how long
does my money last, and what deadlines can I not miss?**

Built against UAE Federal Decree-Law 33/2021 and the ILOE scheme, as verified July 2026.

> General information, not legal or financial advice. Verify with MOHRE (600 590 000) or a licensed
> advisor. Free-zone contracts may differ.

---

## Current state

| Area | Status |
|---|---|
| Calculation engine (§5) | **Done** — every §11 acceptance row and edge case passes |
| Cash projection with lump-sum cheques | **Done** — reports the real zero-crossing, not just flat-burn runway |
| Readiness scoring (/18) | **Done** — explicit rubric, per-criterion explanations |
| All ten screens | **Done** — server-rendered, light/dark, desktop/mobile |
| Automated tests | **Done** — 112 unit + 198 end-to-end (incl. 48 axe accessibility), run in CI against a production server |
| Accessibility & performance gates | **Done** — axe-core sweeps every screen in both themes; Lighthouse CI scores the built artefact |
| Deployment | **Server build** — needs a Node host provisioned (no deploy job in CI) |
| Database schema + RLS | **Done and applied** — 13 tables, RLS enabled *and* forced, 0 security advisories |
| Private statements bucket | **Done** — namespaced per user id |
| Authentication (email + password) | **Done** — sign-up and sign-in run entirely in-app, no email sent |
| Passkeys / biometric sign-in | **Not built** — needs a stable HTTPS origin (US-40) |
| Password reset | **Not built, deliberately** — there is no email path; see below |
| Writing/reading live data | **Done** — a signed-in user with a saved profile sees their own figures |
| Statement ingestion job | **Not built** — pipeline designed; OQ-1 decided (Claude Cowork parses every statement) |
| Email / web-push reminders | **Not built** — schema and preferences table exist |

The app is honest about this: the dashboard shows a **"Seeded data"** banner, and Settings reports
exactly which pieces are live. Editing controls are visibly disabled rather than pretending to work.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL + publishable key
npm run dev                    # http://localhost:3000
```

```bash
npm test                       # 112 unit tests (engine, projection, readiness, formatting, credentials)
npm run typecheck              # tsc --noEmit
npm run build                  # production build
```

The app renders fully without Supabase configured — it falls back to the seeded reference dataset.

---

## Architecture

```
app/                    Next.js 15 App Router — one directory per screen, server-rendered
components/             Shell (nav), ui (cards, tiles, badges), charts (inline SVG)
lib/engine/             Pure calculation engine — no I/O, no clock, fully unit-tested
  types.ts              Domain types (§4 entities + engine outputs)
  dates.ts              Calendar-date maths, Asia/Dubai
  uae.ts                §5.1–5.6: service, gratuity, settlement, ILOE, runway, deadlines
  projection.ts         18-month cash projection + monthly actuals
  readiness.ts          /18 readiness rubric
lib/data/               seed.ts (§11 dataset), store.ts (read model)
lib/format/             AED / en-AE formatting
lib/auth/               credentials.ts — password/email rules, pure and unit-tested
lib/supabase/           config.ts (connection), server.ts (server client + cached getUser)
app/auth/               Server actions for sign in / sign up / sign out, plus the one client form
supabase/migrations/    SQL migrations (schema, RLS, storage bucket, hardening)
docs/                   Requirements, BRD, mockups, task board
```

**Why a pure engine.** Every legal figure is computed by a function with no dependencies, so the §11
acceptance table can be asserted directly. `RULES` in `lib/engine/uae.ts` gathers every legal
constant in one block — when UAE rules change, that block is the whole edit.

**Why calendar-date maths.** `lib/engine/dates.ts` operates on `(y, m, d)` rather than timestamps.
Building a `Date` from `yyyy-mm-dd` yields UTC midnight, and formatting that in a westward timezone
silently shifts the day backwards — which would fire a legal deadline on the wrong date. Tests cover
the 22:30 UTC case, which is already tomorrow in Dubai.

---

## The two design decisions worth knowing

### 1. Runway and the zero-date legitimately disagree

§5.5's `runwayMonths` divides total resources by average monthly burn. It cannot see lump sums. For
the reference profile it reports **9.6 months**, but the projected balance actually goes negative in
**month 7 (Apr 2027)**, because two cheques totalling AED 65,000 fall due before then.

Both numbers are correct answers to different questions. The app shows runway as the headline (it is
the spec's metric) and labels the real zero-crossing directly on the projection chart and in the hero
text. It does not quietly pick one.

### 2. The double-count rule (G-1)

A `ScheduledPayment` carries `includedInBudget`. When `true`, the amount already sits inside a monthly
budget line and is part of `netMonthlyBurn` — the projection must **not** subtract it again. Only
out-of-budget payments are deducted as lump sums.

For the reference profile: AED 161,000 of cheques fall due within 12 months, but only AED 65,000 is
subtracted as lump sums. Subtracting all of it would badly understate runway.

The database enforces the companion rule with a check constraint — an in-budget payment cannot exist
without naming its budget line.

---

## Database

```
supabase/migrations/0001_init.sql                      # 13 tables, enums, constraints, RLS
supabase/migrations/0002_private_statements_bucket.sql # private bucket + per-user path policies
supabase/migrations/0003_harden_trigger_functions.sql  # revoke RPC on trigger functions
```

Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor, in order.

**Security posture**

- RLS `enabled` **and** `forced` on all 13 tables, with four per-command policies each
  (`select`/`insert`/`update`/`delete`), every one keyed to `(select auth.uid()) = user_id`.
- Statement files live in a **private** bucket at `statements/<user-id>/<file>`; storage policies
  check the first path segment against `auth.uid()`.
- Money is `numeric(14,2)` — never floating point. Calendar dates are `date`, never `timestamptz`.
- `created_at` / `updated_at` on every table, maintained by trigger.
- Trigger functions have `EXECUTE` revoked from `anon`/`authenticated`, so they are not reachable as
  RPC endpoints. Verified afterwards that the triggers still fire.
- Supabase security advisor: **zero lints**.

**Constraints that encode domain rules** (rather than trusting the UI):

| Constraint | Why |
|---|---|
| `profiles_gross_gte_basic` | Gross includes allowances, so it cannot be below basic |
| `budget_auto_not_editable` | A computed row can never be marked editable |
| `budget_one_auto_row_per_source` | One auto row per source, so auto values cannot double-count |
| `scheduled_in_budget_needs_category` | An in-budget payment must name its budget line (G-1) |
| `upload_failed_needs_message` | A failed upload must explain itself |
| `transactions_dedupe` (unique) | Re-uploading a statement yields zero new transactions |

### Verifying RLS yourself

```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
```

---

## Statement ingestion (designed, not yet built)

1. Upload PDF/CSV/XLSX → private bucket → `statement_uploads` row, `uploaded` → `queued`.
2. A **scheduled Claude Cowork session** picks up queued files, extracts transactions, writes them back.
3. Dedupe on `hash(account, date, amount, normalised description)` — the unique index makes
   re-uploading the same file a no-op.
4. Auto-categorise via user-editable keyword rules (`category_rules`).
5. Auto-match debits to scheduled payments, and salary credits to the salary income stream.
6. Everything lands `pending`. **Nothing counts toward a dashboard figure until confirmed.**

**Open decision OQ-1** blocks this: statement contents would be read by an LLM. The alternative is a
deterministic CSV/XLSX-only path for sensitive files. This is the highest-value decision outstanding
— it gates seven user stories.

---

## Adding a bank template

`bank_accounts.parser_config` (jsonb) holds a saved column mapping per account, so repeat CSV/XLSX
uploads from the same bank parse without re-inference:

```json
{
  "dateColumn": "Txn Date",
  "dateFormat": "dd/MM/yyyy",
  "descriptionColumn": "Narrative",
  "debitColumn": "Withdrawal",
  "creditColumn": "Deposit",
  "balanceColumn": "Running Balance",
  "skipRows": 7
}
```

---

## Backup & data ownership

- **Export** — Settings → Export all data (JSON), covering every table.
- **Import** — restores a previous export; round-tripping is stable.
- **Delete** — removes every row *and* every statement file from storage. Not recoverable.
- **Database backups** — Supabase takes automatic daily backups; see the project dashboard.

---

## Deployment

### A Node host — required

The app is a **server build**. It was a static export on GitHub Pages, and that was fine while it
only ever rendered the §11 reference data. It stopped being fine as soon as real salary, savings and
debt figures were on the table: **a static site has no server boundary**, so row-level security
becomes the only thing between that data and the internet.

The migration restored one, and is what lets sign-in, the ingestion job and the reminder senders
exist at all. Pages can no longer host this — there is no deploy job in CI, because a deploy job
that cannot run would be worse than none.

```bash
npm run build && npm start        # production server on :3000
```

### Picking a host

Free tiers are all ample here — this is one user — so the things that actually differ are cold
starts and how much configuration the Next server needs.

| Host | Free tier | Fit |
|---|---|---|
| **Vercel Hobby** | 100 GB/mo, no sleep | **Recommended.** Built by the Next team: zero config, middleware and server actions work as-is |
| Netlify Free | 100 GB, 300 build-min | Works via their Next adapter; more moving parts |
| Cloudflare Workers | Generous | Needs `@opennextjs/cloudflare`; Node-API gaps can catch middleware |
| Render Free | 750 hrs | **Avoid.** Spins down after 15 min idle — roughly a 50 s cold start |
| Fly / Railway | Trial credits | No longer durably free |

Render's cold start is the one that matters. This is an app someone opens to check whether an ILOE
deadline is 3 days away or 30. Waiting 50 seconds for that answer is a worse failure than it sounds.

Vercel's Hobby licence is non-commercial, which fits a personal tool.

### Deploying to Vercel

Connect the repository. **Nothing else is required** — the Supabase project URL and publishable key
are committed as defaults in `lib/supabase/config.ts`, so a fresh deploy can sign in immediately.

Setting `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` still overrides them,
which is how a fork points at its own project without editing source.

Committing those two values is deliberate, not laziness. Both are public by construction: the
publishable key ships inside the JavaScript bundle to every visitor either way, and row-level
security — enabled *and forced* on all thirteen tables, with all four policies on each keyed to
`(select auth.uid()) = user_id` — is what actually protects the data. Querying the live project as
the `anon` role returns zero rows from every table and cannot insert one. The key buys an attacker
exactly what loading the page already would.

`SUPABASE_SERVICE_ROLE_KEY` is the opposite case. It bypasses RLS entirely, it is not in this repo,
and it must never be.

**Leave `NEXT_PUBLIC_BASE_PATH` unset.** It exists only to mount the app under a sub-path, which is
what GitHub Pages needed. Setting it on a root domain breaks every asset path — that is the one real
trap left over from the migration.

No `vercel.json` is needed; a Next server build is detected automatically.

### Signing in

**Email and a password, and nothing else leaves the app.** `/sign-up` creates the account and signs
you straight in; `/sign-in` gets you back. No confirmation email, no one-time code, no magic link, no
reset link. Both run as server actions in `app/auth/actions.ts` — the Supabase client is never
loaded in the browser, which is why `/sign-in` costs the same first load as every other screen.

This replaced an email one-time-code flow, and the reason is worth recording. Supabase decides
between a code and a magic link by reading the **email template**, not by which API you call, and the
stock template sends a link — so an untouched project emailed a link to a form asking for a code.
Clickable links then depend on *Site URL* and the redirect allow-list, which default to
`localhost:3000`. And the built-in SMTP is rate-limited and explicitly not for production, so real
use needed a custom mail provider before anyone could sign in twice in an hour. The app had grown a
link parser, a three-way verify branch and a paragraph of copy telling users to *copy* the link
rather than click it — a lot of surface defending a configuration problem. A password depends on none
of it.

**One project setting is required:** Authentication → Providers → Email → **Confirm email = OFF**.
With it on, `signUp` mails a confirmation link and returns no session, which is the exact behaviour
this removed. The app detects that state and names the setting on screen rather than appearing to do
nothing.

**There is no password reset, and that is the trade.** No email path in means no email path out. A
forgotten password can only be cleared from the Supabase dashboard, under Authentication → Users.
Both auth screens say so before a password is chosen, rather than leaving it to be discovered. A
signed-in change-password control is the obvious next step and is not built yet.

Two smaller rules the code enforces, both in `lib/auth/credentials.ts` and unit-tested:

- **Minimum 8 characters**, above Supabase's default of 6, because the usual mitigation for a weak
  password is a reset email and there isn't one.
- **Maximum 72 bytes**, because bcrypt hashes at most 72 and silently discards the rest. Without the
  check, a long passphrase and its first 72 bytes would both unlock the account — a weaker password
  than the user believes they chose, with nothing on screen to reveal it. Bytes, not characters: an
  emoji is four.

A stable HTTPS origin is still what passkeys (US-40) and PWA install (US-47) need.

**What the move bought, immediately:**

- **Real security headers.** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` are set in `next.config.mjs` and verifiable with `curl -D-`. Pages could not
  set them at all, so they had been deliberately removed rather than left misleadingly present.
- **A place for auth to keep a session**, rather than pushing everything into the browser.
- **Somewhere to run the ingestion job and the reminder senders**, which a static host simply
  cannot do.

**Content-Security-Policy is still absent, deliberately.** Next's App Router emits inline scripts, so
a useful CSP needs per-request nonces; a CSP with `unsafe-inline` on scripts implies protection it
does not give. Same principle as before — absent beats misleadingly present.

`trailingSlash: true` is kept from the export config. A server resolves `/calendar` and `/calendar/`
alike, but every existing URL and test uses the trailing form and changing it would turn passing
assertions into redirects for nothing.

Environment variables (see `.env.example`):

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Safe in the browser; RLS is the protection |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Ingestion job writes. Never expose or commit |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | public / server | Web push |

PWA install and passkeys both require a stable HTTPS origin.

---

## Localization

English UI, **AED** with `en-AE` formatting, dates `dd MMM yyyy`, and **Asia/Dubai** for every
calendar, deadline and scheduled job. Runway of `Infinity` renders as **"Unlimited"** rather than a
broken number (§11 edge case).

---

## Testing

```bash
npm test                 # 112 unit tests
npm run build            # required before e2e — the suite tests the real server build
npm run test:e2e         # 198 end-to-end tests (desktop + mobile)
npm run test:a11y        # just the 48 axe accessibility tests
npm run test:lighthouse  # Lighthouse CI
npm run test:rls         # SEC-1 — cross-tenant isolation, against a real database
```

### SEC-1 — proving cross-tenant isolation

`supabase/tests/rls-isolation.sql` is the answer to a question the rest of the
suite cannot ask: **can one user read another user's financial data?**

RLS was applied to all 13 tables and verified by reading the schema. That is not
the same as proving it. `0001_init.sql` generates all 52 policies from a single
loop, so one mistake in that loop is a mistake in every policy at once.

The test creates two users, gives each a row in all 13 tables, and then, acting
as user A over a real connection:

| Phase | Asks |
|---|---|
| A | Are RLS, `force`, and all four policies actually present on every table? |
| C | Can A **see** B's rows? |
| D | Can A insert a row owned by B, donate its own row to B, update B's row, or delete it? |
| E | Can the `anon` role read anything at all? |
| F | Can A list, overwrite or write into B's private statement folder? |
| G | **Negative controls** — with RLS deliberately switched off, does this file notice? |

Phase G is the one that makes the rest mean anything. A green test that cannot
go red proves nothing, so the file breaks isolation on purpose in two ways — RLS
disabled, and a policy weakened to `using (true)` — and fails if it does *not*
detect them. It then restores the schema and asserts the restore.

Three properties worth knowing:

- **It runs against the real project, not a copy.** Two earlier defects on this
  repo came from measuring a stand-in instead of the real host, and both produced
  plausible numbers that were believed. The policies only exist in one place.
- **It is non-destructive.** Everything, including the deliberate breakage, is
  inside one transaction that always rolls back.
- **`INCONCLUSIVE` fails the run.** If a check was blocked by a unique index
  rather than by RLS, that table has no evidence behind it, and no evidence is
  not a pass.

Point it at the database directly — the transaction pooler will not work,
because the test relies on transaction-scoped `SET LOCAL`:

```bash
export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
npm run test:rls
```

Without `SUPABASE_DB_URL` it prints a loud skip and exits 0. Set `RLS_REQUIRED=1`
to make a missing connection string a failure instead — CI should do this once
the secret exists, because a security gate that silently never runs is
indistinguishable from one that passes.

### SEC-3 — secrets and dependencies

```bash
npm run build && npm run test:secrets
```

`scripts/secret-guard.mjs` covers the two gaps GitHub's own push protection
leaves:

- **A real value committed into `.env.example`.** That file is a template, so it
  is *meant* to be committed — push protection sees a file that belongs there
  holding a key shaped like the placeholder it replaced.
- **A server-only secret inlined into the client bundle.** In Next.js the only
  thing separating a server secret from a public one is the `NEXT_PUBLIC_`
  prefix, and that boundary is one typo wide.

It is not a generic entropy scanner. Those fire on hashes and minified code, and
a check people learn to ignore is worse than no check. Like the isolation proof,
it was verified able to go red: a planted service-role JWT trips it.

Current state, verified against a production build:

| Check | Result |
|---|---|
| Secret-shaped strings in `.next/static` | none |
| Non-`NEXT_PUBLIC_` env vars referenced in app code | none — only the URL and publishable key |
| Real credentials in git history | none; `.env.example` holds empty placeholders |
| `.env` tracked by git | no, and `.gitignore` covers it |

Worth noting: since the browser Supabase client was deleted, **even the
publishable key no longer ships to the browser**. Nothing in `.next/static`
talks to Supabase at all.

#### Dependency audit

CI blocks at `critical` over the production tree only. Three `high` advisories
currently sit inside Next's own dependencies:

| Advisory | Reachable here? |
|---|---|
| `postcss` — path traversal via `sourceMappingURL` | No. All CSS is repo-authored; none is attacker-supplied. |
| `sharp`/libvips CVEs | No. The app uses no `next/image`, so sharp is never invoked. The only asset is `icon.svg`. |
| `tmp`, `uuid` | Dev-only, via `@lhci/cli`. Never shipped. |

There is no patched 15.x release to move to — 15.5.22 is current and 15.6 is
canary. Gating at `high` today would mean a permanently red build, which teaches
people to ignore the one check that should never be ignored. The upgrade path is
tracked as its own issue instead.

#### Content-Security-Policy

Still deliberately absent, and the reasoning in `next.config.mjs` still holds:
the App Router emits inline scripts, so a useful CSP needs per-request nonces,
and one with `unsafe-inline` on scripts implies protection it does not give.

That calculus changes when statement ingestion lands. Once an LLM is writing
transaction descriptions into pages, a stored-XSS path through parsed statement
text becomes a real shape rather than a theoretical one. Tracked separately.

### Unit tests

| File | Covers |
|---|---|
| `lib/engine/uae.test.ts` | Every §11 row; all four edge cases; runway band boundaries at 2.99/3.00/5.99/6.00; basic-vs-gross; budget auto rows; cheque window boundaries; timezone handling |
| `lib/engine/projection.test.ts` | Double-count rule; zero-crossing vs flat runway; combined lump sums; pending/duplicate exclusion |
| `lib/engine/readiness.test.ts` | Band thresholds; per-criterion scores; ineligible ILOE; unlimited runway; heavy debt |
| `lib/format/money.test.ts` | en-AE formatting; negative-zero normalisation; `Unlimited` runway; true minus sign |

### End-to-end tests

`e2e/app.spec.ts` runs against the **built static export**, served the way a static host serves it —
including under a sub-path when `NEXT_PUBLIC_BASE_PATH` is set. So CI exercises the exact artefact
it deploys, and a broken asset path fails the build rather than production.

Covered on all ten screens, in both a desktop and a mobile viewport: HTTP 200, exactly one `h1`,
stylesheet actually applied, legal footer present, no horizontal overflow, and **zero console errors
or failed requests**. Plus: the §11 figures on the dashboard, status badges carrying a text label
rather than colour alone, every stat tile having a real destination, chart hover detail for months
that carry no visible label, the report's figures and PDF export, the calendar's three pinned
deadlines with countdowns, dark mode, and that every interactive control has an accessible name and
every table a header cell.

Several assertions pin specific defects found by looking at rendered pages: a stat tile whose
caption counted a different set of cheques than its figure summed, the same scenario reading "OK" on
one screen and "Tight" on another, a zero deduction rendering as `-0.00`, and a `<title>` hydration
failure introduced while adding the chart hover layer.

### Accessibility sweep

`e2e/a11y.spec.ts` runs **axe-core** over all ten screens in both viewports **and both themes** —
40 tests. The hand-written checks above stay where they are; axe is the general sweep that catches
what an assertion cannot enumerate ahead of time.

It was added after a token audit found `--ink-3` failing the 4.5:1 normal-text contrast ratio on
every light-mode surface (3.21–3.50:1) while the whole suite stayed green. The status palette had
the same problem: `--critical` and `--s1` were tuned as **fills**, where 1.4.11's 3:1 applies, then
reused as **text**, where 4.5:1 does. Hence the `*-ink` tokens — `--good-ink` had already set the
precedent, it just was not applied across the palette. Use `*-ink` for glyphs and copy, the vivid
token for anything graphical.

Axe also caught that the scrollable `.tbl-wrap` containers were not keyboard-reachable (WCAG 2.1.1);
they now carry `tabIndex={0}` and a visible focus ring.

### Performance

`lighthouserc.js` runs **Lighthouse CI** against the built export in CI. This finally puts a number
on NFR-9, and the first number was wrong in an instructive way.

The initial measurement said TTI ~3.4 s against a 2 s target — NFR-9 badly missed. The cause was not
the app. The hand-written static server the tests ran against sent no compression while a real host
compresses text, so Lighthouse was measuring the **test rig**, not the site. That server has since
been deleted outright: the suite now runs against `next start`, which is what actually serves
production. TTI went from ~3.4 s to ~1.84 s with no application code changed at all.

Current median, 3 runs, default mobile profile (Slow 4G, 4× CPU):

| Metric | Dashboard | Report |
|---|---|---|
| First Contentful Paint | 0.77 s | 0.77 s |
| Largest Contentful Paint | 1.84 s | 1.83 s |
| **Time to Interactive** | **1.84 s** | **1.84 s** |
| Total Blocking Time | 73 ms | 71 ms |
| Cumulative Layout Shift | 0 | 0 |
| Performance score | 0.99 | 1.00 |

**NFR-9 is met** — but by about 1%, which is not comfortable. The assertions are ratchets with
headroom for runner variance (TTI 2500 ms) rather than pinned to the target, because asserting
2000 ms against a 1981 ms median would flake. Tighten them as real margin appears.

Two things still worth attention: TBT rose from 50 to 147 ms once compression let the JavaScript
arrive sooner — faster delivery concentrated the main-thread work rather than removing it — and the
stylesheet is still render-blocking.

The lesson generalises: **an unrepresentative test rig produces plausible numbers, and plausible
wrong numbers are worse than obviously wrong ones.** The same mistake, in the same file, also
produced a phantom accessibility failure (see the base-path note in `lighthouserc.js`).

Reference figures asserted: service 7.332 years · gratuity **87,479** · leave 6,000 ·
settlement **93,479** · ILOE 9,000/**27,000** · resources **220,479** · burn 23,000 ·
runway **9.586** · scenario(12) **−55,521** · settlement due **14 Oct 2026** ·
ILOE deadline **30 Oct 2026**.

---

## Documentation

| Document | Contents |
|---|---|
| `docs/stage-1-requirements.md` | Functional/non-functional requirements, user stories, MoSCoW, gaps/risks, open questions |
| `docs/business-requirements-document.md` | Business objectives, scope, KPIs, business risks, glossary |
| `docs/mockups/dashboard-calendar-schedule.html` | Stage 2 mockups |
| `docs/mockups/task-board.html` | 51 user stories with per-stage progress |

---

## Known gaps

1. **No password reset and no passkeys.** Sign-in is email and password with nothing emailed, so a
   forgotten password has to be cleared from the Supabase dashboard. Changing a password from inside
   the app is unbuilt, as is biometric sign-in (US-40), which needs a stable HTTPS origin.
2. ~~OQ-1 unresolved~~ **Closed** — Claude Cowork parses every statement, with no deterministic
   no-LLM path. The 7 ingestion stories are unblocked but still unbuilt, and every uploaded
   statement is read by an LLM (disclosed in-app on the Statements screen).
3. **Readiness rubric is a proposal** (OQ-2) — the point split is explicit in
   `lib/engine/readiness.ts` so it can be argued with.
4. **Recurrence expansion** is computed for schedule totals, but single-occurrence overrides are not
   implemented (G-3 / OQ-4).
5. **`serviceYears` uses 365.25** — the spec's own acceptance value only reconciles with 365.25,
   though some manual UAE calculations use 365. Flagged as C-3.
