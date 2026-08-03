# Stage 1 — Requirements Document
### Personal Finance & Termination-Readiness Web App (UAE)

**Status:** Draft for your approval · **Date:** 30 Jul 2026 · **Stage gate:** Requirements → *your approval* → Mockups + ERD

> This is the Stage 1 deliverable. **No application code has been written.** It records what we're building, the decisions taken during the requirements interview, the gaps/risks I found in the spec, and the open questions that remain. Once you approve this, we move to Stage 2 (mockups + ERD).

---

## 1. Purpose & scope

A single-user (schema-multi-user-ready) personal finance web app for a UAE private-sector employee facing likely termination. It does three jobs:

1. **Everyday clarity** — income vs. scheduled outflows, trends, and a payment calendar.
2. **Termination scenario planning** — *"If my job ends on date X: what am I owed, what must I still pay, how long does my money last, what deadlines can't I miss?"*
3. **Automated ingestion** — I upload bank statements; they get parsed into transactions that feed the dashboards.

Out of scope for now: multi-user sharing UI, investment/portfolio tracking, tax filing, and any jurisdiction other than UAE onshore (free-zone contracts explicitly disclaimed in the legal footer).

---

## 2. Decisions taken in the requirements interview

These answers change the spec and are treated as binding unless you correct them.

| # | Topic | Your decision | Impact on the build |
|---|---|---|---|
| D1 | **Statement ingestion (§7), amended 3 Aug 2026** | CSV and XLSX are parsed immediately by deterministic application code. **PDF transaction parsing is out of Stage 1 scope**; uploaded PDFs are retained for download and marked failed with a plain explanation. | The closed Cowork sweep is not a parsing path. PDF may return only through a separate explicit per-file consent design; it must never be sent to an LLM silently. |
| D2 | **Banks & formats** | Not pre-specified. | Build a **bank-agnostic** deterministic CSV/XLSX upload + review flow. `BankAccount` stores an optional saved column mapping, but no bank is hard-coded. |
| D3 | **Alerts (§6.2)** | **Email + Web push (PWA).** | Both channels implemented. Reminders 7 & 2 days before cheque/school due dates; legal-deadline countdowns. Notification preferences in Settings. |
| D4 | **Backend / deployment** | **Supabase, provisioned by me (the builder)** at Stage 4. | Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron) confirmed. Provisioning happens **at Stage 4**, not now. Stages 2–3 stay backend-agnostic. |

### 2.1 What statement ingestion means (D1 — amended 3 Aug 2026)

The Stage 1 pipeline is:

1. I upload a CSV or XLSX → it is stored in a **private Supabase Storage bucket** and parsed immediately by deterministic application code under my authenticated session.
2. Normalized transactions are deduplicated and written as `pending`; no parsed row affects a dashboard until I confirm it.
3. A PDF may be uploaded only for storage/download continuity. It is immediately marked `failed` with a readable explanation and is **not parsed or sent to an LLM**. PDF transaction extraction is formally out of Stage 1 scope pending an explicit per-file consent design.

This amendment replaces the 30 Jul Cowork-for-everything decision. The scheduled Cowork sweep was closed, so requirements must not describe it as a live delivery mechanism. Deterministic CSV/XLSX parsing narrows the privacy surface while retaining the review and dedupe guarantees.

## 3. Functional requirements

Grouped by the screens in §6. Each has a stable ID for traceability into Stage 2/3.

### FR-A Dashboard (§6.1)
- **FR-A1** Hero runway number in months, status-colored (≥6 good / 3–6 warning / <3 critical), always paired with icon + text label (never color alone).
- **FR-A2** Stat tiles: Total resources · Final settlement · ILOE total · Net monthly burn · Cheques due next 6 months. Each tile click-navigates to the screen holding its inputs (§9 traceability).
- **FR-A3** Cash-projection chart: 18 months from `expectedLastDay`, starting at `totalResources`, minus `netMonthlyBurn`/month, with lump-sum cheque hits overlaid on their actual months **only when `includedInBudget = false`** (avoids double counting). Zero line marked; below-zero months shaded.
- **FR-A4** Trends & patterns: spend-by-category bar; current vs survival comparison; **actual month-over-month spend trend from ingested transactions** (single-series line); income-vs-spend per month from transactions; largest upcoming obligations; derived text insights.
- **FR-A5** Scenario cards for 3/6/9/12-month outcomes with OK/SHORTFALL status.

