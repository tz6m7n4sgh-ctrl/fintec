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
| Calculation engine (§5) | **Done** — 72 unit tests, every §11 acceptance row and edge case passes |
| Cash projection with lump-sum cheques | **Done** — reports the real zero-crossing, not just flat-burn runway |
| Readiness scoring (/18) | **Done** — explicit rubric, per-criterion explanations |
| All ten screens | **Done** — server-rendered, light/dark, desktop/mobile |
| Database schema + RLS | **Done and applied** — 13 tables, RLS enabled *and* forced, 0 security advisories |
| Private statements bucket | **Done** — namespaced per user id |
| Authentication (email/OTP + passkeys) | **Not built** — next step |
| Writing/reading live data | **Not built** — screens read the §11 seed dataset |
| Statement ingestion job | **Not built** — pipeline designed, blocked on OQ-1 |
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
npm test                       # 72 unit tests (engine, projection, readiness)
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

### GitHub Pages (configured)

The app builds to a **fully static export**, so GitHub Pages can host it. Every route is
prerendered at build time — there is no server at runtime.

`.github/workflows/deploy-pages.yml` runs on every push to `main`: tests, typecheck and build must
all pass before anything publishes, so a red suite cannot reach the live page. Pull requests run the
same verification but **never deploy**.

**One-time setup** (repository admin, cannot be done from code):

> **Settings → Pages → Build and deployment → Source: GitHub Actions**

Without that, the deploy job fails — the workflow cannot enable Pages for you. Once set, the site
appears at `https://<user>.github.io/<repo>/` and the run summary links to it.

Notes specific to Pages:

- `basePath` is derived from the repository name, because a project site is served from a sub-path.
  Local development is unaffected and still runs at `/`.
- `trailingSlash: true` emits `route/index.html` instead of `route.html`; Pages does no extension
  rewriting, so without it every route but the home page would 404.
- `public/.nojekyll` stops Jekyll from stripping Next's `_next/` asset directory.
- **Pages cannot set response headers**, so the security headers this app previously declared are
  gone rather than silently ineffective. See the comment in `next.config.mjs`.
- `NEXT_PUBLIC_SUPABASE_*` are read from repository **variables** and are optional: with them unset
  the site renders the seeded dataset, which is all it shows today anyway.

> **A public repository means a public site.** That is harmless while the app displays only the §11
> reference data. Before real financial data is wired up, decide deliberately whether a public
> static host is right — a static site has no server boundary, so row-level security becomes the
> only thing protecting your data.

### Any Node host

Vercel or a plain Node server also work, and can set real security headers. Remove
`output: 'export'` from `next.config.mjs` to get a server build back, then:

```bash
npm run build && npm start
```

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
npm test
```

| File | Covers |
|---|---|
| `lib/engine/uae.test.ts` | Every §11 row; all four edge cases; runway band boundaries at 2.99/3.00/5.99/6.00; basic-vs-gross; budget auto rows; cheque window boundaries; timezone handling |
| `lib/engine/projection.test.ts` | Double-count rule; zero-crossing vs flat runway; combined lump sums; pending/duplicate exclusion |
| `lib/engine/readiness.test.ts` | Band thresholds; per-criterion scores; ineligible ILOE; unlimited runway; heavy debt |

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
2. **OQ-1 unresolved** — gates the ingestion epic (7 user stories).
3. **Readiness rubric is a proposal** (OQ-2) — the point split is explicit in
   `lib/engine/readiness.ts` so it can be argued with.
4. **Recurrence expansion** is computed for schedule totals, but single-occurrence overrides are not
   implemented (G-3 / OQ-4).
5. **`serviceYears` uses 365.25** — the spec's own acceptance value only reconciles with 365.25,
   though some manual UAE calculations use 365. Flagged as C-3.
