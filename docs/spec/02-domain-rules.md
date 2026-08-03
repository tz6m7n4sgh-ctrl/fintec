# Domain rules

The UAE calculation rules, as implemented in `lib/engine/uae.ts`.

> **Read this warning before relying on any figure here.**
>
> These constants were recorded as *"current as of July 2026"* under Federal Decree-Law 33/2021 and the ILOE scheme. **They carry no citation to a specific article, and no verification date that anything checks.** This document describes what the engine computes; it is not a statement of law.
>
> Phase 2's workstream A exists to fix exactly this — source each rule from the current legal text, store it with the provision it comes from and the date it was verified, and surface that date in the app. Until then, the app presents figures as its own calculation, not as legal entitlement.
>
> **Do not generate legal citations from memory when reimplementing this.** A wrong article number quoted in an HR meeting destroys the user's credibility at the moment they most need it.

---

## Constants

All in one block in `lib/engine/uae.ts`, deliberately — when the rules change, that block is the whole edit.

| Constant | Value | Meaning |
| --- | --- | --- |
| `DAYS_PER_MONTH` | 30 | Monthly salary → daily rate |
| `DAYS_PER_YEAR` | 365.25 | Service days → years |
| `GRATUITY_DAYS_FIRST_5Y` | 21 | Accrual per year, first five years |
| `GRATUITY_DAYS_AFTER_5Y` | 30 | Accrual per year beyond five |
| `GRATUITY_MIN_YEARS` | 1 | Below this, no entitlement |
| `GRATUITY_CAP_MONTHS` | 24 | Cap, in months of basic salary |
| `ILOE_RATE` | 0.6 | Proportion of average basic paid |
| `ILOE_CATEGORY_THRESHOLD` | 16,000 | At or below → Category A |
| `ILOE_CAP_A` / `ILOE_CAP_B` | 10,000 / 20,000 | Monthly caps by category |
| `ILOE_MAX_MONTHS` | 3 | Maximum benefit duration |
| `SETTLEMENT_DUE_DAYS` | 14 | From last working day |
| `ILOE_CLAIM_DAYS` | 30 | **Hard window** from termination |
| `CHEQUE_WINDOW_6M` / `_12M` | 183 / 366 | Cheque exposure horizons, days |
| `OVERSTAY_AED_PER_DAY` | 50 | Penalty after visa grace expires |

---

## The rule that costs the most if you get it wrong

**Gratuity is calculated on BASIC salary only — never gross.**

Gross includes allowances and is typically far larger. In the reference profile the two are 15,000 and 25,000: computing on gross would overstate the settlement by roughly two thirds, and the user would plan around money that is not coming.

This is also why the profile form carries inline help on that field specifically, and why the database enforces `gross >= basic` — a user who transposes them would otherwise get a *smaller* settlement and never know.

---

## Service period

```
serviceDays  = daysBetween(employmentStart, expectedLastDay) − unpaidLeaveDays
serviceYears = serviceDays / 365.25
```

Unpaid leave is deducted from service before anything is computed from it. `365.25` rather than `365` is a deliberate decision (§5.1, C-3) — over a multi-year service period the difference is real.

---

## Gratuity

Accrues at 21 days of basic per year for the first five years, then 30 days per year beyond. Below one year of service there is no entitlement. The total is capped at 24 months of basic salary.

The daily rate is `basicSalary / 30`.

`gratuity()` returns a **breakdown**, not a total — the first-five-years portion, the beyond-five portion, whether the cap bound, and the sum. That is not decoration: the user has to be able to restate the working, and Phase 2 makes that the primary interface.

---

## The rest of the settlement

**Leave encashment** — unused leave days at the basic daily rate (`basic ÷ 30` per day).

**Notice pay in lieu** — days paid in lieu at the **gross** daily rate. This is the one component computed on gross rather than basic, which is exactly the sort of asymmetry that makes a hand-written reimplementation drift.

