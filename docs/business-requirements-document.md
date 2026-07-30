# Business Requirements Document (BRD)
### Personal Finance & Termination-Readiness Web App (UAE)

| | |
|---|---|
| **Document** | Business Requirements Document (BRD) |
| **Product** | Personal Finance & Termination-Readiness Web App ("the app") |
| **Version** | 1.0 (Draft for approval) |
| **Date** | 30 Jul 2026 |
| **Author** | Delivery team (Claude Code) |
| **Owner / Sponsor** | Primary user (private-sector employee, UAE) |
| **Related docs** | `docs/stage-1-requirements.md` (functional/technical requirements) |
| **Stage gate** | Business framing → *your approval* → Stage 2 (mockups + ERD) |

> **Purpose of this document.** The BRD states *why* we are building this and *what business outcomes* it must deliver, in business terms — separate from the *how* captured in the Stage 1 functional/technical requirements. Where a business requirement maps to a functional requirement, the FR-ID from `stage-1-requirements.md` is referenced for traceability.

---

## 1. Executive summary

The user is a UAE private-sector employee facing a **likely job termination**. In the UAE, termination creates a cluster of time-boxed, high-consequence obligations — an end-of-service settlement owed within **14 days**, an unemployment-insurance (ILOE) claim window of **30 days**, a visa grace period, and post-dated cheques that **must not bounce** (civil and potential criminal exposure). Missing any of these has real financial and legal cost.

Today the user has no single place that answers the question that matters most: **"If my job ends on date X, what am I owed, what must I still pay, how long does my money last, and what deadlines can I not miss?"** Information is scattered across payslips, bank statements, loan schedules, cheque books, and school-fee invoices.

The app consolidates income and scheduled outflows, computes UAE-accurate end-of-service and ILOE figures, projects a cash runway, surfaces every legal deadline with countdowns, and keeps the picture current by ingesting bank statements. The measurable business outcome is **decision confidence and zero missed deadlines** during a financially stressful transition.

---

## 2. Business context & problem statement

**Background.** UAE end-of-service and unemployment rules (Federal Decree-Law 33/2021 and the ILOE scheme) are precise but not intuitive: gratuity is based on **basic** salary (not gross), accrues at different rates before and after five years, is capped, and interacts with notice pay, leave encashment, and staff-loan deductions. ILOE eligibility and payout have their own thresholds and a hard 30-day claim deadline.

**Problem.** During the window around a termination the user must simultaneously (a) verify the employer's settlement is correct and on time, (b) claim ILOE before the deadline, (c) keep funding cheques and essential bills while income stops, and (d) understand how many months of runway they have. No existing tool answers this holistically for a UAE employee, and manual calculation is error-prone at exactly the moment errors are most costly.

**Opportunity.** A focused, private, single-user app that turns these scattered facts into one authoritative dashboard, an itemized termination report, and a deadline-aware calendar — kept current automatically — materially reduces financial loss and stress.

---

## 3. Business objectives & goals

| ID | Business objective | Success indicator |
|---|---|---|
| BO-1 | **Answer "am I financially ready if terminated?" instantly and accurately.** | Runway (months) and an itemized settlement are visible within one screen tap; figures match UAE law (§11 acceptance tests). |
| BO-2 | **Prevent missed legal/financial deadlines.** | Every cheque, settlement, ILOE, and visa deadline is tracked with reminders; target **zero** missed cheque fundings and ILOE-claim windows. |
| BO-3 | **Verify the employer's final settlement.** | App produces an independent itemized settlement the user can compare against the employer's payment, with an escalation prompt (MOHRE) if short/late. |
| BO-4 | **Keep the financial picture current with minimal effort.** | Bank statements are ingested and reflected in dashboards after a lightweight review, not manual re-entry. |
| BO-5 | **Extend financial runway through informed choices.** | Current-vs-survival budgeting and 3/6/9/12-month scenarios let the user see the runway impact of spending changes before making them. |
| BO-6 | **Keep sensitive financial data private and secure.** | Data is access-controlled per user, encrypted at rest, never stored in the browser, and fully exportable/deletable by the user. |

---

## 4. Stakeholders