### FR-B Payment calendar (§6.2)
- **FR-B1** Month grid + agenda of all scheduled payments; EMIs auto-generated from `Debt`, school terms from `SchoolFee`, recurring bills from `ScheduledPayment`. Cheques visually prominent.
- **FR-B2** Reminders 7 and 2 days before each cheque/school due date ("Fund [account] with AED X before [date]") via **email and web push** (D3).
- **FR-B3** Legal deadlines (`settlementDue`, `iloeDeadline`, `visaGraceEnd`) pinned with live countdown badges.
- **FR-B4** Entries auto-marked paid when a matching ingested transaction is confirmed; manual mark-paid also available.

### FR-C Income & profile (§6.3)
- **FR-C1** Grouped forms — Employment, ILOE, Money, Situation — with inline help text derived from the §5 rules.
- **FR-C2** IncomeStream CRUD; salary auto-ends at `expectedLastDay` in the termination scenario.

### FR-D Budget (§6.4)
- **FR-D1** Editable current-vs-survival amount per category; totals.
- **FR-D2** Auto rows read-only and linked to source screens: **School fees** (from `SchoolFee`, annual ÷ 12) and **Loan & mortgage payments** (from Σ `Debt.monthlyPayment`).
- **FR-D3** Budget-vs-actual column fed by categorized transactions.

### FR-E Loans, mortgage & cheques (§6.5)
- **FR-E1** Three CRUD sections — `Debt`, `SchoolFee`, `ScheduledPayment` — each with totals.

### FR-F Bank statements & transactions (§6.6)
- **FR-F1** Upload CSV/XLSX statements per bank account and parse them deterministically; list uploads with parsing status and a per-file processing log. PDF may be retained for download but is explicitly not parsed in Stage 1 and is marked failed immediately.
- **FR-F2** Review inbox: newly parsed transactions land `pending`; bulk confirm/edit category + matches; only confirmed rows count in dashboards.
- **FR-F3** Transactions ledger with filters (account, category, date range, direction) + search.

### FR-G Termination report (§6.7)
- **FR-G1** One readable, **PDF-exportable** page: itemized settlement, ILOE estimate, deadlines with countdowns, runway, scenarios, cheque exposure, readiness score.

### FR-H Readiness & action plan (§6.8)
- **FR-H1** Auto-scored criteria (runway / ILOE / gratuity / debt-ratio) + manual toggles; total /18 → STRONG ≥14 · MODERATE 9–13 · AT RISK <9.
- **FR-H2** Seeded action checklist (§8) with **computed** deadlines and done-toggles.

### FR-I Settings (§6.9)
- **FR-I1** Passkey management (list/revoke); **FR-I2** notification preferences (email/web-push toggles per event type); **FR-I3** JSON export/import of all data; **FR-I4** delete-all-data.

### FR-J Calculation engine (§5)
- **FR-J1** Pure, unit-tested functions implementing §5.1–5.6 exactly, matching every §11 row. (Math independently re-verified — see §7 of this doc.)

### FR-K Auth (§3)
- **FR-K1** Email + password / email-OTP sign-in via Supabase Auth.
- **FR-K2** WebAuthn **passkeys** (platform authenticator) registered after first login; multiple devices; management in Settings.
- **FR-K3** Session policy: short-lived tokens + refresh; auto-lock after 15 min idle → biometric re-auth; "sign out everywhere."

### FR-L Ingestion pipeline (§7, re-architected per amended D1)
- **FR-L1** Upload → private bucket → `StatementUpload` queued.
- **FR-L2** Authenticated on-upload application code parses CSV/XLSX immediately; the merge is idempotent and safe to re-run. PDF parsing is out of scope.
- **FR-L3** Normalize → `Transaction` rows (date, description, amount, direction, balanceAfter).
- **FR-L4** Dedupe on hash(account, date, amount, normalized description); re-uploading the same file yields **0 new transactions**.
- **FR-L5** Auto-categorize via user-editable keyword rules (e.g. DEWA→Utilities, SALIK→Transport, school name→School fees).
- **FR-L6** Auto-match debits→`ScheduledPayment` (amount ±tolerance, date ±window, payee keywords) proposing "mark paid"; salary credits→salary `IncomeStream`.
- **FR-L7** Status transitions to `parsed` or `failed` (readable `errorMessage`); notify me; new rows appear in Review inbox.

