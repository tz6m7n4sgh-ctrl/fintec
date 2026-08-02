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
| Automated tests | **Done** — 82 unit + 164 end-to-end (incl. 40 axe accessibility), run in CI against a production server |
| Accessibility & performance gates | **Done** — axe-core sweeps every screen in both themes; Lighthouse CI scores the built artefact |
| Deployment | **Server build** — needs a Node host provisioned (no deploy job in CI) |
| Database schema + RLS | **Done and applied** — 13 tables, RLS enabled *and* forced, 0 security advisories |
| Private statements bucket | **Done** — namespaced per user id |
| Authentication (email/OTP + passkeys) | **Not built** — next step |
| Writing/reading live data | **Not built** — screens read the §11 seed dataset |
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
npm test                       # 82 unit tests (engine, projection, readiness, formatting)
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

Connect the repository, then set two environment variables:

```
NEXT_PUBLIC_SUPABASE_URL             = https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...
```

**Leave `NEXT_PUBLIC_BASE_PATH` unset.** It exists only to mount the app under a sub-path, which is
what GitHub Pages needed. Setting it on a root domain breaks every asset path — that is the one real
trap left over from the migration.

No `vercel.json` is needed; a Next server build is detected automatically.

### After the first deploy

Two steps, neither obvious, both of which cause confusing failures if skipped:

1. **Add the deployment URL to Supabase Auth** → Authentication → URL Configuration → *Site URL* and
   *Redirect URLs*. Without it the one-time-code flow fails on the redirect, and the error does not
   say why.
2. **Create your user in the Supabase dashboard.** Sign-in uses `shouldCreateUser: false` on purpose
   — this is a single-user app, and silently provisioning an account for a typo is not wanted. Until
   a user exists, no address can sign in.

A stable HTTPS origin is also what passkeys (US-40) and PWA install (US-47) need, so this unblocks
both.

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
npm test                 # 82 unit tests
npm run build            # required before e2e — the suite tests the real export
npm run test:e2e         # 164 end-to-end tests (desktop + mobile)
npm run test:a11y        # just the 40 axe accessibility tests
npm run test:lighthouse  # Lighthouse CI against the built export
```

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

1. **No authentication yet** — so no live data. This is the next build step, and it unblocks
   persistence, the review inbox and reminders.
2. ~~OQ-1 unresolved~~ **Closed** — Claude Cowork parses every statement, with no deterministic
   no-LLM path. The 7 ingestion stories are unblocked but still unbuilt, and every uploaded
   statement is read by an LLM (disclosed in-app on the Statements screen).
3. **Readiness rubric is a proposal** (OQ-2) — the point split is explicit in
   `lib/engine/readiness.ts` so it can be argued with.
4. **Recurrence expansion** is computed for schedule totals, but single-occurrence overrides are not
   implemented (G-3 / OQ-4).
5. **`serviceYears` uses 365.25** — the spec's own acceptance value only reconciles with 365.25,
   though some manual UAE calculations use 365. Flagged as C-3.