| Stakeholder | Role / interest | Interaction with the app |
|---|---|---|
| **Primary user** (sponsor) | UAE private-sector employee; sole decision-maker and data owner. | Enters/reviews data, uploads statements, reads dashboards, acts on deadlines. |
| **Future additional users** | Potential later expansion (e.g. spouse, other employees). | None now — schema is built multi-user-ready but the UI targets one user. |
| **Delivery team** | Builds and operates the app. | Provisions Supabase, builds the app, operates the Claude Cowork ingestion routine. |
| **External authorities (referenced, not integrated)** | MOHRE, ILOE scheme, banks, schools, employer. | Not system actors; the app surfaces their deadlines, phone numbers, and required documents. |
| **LLM ingestion service (Claude Cowork)** | Parses uploaded statements on a schedule. | Reads statement files from private storage; writes transactions for user review. |

---

## 5. Scope

### 5.1 In scope
- Everyday financial clarity: income streams, budgets (current vs survival), loans/mortgage, school fees, post-dated cheques, recurring bills.
- Termination scenario engine: end-of-service gratuity, leave encashment, notice-in-lieu, final settlement, ILOE benefit, runway, and 3/6/9/12-month scenarios (UAE rules per §5).
- Legal-deadline tracking with countdowns: settlement (14d), ILOE (30d), visa grace, and cheque exposure windows (6/12 months).
- Payment calendar with **email + web-push** reminders (7 & 2 days ahead).
- Bank-statement ingestion via **Claude Cowork** scheduled parsing, with a human review inbox before figures count.
- Termination report (PDF-exportable), readiness score, and seeded action plan with computed deadlines.
- Authentication including **biometric passkeys**; per-user data isolation; JSON export/import; delete-all-data.

### 5.2 Out of scope (this engagement)
- Multi-user collaboration/sharing UI (data model is future-ready only).
- Investment, savings-goal, or portfolio management.
- Tax preparation or filing.
- Non-UAE jurisdictions and detailed free-zone contract variants (disclaimed in the legal footer).
- Direct bank API / open-banking integration (ingestion is by uploaded statements only).
- Native iOS/Android apps (PWA install only).

### 5.3 Assumptions
- A-1 The user provides accurate profile inputs (basic vs gross salary, dates, leave balances, ILOE status).
- A-2 UAE rules are current as of **July 2026**; the app presents information, **not** legal/financial advice (legal footer always visible).
- A-3 **Confirmed 30 Jul 2026 (OQ-1 closed):** the user accepts that statement contents are parsed by Claude Cowork (an LLM). No deterministic no-LLM path will be built, so this is an accepted privacy trade rather than an open assumption.
- A-4 The user has at least one modern browser supporting WebAuthn and (for push) an installable PWA.
- A-5 Email is the guaranteed reminder channel; web push is best-effort (subject to OS/browser permission, esp. iOS).

### 5.4 Constraints
- C-1 **Localization:** English UI, AED, `en-AE` formatting, dates `dd MMM yyyy`, **Asia/Dubai** timezone for all calendar/deadline math.
- C-2 **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + pg_cron), provisioned by the delivery team at Stage 4.
- C-3 **Security:** row-level isolation per user, encryption at rest, HTTPS-only, **no financial data in browser storage**, private statement bucket, audit timestamps on all records.
- C-4 **Delivery is staged** with approval gates: Requirements → Mockups+ERD → Prototype (real math, fake data) → Production. No app code before Stage 3 approval.
- C-5 **Legal accuracy** is non-negotiable: engine outputs must match the §11 acceptance tests exactly.

### 5.5 Dependencies
- D-1 Supabase project provisioning (Stage 4).
- D-2 Claude Cowork availability for the scheduled ingestion routine.
- D-3 A stable HTTPS domain for PWA + passkeys (Vercel default until the user supplies one — OQ-7).
- D-4 Web-push VAPID keys and an email-sending path for reminders.

---

## 6. Business drivers

1. **Consequence severity** — bounced cheques and a missed ILOE window carry legal and irreversible financial cost; the app's core value is preventing them.
2. **Time pressure** — the most important deadlines cluster in the 30 days after the last working day.
3. **Complexity of UAE rules** — basic-vs-gross, pre/post-5-year accrual, caps, and ILOE thresholds are easy to get wrong by hand.
4. **Information fragmentation** — payslips, statements, loan schedules, cheque books, and school invoices live in different places.
5. **Emotional load** — a calm, single-source picture reduces stress and supports better decisions during a job search.