---

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | **Security posture:** RLS on every table keyed to `userId`; encrypted at rest; HTTPS only; **no financial data in localStorage**; statement files in a **private** bucket; `createdAt`/`updatedAt` on all rows. |
| NFR-2 | **Localization:** English UI, **AED**, `en-AE` formatting, dates `dd MMM yyyy`, timezone **Asia/Dubai** for all calendar/jobs/deadlines. |
| NFR-3 | **Responsive + PWA installable;** sidebar on desktop, bottom tabs on mobile (Home · Calendar · Budget · Loans · Plan; Statements under Budget). |
| NFR-4 | **Charts:** single y-axis (never dual); single-series charts have no legend; label key points directly; status colors reserved for status and always paired with icon/label; colorblind-safe palette; full dark mode. |
| NFR-5 | **Traceability:** every AED figure clickable to the screen where its inputs live. |
| NFR-6 | **Idempotent ingestion;** files retained but downloadable/deletable by me; per-file processing log in UI. |
| NFR-7 | **Legal footer** present in-app verbatim (§10). |
| NFR-8 | **Auditability & recovery:** JSON export/import of all data; delete-all-data honored fully (including Storage files). |
| NFR-9 | **Performance target:** dashboard interactive < 2 s on a typical mobile connection with ~24 months of transactions. |

---

## 5. User stories with acceptance criteria (priority sample)

> Full backlog will be tracked in Stage 2; these are the acceptance-critical stories.

- **US-1 (Runway at a glance).** *As the user, I open the app and immediately see how many months my money lasts if I'm terminated on my expected last day.*
  **AC:** Given the §11 sample profile, the hero shows **≈9.6 months**, WARNING status (3–6? no — ≥6 is "good") with the correct icon+label; tapping it opens the Termination Report. *(Note: 9.6 ≥ 6 ⇒ "good/green"; see risk R-6 about the 6.0 boundary.)*

