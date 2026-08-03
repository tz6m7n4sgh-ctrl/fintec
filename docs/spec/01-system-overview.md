# System overview

## What this is

A personal finance and **termination-readiness** application for a private-sector employee in the UAE.

It answers one question in three forms:

> *If my job ends on a given date — what am I owed, what must I still pay, how long does my money last, and what deadlines can I not miss?*

It is not a budgeting app that happens to compute a settlement. The settlement, the runway and the deadlines are the point; the budget and the transaction ledger exist to feed them.

## Why the UAE specifically

The jurisdiction is not a localisation detail — it is most of the domain.

- **End-of-service gratuity** is a statutory entitlement calculated on *basic* salary, accruing at different rates before and after five years of service.
- **ILOE** (unemployment insurance) pays a capped percentage of average basic salary, for a limited period, and has a **hard 30-day claim window** from termination. Miss it and the entitlement is gone.
- **The residence visa is tied to the employer.** Termination starts a grace period, after which overstay accrues a daily penalty.
- **A bounced cheque carries civil and potential criminal consequences.** Post-dated cheques are ordinary instruments for rent and school fees, which means a cash-flow gap is not merely uncomfortable.

That last point shapes the whole application. It is why reminders exist, why email is the guaranteed channel rather than a preference, and why "will this cheque clear" is a first-class question rather than a derived one.

## Who it is for

**Phase 1** was built for a single user — its author — with a schema and security model already multi-user.

**Phase 2 targets UAE expats generally.** That changes the requirements substantially: a first run, a value moment inside a minute, and language that assumes no knowledge of UAE labour law. See [`../phase-2-discovery.md`](../phase-2-discovery.md).

## The three situations a user arrives in

Recorded in discovery, and they are genuinely different products if handled naively:

| | Situation | What they need |
| --- | --- | --- |
| 1 | **Termination has happened** | A letter and a last day. Panicked and time-boxed. One number, and this week's actions. |
| 2 | **They expect it within months** | Restructuring, an ending contract. Planning: *March versus June*. |
| 3 | **General planning** | Nothing imminent. Where do I stand. |

**They unify** if the core answer is treated not as a number but as **a function of a date**: *if your last day were `[date]`, you are owed `[X]`*. Fixed for the first, a slider for the second, today for the third. One engine, one screen, three doorways.

Phase 1 does not do this — the last day is a profile field several clicks from the dashboard. Phase 2 does.

## What the system does, in order

1. **Collects a profile** — employment dates, basic and gross salary, leave, notice, ILOE status, savings, dependents, visa grace.
2. **Computes the settlement** — gratuity, leave encashment, notice pay in lieu, less anything owed to the employer.
3. **Computes the deadlines** — settlement due, ILOE claim window, visa grace expiry, health cover end.
4. **Projects cash forward** — resources against committed outflows, month by month, to a zero-crossing.
5. **Schedules the obligations** — recurring payments, cheques, school fees, loan instalments, expanded into dated occurrences.
6. **Ingests bank statements** — CSV parsed deterministically, deduplicated, held pending until a human confirms each row.
7. **Reminds** — 7 and 2 days before every cheque and school-fee occurrence, by email.
8. **Scores readiness** — an 18-point rubric across the criteria above, banded STRONG / MODERATE / AT RISK.

## What it deliberately does not do

- **Investments, tax, or any jurisdiction other than UAE onshore.** Free-zone contracts are disclaimed explicitly.
- **Legal advice.** It computes from stated rules and shows its working. The citation model exists and is deliberately empty — every rule records that nobody has sourced it, and the app renders that beside the figure rather than implying more.
- **Automatic anything that moves a number.** Every machine-derived row waits for human confirmation (invariant I-4).
- **PDF statement parsing.** Refused by name with an instruction to export CSV, because a PDF read as plain text produces a scatter of numbers that a lenient parser turns into convincing, wrong transactions.

## Shape of the codebase

```
lib/engine/      pure calculation — no clock, no I/O, no framework
lib/ingestion/   statement parsing and deduplication, also pure
lib/data/        the read model, the repository, and the §11 seed
app/             Next.js App Router screens and server actions
supabase/        migrations, and Edge Functions for work needing service-role
e2e/             Playwright, against a production build
```

**`lib/engine` is the asset.** It is pure, exhaustively tested, and framework-free. A reimplementation that changes everything else and keeps this has kept the part that is hard to get right.