---

## 7. High-level business requirements

Business-level "what," each traceable to Stage 1 functional requirements.

| ID | Business requirement | Traces to |
|---|---|---|
| **BR-1** | The user must see, at a glance, how many months their money lasts under a termination scenario, with a clear good/warning/critical status. | FR-A1, FR-J |
| **BR-2** | The user must get an **independent, itemized final settlement** (gratuity, leave, notice-in-lieu, other owed, minus employer dues) accurate to UAE law. | FR-G1, FR-J1 |
| **BR-3** | The user must see their **ILOE eligibility and payout estimate** and the 30-day claim deadline. | FR-G1, FR-J1, FR-H |
| **BR-4** | The user must never miss funding a cheque or a legal deadline — reminders via email + web push, with countdowns. | FR-B2, FR-B3, D3 |
| **BR-5** | The user must be able to compare a **current vs survival budget** and see the runway impact of 3/6/9/12-month scenarios. | FR-A5, FR-D1, FR-J |
| **BR-6** | The user must keep the picture current by **uploading statements**, reviewing parsed transactions, and having confirmed data feed dashboards. | FR-F, FR-L |
| **BR-7** | The user must get a **readiness score and an action plan** with computed deadlines and required documents. | FR-H1, FR-H2 |
| **BR-8** | The user must be able to **sign in with biometrics** and manage their devices. | FR-K2, FR-I1 |
| **BR-9** | The user must **own their data** — private, exportable (JSON), and deletable in full. | FR-I3, FR-I4, NFR-1, NFR-8 |
| **BR-10** | The user must be able to produce a **shareable/exportable termination report** ("if it happens tomorrow"). | FR-G1 |
| **BR-11** | Every displayed AED figure must be **traceable** to the screen where its inputs live. | NFR-5 |
| **BR-12** | The app must display the **legal disclaimer** and point users to MOHRE / a licensed advisor. | NFR-7 |

---

## 8. Key business processes (to-be)

**P-1 First-run onboarding.** User signs up → registers a passkey → enters employment/ILOE/money/situation profile → seeds budget, loans, school fees, cheques → dashboard populates. *(Outcome: a complete termination picture on day one.)*

**P-2 Statement ingestion cycle.** User uploads a statement → file queued in private storage → Claude Cowork routine parses it → transactions land as `pending` → user bulk-confirms in the Review inbox → dashboards, budget-vs-actual, and cheque auto-matching update. *(Outcome: current data with minimal manual entry; nothing counts until confirmed.)*

**P-3 Deadline & cheque management.** Scheduled payments and legal deadlines generate calendar entries and 7/2-day reminders → user funds the account → matching confirmed transaction (or manual toggle) marks the item paid. *(Outcome: zero missed cheques or deadlines.)*

**P-4 Termination readiness review.** User opens the Termination Report → reviews itemized settlement, ILOE, runway, scenarios, cheque exposure, readiness score → exports PDF → works the action plan against computed deadlines. *(Outcome: verified settlement, timely ILOE claim, managed runway.)*

---

## 9. Success metrics (KPIs)

| Metric | Target |
|---|---|
| Accuracy of engine outputs vs §11 acceptance tests | **100%** of rows and edge cases pass |
| Missed cheque fundings while using the app | **0** |
| ILOE claim submitted within deadline | **Within 30 days**, prompted by countdown |
| Settlement discrepancy caught | Employer payment reconciled against app's itemized figure every time |
| Data currency effort | Statement reflected in dashboards after a single bulk-confirm, **no manual re-keying** |
| Time to answer "am I ready?" | **≤ 1 tap** from app open to runway + report |
| Data control | User can export **all** data (JSON) and delete **all** data on demand |
| Security incidents involving financial data exposure | **0** |

---

## 10. Business risks (with mitigations)

