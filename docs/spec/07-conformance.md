# Conformance

**[`conformance.json`](./conformance.json) is the executable half of this specification.**

It contains one reference profile and every figure the engine computes from it. A reimplementation can feed the `profile` object into its own engine and compare the result against `expected` — which turns *"read the document and hope"* into *"run the fixture and know"*.

Every other document here describes intent. This one can be checked.

---

## How to use it

```
1. Read conformance.json → profile
2. Compute your settlement, ILOE, deadlines and derived figures from it
3. Compare against conformance.json → expected
```

Compare **exactly**, not within a tolerance. See below.

---

## The reference profile

The §11 acceptance profile — a UAE private-sector employee with seven and a bit years of service, terminated at the end of September 2026.

| | |
| --- | --- |
| Basic salary | AED 15,000 |
| Gross salary | AED 25,000 |
| Employment start | 2019-06-01 |
| Expected last day | 2026-09-30 |
| Unused leave | 12 days |
| Notice period | 30 days, none paid in lieu |
| ILOE | Subscribed 12 months, involuntary termination, average basic 15,000 |
| Savings | 80,000 cash + 20,000 other liquid |
| Visa grace | 90 days |

The gap between basic and gross is the point of this profile. Gratuity is computed on **basic**; notice in lieu on **gross**. An implementation that uses one figure throughout produces a plausible total that is wrong by tens of thousands.

---

## What it must produce

| Figure | Expected |
| --- | --- |
| Service days | **2,678** |
| Service years | **7.3319644079397674** |
| Daily basic | **500** |
| Gratuity days | **174.95893223819303** |
| **Gratuity** | **AED 87,479.47** |
| Gratuity cap | 360,000 — not applied |
| Leave encashment | **AED 6,000** |
| Notice pay in lieu | **0** |
| **Final settlement** | **AED 93,479.47** |
| ILOE category | **A** (average basic ≤ 16,000) |
| ILOE monthly benefit | **AED 9,000** (60% of 15,000, under the 10,000 cap) |
| ILOE total | **AED 27,000** (three months) |
| Settlement due | **2026-10-14** |
| ILOE deadline | **2026-10-30** — hard |
| Visa grace ends | **2026-12-29** |
| Cheque exposure, 6 months | **AED 101,000** |
| Cheque exposure, 12 months | **AED 137,000** |
| Monthly debt service | **AED 6,000** |
| Monthly school fees | **AED 3,000** |

---

## Why the values are unrounded

`7.3319644079397674` looks like a mistake and is not.

Service years divide by **365.25**, not 365, and gratuity accrues at 21 days per year — so the precision propagates all the way into the settlement. Rounding it in the fixture would hide a genuine disagreement between two implementations behind a tolerance, and exposing disagreement is this file's entire purpose.

Money is rounded **for display only, never in the engine** (invariant I-14). A figure rounded twice, or summed after rounding, is wrong by an amount too small to notice.

---

## It cannot drift

`lib/engine/conformance.test.ts` asserts every value above against the live engine, and additionally asserts that the fixture's copy of the profile still matches the seed.

That copy is a second source for one fact, which invariant I-8 warns against — so it is *checked* rather than trusted. If the seed moves and the fixture does not, the build fails.

**Negative control:** changing `GRATUITY_DAYS_FIRST_5Y` from 21 to 22 fails the gratuity and final-settlement assertions and leaves the other seven passing. The fixture is load-bearing, not decorative.

---

## If the test fails

Either the engine changed and the fixture must be regenerated, **or the engine changed and should not have.**

Decide which before regenerating. A fixture updated reflexively is not a specification — it is a record of whatever the code happens to do today.

---

## What this fixture does not cover

Stated so that passing it is not mistaken for correctness.

- **The projection and runway**, which depend on budget, payments and income streams as well as the profile, and on a horizon. Covered by `lib/engine/projection.test.ts`.
- **The readiness score**, covered by `lib/engine/readiness.test.ts`.
- **Statement ingestion**, covered by `lib/ingestion/*.test.ts` — including the refusals, which matter more than the successes.
- **Everything about the legal rules being correct.** This fixture proves an implementation matches *this* engine. Whether this engine matches current UAE law is a separate question, and an open one — see the warning at the top of [`02-domain-rules.md`](./02-domain-rules.md).