- **US-2 (Won't-bounce cheques).** *As the user, I never miss funding a post-dated cheque.*
  **AC:** Every cheque shows on the calendar; email + web-push reminders fire 7 and 2 days before at Asia/Dubai local time; a cheque is auto-marked paid when a matching confirmed transaction exists.

- **US-3 (Termination report).** *As the user, I get one page answering "if it happens tomorrow."*
  **AC:** For the §11 profile the report shows finalSettlement **AED 93,479**, ILOE **AED 27,000**, settlementDue **14 Oct 2026**, iloeDeadline **30 Oct 2026**, and exports to PDF unchanged.

- **US-4 (Statement upload → clean ledger).** *As the user, I upload a statement and review parsed transactions before they count.*
  **AC:** A 50-row CSV yields 50 `pending` transactions and 3 proposed cheque matches; re-uploading the same file adds **0**; an unparseable file → `failed` with a human-readable error and **nothing partial** in the ledger.

- **US-5 (Biometric sign-in).** *As the user, after registering a passkey I sign in with fingerprint/Face ID.*
  **AC:** Next sign-in offers biometric; revoking the passkey in Settings forces email sign-in.

- **US-6 (Survival switch).** *As the user, I compare current vs survival budget and see runway update.*
  **AC:** Editing survival amounts recomputes `netMonthlyBurn` and runway live; auto rows (school, debt) stay read-only and equal in both columns.

---

## 6. Architecture (for sign-off in Stage 2, previewed here)

- **Frontend:** **Next.js (App Router) + React + TypeScript**, PWA-enabled (service worker for web push + installability). *Justification:* SSR/streaming for a fast first paint on mobile, first-class Supabase support, easy static export of the Termination Report to PDF, and a single deploy target (Vercel) that pairs cleanly with Supabase.
- **Backend:** Supabase — Postgres (RLS), Auth (email/OTP + WebAuthn via SimpleWebAuthn on top if native passkeys insufficient), Storage (private statements bucket), Edge Functions (webhooks, PDF export helper, web-push sender), pg_cron (enqueue trigger).
- **Ingestion:** deterministic CSV/XLSX parsing in the authenticated upload request, writing `Transaction`/`StatementUpload` through ordinary RLS-enforced access. No service-role or scheduled parsing worker.
- **Calc engine:** framework-free pure TS module, unit-tested, shared by dashboard, report, and scenario cards.

*ERD and sequence diagrams are Stage 2 deliverables.*

---

## 7. Challenging the spec — gaps, contradictions & risks

I independently re-computed the entire §11 table; **all rows and all four edge cases pass** (gratuity 87,479 · final 93,479 · ILOE 9,000/27,000 · total 220,479 · runway 9.586 · scenario(12) −55,521 · settlement 14 Oct · ILOE 30 Oct; Cat-B cap 20,000; 30-yr cap 240,000; sub-1-yr gratuity 0). The engine is internally sound. The issues below are elsewhere.

**Gaps**
- **G-1 Double-count rule needs a companion.** FR-A3 subtracts cheques as lump sums only when `includedInBudget = false`. But `netMonthlyBurn` comes from the *survival budget*, which may already include some cheque-backed obligations (rent, school) via auto rows. We need an explicit rule that a `ScheduledPayment` with `includedInBudget = true` must map to exactly one budget line, or the projection can still double- or under-count. **Proposed:** enforce a 1:1 link and surface it in the Budget screen.
- **G-2 Readiness scoring is under-specified.** §6.8 cites "runway/ILOE/gratuity/debt-ratio" scored to /18 but gives no per-criterion point breakdown. I'll propose an explicit rubric in Stage 2 for your approval.
- **G-3 Recurrence expansion horizon undefined.** `recurrence: monthly|quarterly|termly|yearly` needs a generation window (e.g. 18 months forward to match the projection) and a rule for editing/deleting a single occurrence vs the series.
- **G-4 `currentBalance`/`balanceAfter` reconciliation.** Nothing says whether the projection's starting cash uses `Profile.cashSavings` or summed `BankAccount.currentBalance`. These can disagree. **Proposed:** projection uses `totalResources` (§5.5) as the single source; account balances are informational only.
- **G-5 ILOE "avgBasic6m" data source.** It's a manual `Profile` field, but ingestion could estimate it from salary credits. Manual for now; note as a possible Stage 4 assist.

**Contradictions / ambiguities**
- **C-1 no-LLM mode vs. Claude Cowork — AMENDED (3 Aug 2026).** CSV/XLSX use deterministic application code. PDF parsing is formally out of Stage 1 scope; any future LLM-assisted PDF path requires explicit per-file consent.
- **C-2 Status thresholds are half-open and undefined at the boundary.** "≥6 good / 3–6 warning / <3 critical" — is exactly 6.0 good or warning; is exactly 3.0 warning or critical? **Proposed:** `≥6 good`, `3 ≤ r < 6 warning`, `r < 3 critical` (6.0 good, 3.0 warning). See R-6.
- **C-3 `serviceYears` divisor.** §5 uses 365.25; some UAE gratuity practice uses 365. The spec's own acceptance value (87,479) only reconciles with **365.25**, so we lock 365.25. Flagging because it differs from a common manual calc and a user might question it.

**Risks**
- **R-1 Legal accuracy drift.** Gratuity/ILOE/visa rules change; the app gives numbers people may act on. Mitigation: engine constants centralized + dated; legal footer (§10) always visible; "verify with MOHRE" prompts on the report.
- **R-2 Statement parsing reliability.** Deterministic parsing can still misread unusual columns, amounts, or signs. Mitigation: **everything lands `pending`** and is human-confirmed before counting; balance-continuity checks flag suspect rows; every skipped or parsed outcome appears in the per-file log.
- **R-3 Financial data reaching an LLM.** Stage 1 statement ingestion does not send financial data to an LLM. CSV/XLSX parsing is deterministic; PDF parsing is out of scope. Any future PDF extraction requires explicit per-file consent, private storage, least privilege, and mandatory human confirmation.
- **R-4 WebAuthn browser variance** (esp. iOS Safari / in-app browsers). Mitigation: SimpleWebAuthn, always keep email/OTP as a recoverable path, never make passkey the *only* factor.
- **R-5 Cheque = legal jeopardy.** A missed reminder has civil/criminal consequences in the UAE. Mitigation: dual-channel reminders (email + push), 7- and 2-day lead, prominent styling, and a "cheque exposure" tile on the dashboard.
- **R-6 Off-by-one on status boundaries** (C-2). Mitigation: the explicit half-open rule above, covered by unit tests at 2.99/3.00/5.99/6.00.
- **R-7 Timezone bugs.** Reminders/deadlines computed in UTC would fire on the wrong day. Mitigation: all date math in Asia/Dubai; tests around DST-free but midnight-boundary cases.

---

## 8. MoSCoW prioritization

**Must**
- Calculation engine (§5) with unit tests passing every §11 row (FR-J).
- Profile/income/budget/loans/cheques CRUD (FR-C, D, E).
- Dashboard hero + stat tiles + scenario cards + cash projection (FR-A1–A3, A5).
- Termination report with PDF export (FR-G).
- Payment calendar with cheque prominence + legal-deadline countdowns (FR-B1, B3).
- Auth: email/OTP + passkeys (FR-K).
- Supabase schema + RLS + audit timestamps (NFR-1).
- Deterministic CSV/XLSX statement upload + Review inbox + dedupe + ledger (FR-F, FR-L); PDF parsing excluded.
- Email + web-push cheque/school reminders (FR-B2, D3).
- Legal footer; JSON export/import; delete-all-data (NFR-7, NFR-8).

**Should**
- Trends/patterns + derived insights + budget-vs-actual (FR-A4, FR-D3).
- Auto-categorize + auto-match with editable keyword rules (FR-L5, L6).
- Readiness score + seeded action plan with computed deadlines (FR-H).
- Auto-lock + "sign out everywhere" (FR-K3).
- Per-bank saved CSV/XLSX column mapping (D2).

**Could**
- Clickable-prototype polish beyond required flows.
- ILOE avgBasic6m auto-estimation from salary credits (G-5).
- Multiple income-stream types beyond salary/side/rental.

**Won't (this build)**
- Multi-user sharing UI (schema-ready only).
- Investments/tax/non-UAE jurisdictions.
- Native mobile apps (PWA only).

---

## 9. Open questions

| ID | Question | My recommendation |
|---|---|---|
| ~~**OQ-1**~~ **AMENDED 3 Aug 2026** | Deterministic CSV/XLSX path or Cowork-for-everything? | **Deterministic CSV/XLSX. PDF parsing is out of Stage 1 scope.** A future LLM-assisted PDF path requires explicit per-file consent. |
| **OQ-2** | Readiness /18 rubric — do you have a preferred point split, or should I propose one in Stage 2? | I propose the rubric in Stage 2 for approval. |
| **OQ-3** | Status boundary convention (C-2) — accept `≥6 good, 3≤r<6 warning, r<3 critical`? | Accept as stated. |
| **OQ-4** | Recurrence generation horizon (G-3) — 18 months forward (to match the projection chart) OK? | Yes, 18 months, with single-occurrence override support. |
| **OQ-5** | Web push requires a service worker + VAPID keys and user permission; on iOS it needs the PWA to be installed. Acceptable, with **email as the guaranteed channel**? | Yes — email is the reliable floor; push is best-effort. |
| **OQ-6** | Do you want the seeded §8 action-plan phone numbers (MOHRE 600 590 000, ILOE 600 599 555) shown as tappable `tel:` links? | Yes. |
| **OQ-7** | PWA/passkeys need a stable HTTPS domain. Do you have a preferred domain, or use a Vercel default until you provide one? | Use a Vercel default for Stages 3–4; swap in your domain when ready. |

---

## 10. Legal footer (must appear in-app, verbatim)

> "General information, not legal or financial advice. UAE rules current as of July 2026 — verify with MOHRE (600 590 000) or a licensed advisor. Free-zone contracts may differ."

---

## 11. Definition of done for Stage 1

- [x] Requirements interview conducted; decisions recorded (D1–D4).
- [x] Functional + non-functional requirements captured with traceable IDs.
- [x] User stories with acceptance criteria for the acceptance-critical paths.
- [x] MoSCoW prioritization.
- [x] Spec challenged: gaps, contradictions, risks documented with mitigations.
- [x] §11 math independently re-verified (all rows + edge cases pass).
- [ ] **Your approval to proceed to Stage 2 (mockups + ERD).**

---

*Next stage on approval: Stage 2 — information architecture, high-fidelity mockups (desktop + mobile, light + dark) for every §6 screen, and the ERD + architecture diagram.*