| ID | Risk | Business impact | Mitigation |
|---|---|---|---|
| RB-1 | Engine gives a legally wrong figure the user acts on. | Financial loss / disputes. | Centralized dated constants; §11 test suite must pass; legal footer + "verify with MOHRE" on the report. |
| RB-2 | Statement mis-parsed by the LLM (wrong amount/sign). | Wrong runway/budget. | Everything lands `pending` for human confirmation; balance-continuity checks flag suspect rows. |
| RB-3 | Financial data reaches an LLM (Claude Cowork). | Privacy concern. | **Accepted risk** (OQ-1 closed in favour of Cowork-for-everything; no deterministic-only path). Residual controls: private bucket, least-privilege access, in-app disclosure, and mandatory human confirmation before any parsed row counts. |
| RB-4 | A reminder fails to reach the user, a cheque bounces. | Legal/financial jeopardy. | Dual-channel (email guaranteed + push best-effort), 7 & 2-day lead, prominent cheque styling, dashboard exposure tile. |
| RB-5 | Timezone error fires deadlines on the wrong day. | Missed deadline. | All date math in Asia/Dubai; boundary tests. |
| RB-6 | Biometric auth unsupported on the user's device/browser. | Lockout / friction. | Email/OTP always available as recoverable path; passkey never the sole factor. |
| RB-7 | UAE rules change after July 2026. | Stale figures. | Dated constants, visible "current as of" note, straightforward constant updates. |

---

## 11. Cost / benefit (qualitative)

**Benefits.** Avoided bounced-cheque penalties and legal exposure; correctly claimed ILOE (up to AED 20,000/month × 3 where eligible); verified — and if necessary escalated — employer settlement; reduced stress and better spending decisions extending runway. For the §11 reference profile the app quantifies **AED 220,479** of total resources and a **9.6-month** runway at a glance — the kind of clarity that changes decisions.

**Costs.** Delivery effort across Stages 2–4; Supabase hosting; Claude Cowork ingestion runs; ongoing maintenance of legal constants. All modest relative to a single avoided cheque-bounce or missed ILOE claim.

---

## 12. Open business decisions

These need your input; each is detailed in `stage-1-requirements.md` §9.

- ~~**OQ-1**~~ **CLOSED 30 Jul 2026** — Decided in favour of **Claude Cowork parsing every statement**. Privacy surface traded for format coverage; recorded as accepted risk RB-3.
- **OQ-3** — Confirm the good/warning/critical runway boundaries (`≥6 good, 3≤r<6 warning, r<3 critical`).
- **OQ-5** — Accept email as the guaranteed reminder channel with push best-effort (iOS needs the PWA installed)?
- **OQ-7** — Use a Vercel default domain until you provide your own?

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Gratuity / End-of-service** | Lump sum owed on employment end, based on **basic** salary and years of service (UAE Decree-Law 33/2021). |
| **ILOE** | Involuntary Loss of Employment insurance scheme; pays up to 60% of average basic salary (capped) for up to 3 months if eligible; **30-day** claim window. |
| **Notice-in-lieu** | Payment for notice days waived by the employer (based on **gross** salary). |
| **Final settlement** | Gratuity + leave encashment + notice-in-lieu + other owed − employer dues; due within **14 days** of last working day. |
| **Runway** | Months the user's total resources last against net monthly burn. |
| **Survival budget** | Reduced spending plan used to estimate runway during a job search. |
| **Post-dated cheque** | Cheque dated in the future; in the UAE a bounced cheque carries civil and potential criminal consequences. |
| **Claude Cowork** | Scheduled Claude session that parses uploaded bank statements into transactions. |
| **Runway status** | Good (≥6 months) / Warning (3–6) / Critical (<3), always shown with an icon and label. |

---

## 14. Approval / sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Product owner / sponsor | *(you)* | ☐ Approve ☐ Approve with changes ☐ Reject | |

**Legal footer (must appear in-app):** "General information, not legal or financial advice. UAE rules current as of July 2026 — verify with MOHRE (600 590 000) or a licensed advisor. Free-zone contracts may differ."

---

*On approval, this BRD and the Stage 1 requirements together baseline the build. Next stage: Stage 2 — information architecture, high-fidelity mockups (desktop + mobile, light + dark) for every screen, and the ERD + architecture diagram.*