**Final settlement** = gratuity + leave encashment + notice in lieu + other owed to employee − owed to employer.

**Employer must settle within 14 days** of the last working day.

---

## ILOE

Unemployment insurance. Pays **60% of average basic salary over the preceding six months**, capped monthly by category, for at most three months.

- Average basic at or below **16,000** → Category A, capped at **10,000/month**
- Above → Category B, capped at **20,000/month**

Eligibility requires having been subscribed for the preceding twelve months **and** that the termination was involuntary. Both are stored on the profile and both gate the benefit.

**The claim window is 30 days from termination and it is hard.** It is the one deadline in this application that cannot be recovered from, which is why the action-plan checklist marks it explicitly as such.

---

## Deadlines

Computed from the profile, not stored:

| Key | Derivation |
| --- | --- |
| `beforeLastDay` / `lastDay` | The expected last day |
| `settlementDue` | Last day + 14 days |
| `iloeDeadline` | Last day + 30 days — **hard** |
| `visaGraceEnd` | Last day + the profile's visa grace days |
| `healthCoverEnd` | Last day + health cover months |

Derived rather than stored so that correcting the rule, or the last day, reaches every user immediately (invariant I-8).

---

## Runway and projection

**Total resources** = final settlement + ILOE benefit + cash savings + other liquid assets.

`projectCash()` walks forward month by month — default horizon 18 — subtracting committed outflows and adding any income that continues past the last day, and reports where the balance crosses zero.

**Runway bands** are half-open by decision (OQ-3/C-2): **6.0 months is good, 3.0 is warning.** Exactly six is good, not borderline.

> **Known modelling simplification, and it matters.** `projectCash()` starts from total resources, which already includes the final settlement — so the projection treats settlement money as present from day zero rather than arriving 14 days after the last working day. Any rule that depends on *when* money lands (for example, "is this cheque due before the settlement arrives") cannot currently be derived. This is the substance of the open `atRisk` question.

---

## Scheduling

Scheduled payments carry a first due date and a recurrence step in months. `expandPayments()` produces dated **occurrences** over an 18-month generation horizon.

**Everything downstream keys on occurrences, not on payment rows.** A quarterly rent cheque is four occurrences a year and must be reminded four times. Keying reminders on the payment row instead is a defect this codebase actually shipped and had to correct with a migration.

School fees are expanded into scheduled payments by `schoolFeeObligations()` rather than stored twice.

---

## Settlement of obligations against reality

A scheduled payment reads as **paid** when a confirmed transaction matches it. `effectiveStatus()` derives this; nothing writes `paid` onto the row.

Derivation rather than storage is what makes un-matching revert cleanly and lose nothing — including an `atRisk` flag that a write would have destroyed.

`isOutstanding()` is written as *"status is not paid"* rather than *"status is upcoming"*, deliberately: a status added later defaults to **counted** rather than silently dropping out of the exposure figures.

---

## Cheque exposure

`chequesInWindow()` and `chequeExposure()` total outstanding cheques falling within 183 or 366 days of the last working day.

Cheques are separated from other obligations throughout because of the criminal exposure. A missed cheque is not a late payment.

---

## Readiness score

An 18-point rubric across the criteria above, banded:

- **STRONG** ≥ 14
- **MODERATE** ≥ 9
- **AT RISK** below

`scoreReadiness()` returns each criterion with its own score and reason, not just a total — a score a user cannot decompose is a score they cannot act on.

---

## Purity

**Every function in `lib/engine` is pure.** Same inputs, same outputs, no clock, no I/O, no framework.

The only time-dependent values are countdowns, which live in `lib/engine/dates.ts` and take an injectable `now`. `todayInDubai()` computes the current date in Asia/Dubai — never the server's timezone — and the UAE observes no daylight saving, which is why the reminder cron can be a fixed UTC hour.

That purity is what makes the engine exhaustively testable and what makes it the part of this codebase most worth preserving in any rewrite.
