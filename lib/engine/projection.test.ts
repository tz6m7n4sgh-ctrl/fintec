/**
 * Projection tests — the double-count rule (G-1) and the zero-crossing that the
 * flat-burn runway figure cannot see.
 */

import { describe, expect, it } from 'vitest';

import {
  deriveAtRisk,
  isPaymentAtRisk,
  monthlyActuals,
  projectCash,
  projectCashWithSettlementArrival,
  projectedBalanceBefore,
} from './projection';
import type { ActualTransaction, SettlementArrival } from './projection';
import type { Runway, ScheduledPayment } from './types';
import { computeReadiness } from './uae';
import { SEED_BUDGET, SEED_INCOME, SEED_PAYMENTS, SEED_PROFILE } from '@/lib/data/seed';

const RUNWAY: Runway = {
  totalResources: 220_479.47,
  survivalSpend: 23_000,
  monthlySideIncome: 0,
  netMonthlyBurn: 23_000,
  runwayMonths: 220_479.47 / 23_000,
  status: 'good',
};

function cheque(
  id: string,
  dueDate: string,
  amount: number,
  includedInBudget: boolean,
  payee = id,
): ScheduledPayment {
  return {
    id, dueDate, payee, purpose: '', amount, account: 'ENBD ··4821',
    type: 'cheque', recurrence: 'none', includedInBudget, status: 'upcoming',
  };
}

const PAYMENTS: ScheduledPayment[] = [
  cheque('rent-q4', '2026-10-05', 18_000, true, 'Landlord'),
  cheque('family', '2026-12-10', 20_000, false, 'Family loan'),
  cheque('rent-q1', '2027-01-05', 18_000, true, 'Landlord'),
  cheque('school', '2027-01-12', 12_000, true, 'GEMS'),
  cheque('balloon', '2027-03-15', 45_000, false, 'ADCB balloon'),
];

describe('cash projection', () => {
  const p = projectCash(RUNWAY, PAYMENTS, '2026-09-30', 18);

  it('starts at total resources and runs for the full horizon', () => {
    expect(p.start).toBeCloseTo(220_479.47, 2);
    expect(p.points).toHaveLength(18);
    expect(p.points[0].label).toBe('Oct 26');
    expect(p.points[17].label).toBe('Mar 28');
  });

  it('subtracts only out-of-budget cheques as lump sums (G-1)', () => {
    // 20,000 + 45,000 — the three in-budget cheques are already in the burn.
    expect(p.totalLumpSums).toBe(65_000);

    const dec = p.points.find((x) => x.label === 'Dec 26')!;
    expect(dec.lumpSum).toBe(20_000);
    expect(dec.lumpSumPayees).toEqual(['Family loan']);

    const mar = p.points.find((x) => x.label === 'Mar 27')!;
    expect(mar.lumpSum).toBe(45_000);

    // In-budget cheque months carry no lump sum at all.
    expect(p.points.find((x) => x.label === 'Oct 26')!.lumpSum).toBe(0);
    expect(p.points.find((x) => x.label === 'Jan 27')!.lumpSum).toBe(0);
  });

  /*
   * HAD-82. The exposure tile and this projection both had to learn that a
   * cleared cheque is history. Fixing only the tile would have swapped one
   * silent disagreement for another — the headline dropping while the balance
   * kept deducting money that had already left the account.
   */
  it('stops deducting a cleared lump sum', () => {
    const settled = PAYMENTS.map((x) =>
      x.id === 'family' ? { ...x, status: 'paid' as const } : x,
    );
    const q = projectCash(RUNWAY, settled, '2026-09-30', 18);

    expect(q.points.find((x) => x.label === 'Dec 26')!.lumpSum).toBe(0);
    expect(q.points.find((x) => x.label === 'Dec 26')!.lumpSumPayees).toEqual([]);
    // 65,000 less the 20,000 that has cleared.
    expect(q.totalLumpSums).toBe(45_000);
  });

  it('still deducts an atRisk lump sum', () => {
    // The direction that matters. A cheque flagged as a problem is the thing
    // this projection exists to show, and dropping it would erase the warning.
    const risky = PAYMENTS.map((x) =>
      x.id === 'balloon' ? { ...x, status: 'atRisk' as const } : x,
    );
    const q = projectCash(RUNWAY, risky, '2026-09-30', 18);
    expect(q.points.find((x) => x.label === 'Mar 27')!.lumpSum).toBe(45_000);
    expect(q.totalLumpSums).toBe(65_000);
  });

  it('clearing an in-budget cheque changes nothing — G-1 still governs', () => {
    // It was never a lump sum, so the new filter must not make it one, and must
    // not accidentally start deducting it either.
    const settled = PAYMENTS.map((x) =>
      x.id === 'rent-q4' ? { ...x, status: 'paid' as const } : x,
    );
    expect(projectCash(RUNWAY, settled, '2026-09-30', 18).totalLumpSums).toBe(65_000);
  });

  it('computes the running balance correctly', () => {
    expect(Math.round(p.points[0].balance)).toBe(197_479); // Oct: −23,000
    expect(Math.round(p.points[1].balance)).toBe(174_479); // Nov: −23,000
    expect(Math.round(p.points[2].balance)).toBe(131_479); // Dec: −23,000 −20,000
    expect(Math.round(p.points[5].balance)).toBe(17_479);  // Mar: −23,000 −45,000
    expect(Math.round(p.points[17].balance)).toBe(-258_521);
  });

  it('reports the real zero-crossing, which is EARLIER than the flat runway', () => {
    // Flat-burn runway says ~9.6 months, i.e. around Jul 2027...
    expect(RUNWAY.runwayMonths).toBeCloseTo(9.586, 3);
    // ...but the lump sums bring the balance below zero in month 7.
    expect(p.zeroCrossingMonth).toBe(7);
    expect(p.zeroCrossingLabel).toBe('Apr 27');
    expect(p.zeroCrossingMonth).toBeLessThan(Math.floor(RUNWAY.runwayMonths));
  });

  it('flags below-zero months for shading', () => {
    const negatives = p.points.filter((x) => x.belowZero).map((x) => x.label);
    expect(negatives[0]).toBe('Apr 27');
    expect(negatives).toHaveLength(12);
  });

  it('combines several out-of-budget cheques falling in the same month', () => {
    const q = projectCash(
      RUNWAY,
      [cheque('a', '2026-12-05', 10_000, false, 'A'), cheque('b', '2026-12-20', 5_000, false, 'B')],
      '2026-09-30',
      4,
    );
    const dec = q.points.find((x) => x.label === 'Dec 26')!;
    expect(dec.lumpSum).toBe(15_000);
    expect(dec.lumpSumPayees).toEqual(['A', 'B']);
  });

  it('never crosses zero when burn is zero and nothing is out of budget', () => {
    const infinite: Runway = { ...RUNWAY, netMonthlyBurn: 0, runwayMonths: Infinity };
    const q = projectCash(infinite, [PAYMENTS[0]], '2026-09-30', 18);
    expect(q.zeroCrossingMonth).toBeNull();
    expect(q.zeroCrossingLabel).toBeNull();
    expect(q.points.every((x) => x.balance === infinite.totalResources)).toBe(true);
  });

  it('ignores cheques dated outside the horizon', () => {
    const q = projectCash(RUNWAY, [cheque('far', '2030-01-01', 99_000, false)], '2026-09-30', 18);
    expect(q.totalLumpSums).toBe(0);
  });
});

describe('monthly actuals', () => {
  const txns: ActualTransaction[] = [
    { date: '2026-08-05', amount: 1_000, direction: 'debit', reviewStatus: 'confirmed', isDuplicate: false },
    { date: '2026-08-20', amount: 500, direction: 'debit', reviewStatus: 'edited', isDuplicate: false },
    { date: '2026-08-25', amount: 25_000, direction: 'credit', reviewStatus: 'confirmed', isDuplicate: false },
    // Excluded: still pending review (US-31 — nothing counts until confirmed).
    { date: '2026-08-28', amount: 9_999, direction: 'debit', reviewStatus: 'pending', isDuplicate: false },
    // Excluded: flagged duplicate (US-30 — never double-counted).
    { date: '2026-08-05', amount: 1_000, direction: 'debit', reviewStatus: 'confirmed', isDuplicate: true },
    { date: '2026-09-03', amount: 2_000, direction: 'debit', reviewStatus: 'confirmed', isDuplicate: false },
  ];

  it('sums confirmed, non-duplicate rows by month', () => {
    const m = monthlyActuals(txns);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ label: 'Aug 26', spend: 1_500, income: 25_000 });
    expect(m[1]).toMatchObject({ label: 'Sep 26', spend: 2_000, income: 0 });
  });

  it('excludes pending rows so unreviewed data cannot move the dashboard', () => {
    const withPending = monthlyActuals(txns)[0].spend;
    const confirmed = monthlyActuals(
      txns.map((t) => (t.reviewStatus === 'pending' ? { ...t, reviewStatus: 'confirmed' as const } : t)),
    )[0].spend;
    expect(withPending).toBe(1_500);
    expect(confirmed).toBe(11_499); // only changes once confirmed
  });

  it('returns months in chronological order', () => {
    const m = monthlyActuals([
      { date: '2026-12-01', amount: 1, direction: 'debit', reviewStatus: 'confirmed', isDuplicate: false },
      { date: '2026-01-01', amount: 1, direction: 'debit', reviewStatus: 'confirmed', isDuplicate: false },
    ]);
    expect(m.map((x) => x.label)).toEqual(['Jan 26', 'Dec 26']);
  });

  it('returns an empty series when nothing is confirmed', () => {
    expect(monthlyActuals([{ date: '2026-01-01', amount: 5, direction: 'debit', reviewStatus: 'pending', isDuplicate: false }])).toEqual([]);
  });
});

describe('lump sums at the window boundary', () => {
  /**
   * The first projected month is startDate + 1 month, so a payment due between
   * startDate and the end of startDate's own month used to land on a key the
   * loop never looked up — and vanish.
   *
   * chequeExposure() counts from the last working day INCLUSIVE, so such a
   * cheque appeared in the dashboard's exposure tile while the projection never
   * deducted it. The two figures disagreed, and the projection was the
   * optimistic one.
   */
  const startDate = '2026-09-30';

  function cheque(dueDate: string, amount: number): ScheduledPayment {
    return {
      id: `c-${dueDate}`,
      payee: `Cheque ${dueDate}`,
      type: 'cheque',
      amount,
      dueDate,
      recurrence: 'none',
      includedInBudget: false,
      purpose: 'Rent',
      account: 'ENBD',
      status: 'upcoming',
    };
  }

  const runway = {
    totalResources: 100_000,
    survivalSpend: 10_000,
    monthlySideIncome: 0,
    netMonthlyBurn: 10_000,
    runwayMonths: 10,
    status: 'good' as const,
  };

  it('deducts a cheque due exactly on the start date', () => {
    const p = projectCash(runway, [cheque(startDate, 30_000)], startDate);
    expect(p.totalLumpSums).toBe(30_000);
    // Folded into month 1 rather than lost.
    expect(p.points[0].lumpSum).toBe(30_000);
  });

  it('deducts a cheque falling between the start date and the first projected month', () => {
    // startDate is 30 Sep; the first projected point is 30 Oct. A cheque on
    // 5 Oct sits inside that gap.
    const p = projectCash(runway, [cheque('2026-10-05', 15_000)], startDate);
    expect(p.totalLumpSums).toBe(15_000);
    expect(p.points[0].lumpSum).toBe(15_000);
  });

  it('ignores a payment that is already in the past', () => {
    const p = projectCash(runway, [cheque('2026-08-01', 99_000)], startDate);
    expect(p.totalLumpSums).toBe(0);
  });

  it('leaves the reference profile unchanged', () => {
    // No §11 payment falls in the gap, so the acceptance figures must not move.
    const r = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
    const p = projectCash(r.runway, SEED_PAYMENTS, SEED_PROFILE.expectedLastDay);
    expect(p.totalLumpSums).toBe(65_000);
    expect(p.zeroCrossingMonth).toBe(7);
  });
});

/*
 * Integer figures throughout the arrival suites, deliberately: several tests
 * assert that two models produce IDENTICAL points, and integer arithmetic is
 * exact in floating point where 220,479.47 − 93,479.47 + 93,479.47 need not
 * be. The seed's real decimals are exercised separately, against inequalities
 * with thousands of dirhams of margin.
 */
const ARRIVAL_RUNWAY: Runway = {
  totalResources: 220_000,
  survivalSpend: 23_000,
  monthlySideIncome: 0,
  netMonthlyBurn: 23_000,
  runwayMonths: 220_000 / 23_000,
  status: 'good',
};

/** Last day 30 Sep + SETTLEMENT_DUE_DAYS(14), as `deadlines.settlementDue`. */
const ARRIVAL: SettlementArrival = { amount: 93_000, arrivesOn: '2026-10-14' };

describe('settlement arrival (HAD-83)', () => {
  const START = '2026-09-30';

  it('withholds the settlement from the start and credits it on arrival', () => {
    const p = projectCashWithSettlementArrival(ARRIVAL_RUNWAY, PAYMENTS, START, ARRIVAL, 18);
    // What the user actually holds on the last working day — not what they
    // are owed.
    expect(p.start).toBe(127_000);
    // By the first month-end the settlement has landed: 127,000 + 93,000 − 23,000.
    expect(p.points[0].balance).toBe(197_000);
  });

  it('month-end points and the zero-crossing match the day-zero model exactly', () => {
    // The arrival (day 14) precedes the first month-end, so at monthly
    // resolution nothing after `start` may move — this is what keeps the
    // /money chart's documented figures stable.
    const timed = projectCashWithSettlementArrival(ARRIVAL_RUNWAY, PAYMENTS, START, ARRIVAL, 18);
    const dayZero = projectCash(ARRIVAL_RUNWAY, PAYMENTS, START, 18);
    expect(timed.points).toEqual(dayZero.points);
    expect(timed.zeroCrossingMonth).toBe(dayZero.zeroCrossingMonth);
    expect(timed.totalLumpSums).toBe(dayZero.totalLumpSums);
  });

  it('a settlement already arrived by the start date IS the day-zero model', () => {
    // The degenerate case projectCash delegates through — including `start`.
    const timed = projectCashWithSettlementArrival(
      ARRIVAL_RUNWAY,
      PAYMENTS,
      START,
      { amount: 93_000, arrivesOn: START },
      18,
    );
    expect(timed).toEqual(projectCash(ARRIVAL_RUNWAY, PAYMENTS, START, 18));
  });

  it('an arrival in the gap before the first month-end is folded into month 1, not lost', () => {
    // Same fold rule as a lump sum in the gap: startDate 20 Jan, first
    // projected point 20 Feb, arrival 25 Jan — a key the loop never visits.
    const runway: Runway = { ...ARRIVAL_RUNWAY, totalResources: 100_000, netMonthlyBurn: 10_000 };
    const p = projectCashWithSettlementArrival(
      runway,
      [],
      '2026-01-20',
      { amount: 40_000, arrivesOn: '2026-01-25' },
      3,
    );
    expect(p.start).toBe(60_000);
    expect(p.points[0].balance).toBe(90_000); // 60,000 + 40,000 − 10,000
  });

  it('a LATE settlement drags the early months down and pulls the crossing forward', () => {
    // The general case the model exists for: an employer who does not pay in
    // 14 days. Day-zero says month 6; with the money actually absent, the
    // balance is negative by month 2 — the difference is precisely the claim
    // the old model could not make.
    const runway: Runway = {
      totalResources: 50_000,
      survivalSpend: 10_000,
      monthlySideIncome: 0,
      netMonthlyBurn: 10_000,
      runwayMonths: 5,
      status: 'warning',
    };
    const late: SettlementArrival = { amount: 40_000, arrivesOn: '2027-01-15' };
    const dayZero = projectCash(runway, [], START, 18);
    const timed = projectCashWithSettlementArrival(runway, [], START, late, 18);

    expect(dayZero.zeroCrossingMonth).toBe(6);
    expect(timed.zeroCrossingMonth).toBe(2);
    // Once the settlement lands the two models converge again.
    expect(timed.points[17].balance).toBe(dayZero.points[17].balance);
  });
});

describe('projectedBalanceBefore', () => {
  const START = '2026-09-30';

  it('excludes the settlement before it arrives and includes it after', () => {
    const before = projectedBalanceBefore(ARRIVAL_RUNWAY, [], START, ARRIVAL, '2026-10-05');
    const after = projectedBalanceBefore(ARRIVAL_RUNWAY, [], START, ARRIVAL, '2026-10-20');
    expect(before).toBe(127_000);
    expect(after).toBe(220_000);
  });

  it('boundary: money due the same day has not arrived; the day after, it has', () => {
    // A cheque presented the morning the settlement is due cannot count on it
    // having cleared — same-day is treated as not-yet-there (conservative,
    // R-5).
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, [], START, ARRIVAL, '2026-10-14')).toBe(127_000);
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, [], START, ARRIVAL, '2026-10-15')).toBe(220_000);
  });

  it('subtracts month-anniversary burn and strictly-earlier out-of-budget lumps', () => {
    // 3 anniversaries (30 Oct/Nov/Dec) + the 20,000 family cheque (10 Dec).
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, PAYMENTS, START, ARRIVAL, '2027-01-05')).toBe(
      220_000 - 3 * 23_000 - 20_000,
    );
    // On the balloon's own date the balloon itself is NOT subtracted —
    // strictly-before only, so a payment is never judged against a balance
    // that already paid it.
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, PAYMENTS, START, ARRIVAL, '2027-03-15')).toBe(
      220_000 - 5 * 23_000 - 20_000,
    );
    // Past the balloon, both lumps are gone: 6 anniversaries + 65,000.
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, PAYMENTS, START, ARRIVAL, '2027-04-05')).toBe(
      220_000 - 6 * 23_000 - 65_000,
    );
  });

  it('a cleared lump has already left a balance that reflects it (HAD-82)', () => {
    const settled = PAYMENTS.map((x) =>
      x.id === 'family' ? { ...x, status: 'paid' as const } : x,
    );
    expect(projectedBalanceBefore(ARRIVAL_RUNWAY, settled, START, ARRIVAL, '2027-01-05')).toBe(
      220_000 - 3 * 23_000,
    );
  });
});

describe('deriving atRisk (HAD-83 / HAD-110)', () => {
  const START = '2026-09-30';

  it('timing risk: a cheque due before the settlement lands is judged against cash on hand', () => {
    // The first seed row's implicit rule. 100,000 of resources, 80,000 of it
    // the settlement — until 14 Oct there is only 20,000 in the account.
    const runway: Runway = { ...ARRIVAL_RUNWAY, totalResources: 100_000, netMonthlyBurn: 10_000 };
    const settle: SettlementArrival = { amount: 80_000, arrivesOn: '2026-10-14' };
    const early = cheque('big', '2026-10-05', 30_000, false);
    expect(isPaymentAtRisk(early, [early], runway, START, settle)).toBe(true);
    // The identical cheque six days after the arrival clears comfortably.
    const late = { ...early, dueDate: '2026-10-20' };
    expect(isPaymentAtRisk(late, [late], runway, START, settle)).toBe(false);
  });

  it('boundary: due ON the arrival day is still at risk; due the day after is not', () => {
    const runway: Runway = { ...ARRIVAL_RUNWAY, totalResources: 100_000, netMonthlyBurn: 10_000 };
    const settle: SettlementArrival = { amount: 80_000, arrivesOn: '2026-10-14' };
    const onDay = cheque('on', '2026-10-14', 30_000, false);
    const dayAfter = cheque('after', '2026-10-15', 30_000, false);
    expect(isPaymentAtRisk(onDay, [onDay], runway, START, settle)).toBe(true);
    expect(isPaymentAtRisk(dayAfter, [dayAfter], runway, START, settle)).toBe(false);
  });

  it('magnitude risk: the SAME test catches a cheque the thinned-out balance cannot cover', () => {
    // The second seed row's implicit rule, needing no second rule: by
    // 5 Apr 2027 the projected balance is 17,000 and an 18,000 rent cheque
    // does not fit — while the 45,000 balloon three weeks earlier still does
    // (85,000 available). Risk follows the balance, not the amount.
    const rentQ2 = cheque('rent-q2', '2027-04-05', 18_000, true, 'Landlord');
    const list = [...PAYMENTS, rentQ2];
    expect(isPaymentAtRisk(rentQ2, list, ARRIVAL_RUNWAY, START, ARRIVAL)).toBe(true);
    const balloon = list.find((p) => p.id === 'balloon')!;
    expect(isPaymentAtRisk(balloon, list, ARRIVAL_RUNWAY, START, ARRIVAL)).toBe(false);
  });

  it('paid and already-past payments are never at risk', () => {
    const paid = { ...cheque('p', '2027-04-05', 999_000, false), status: 'paid' as const };
    expect(isPaymentAtRisk(paid, [paid], ARRIVAL_RUNWAY, START, ARRIVAL)).toBe(false);
    // The past is history, not exposure — mirrors the projection's own filter.
    const past = cheque('old', '2026-08-01', 999_000, false);
    expect(isPaymentAtRisk(past, [past], ARRIVAL_RUNWAY, START, ARRIVAL)).toBe(false);
  });

  it('ignores stored flags in both directions — stored atRisk is not a source of truth', () => {
    // A comfortably covered cheque hand-flagged atRisk, and an impossible one
    // stored as upcoming: the derivation overrides both, which is what "the
    // column stops being a source of truth" means in practice.
    const covered = { ...cheque('fine', '2026-10-01', 1_000, true), status: 'atRisk' as const };
    const drowning = cheque('too-big', '2026-12-05', 500_000, false); // status 'upcoming'
    const out = deriveAtRisk([covered, drowning], ARRIVAL_RUNWAY, START, ARRIVAL);
    expect(out.find((p) => p.id === 'fine')!.status).toBe('upcoming');
    expect(out.find((p) => p.id === 'too-big')!.status).toBe('atRisk');
  });

  it('clearing a large cheque un-flags the payments it was drowning', () => {
    const rentQ2 = cheque('rent-q2', '2027-04-05', 18_000, true, 'Landlord');
    const list = [...PAYMENTS, rentQ2];
    expect(isPaymentAtRisk(rentQ2, list, ARRIVAL_RUNWAY, START, ARRIVAL)).toBe(true);
    // Pay the 45,000 balloon and April's balance recovers to 62,000.
    const settled = list.map((p) => (p.id === 'balloon' ? { ...p, status: 'paid' as const } : p));
    expect(
      isPaymentAtRisk(settled.find((p) => p.id === 'rent-q2')!, settled, ARRIVAL_RUNWAY, START, ARRIVAL),
    ).toBe(false);
  });

  it('reference dataset: risk lands where the projection cannot cover — NOT where the seed once said', () => {
    /*
     * The two hand-set flags (HAD-83) do not survive contact with the rule:
     * Q4 rent (18,000 on 5 Oct) is covered by the 127,000 on hand even before
     * the settlement lands, and the balloon by the ~85,479 still projected on
     * its date. What IS at risk are the Q2 and Q3 rent cheques straddling the
     * month-7 zero-crossing — the derived flag and the chart now tell one
     * story. Pinned exactly so a change to either model has to explain itself
     * here.
     */
    const r = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
    const settle: SettlementArrival = {
      amount: r.settlement.finalSettlement,
      arrivesOn: r.deadlines.settlementDue,
    };
    expect(settle.arrivesOn).toBe('2026-10-14'); // last day + SETTLEMENT_DUE_DAYS
    const derived = deriveAtRisk(SEED_PAYMENTS, r.runway, SEED_PROFILE.expectedLastDay, settle);
    expect(derived.filter((p) => p.status === 'atRisk').map((p) => p.id)).toEqual([
      'pay-rent-q2',
      'pay-rent-q3',
    ]);
  });

  it('at-risk survives a manual mark-paid / un-mark round trip (HAD-83)', () => {
    /*
     * The assertion HAD-83 asked for, whichever option won. Under option A it
     * holds by construction — nothing stores the flag, so there is nothing a
     * write to `status` can destroy — but "by construction" is exactly the
     * kind of claim that stops being true when someone adds a cache or starts
     * persisting the derived value. This pins it.
     */
    const r = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
    const settle: SettlementArrival = {
      amount: r.settlement.finalSettlement,
      arrivesOn: r.deadlines.settlementDue,
    };
    const derive = (list: ScheduledPayment[]) =>
      deriveAtRisk(list, r.runway, SEED_PROFILE.expectedLastDay, settle);

    const before = derive(SEED_PAYMENTS);
    expect(before.find((p) => p.id === 'pay-rent-q2')!.status).toBe('atRisk');

    // Manual mark-paid writes `paid` (app/schedule/actions.ts)...
    const marked = before.map((p) =>
      p.id === 'pay-rent-q2' ? { ...p, status: 'paid' as const } : p,
    );
    expect(derive(marked).find((p) => p.id === 'pay-rent-q2')!.status).toBe('paid');

    // ...and un-marking writes `upcoming`, recording nothing about what was.
    const unmarked = marked.map((p) =>
      p.id === 'pay-rent-q2' ? { ...p, status: 'upcoming' as const } : p,
    );
    // The next read re-derives the flag — the whole list is exactly as it was.
    expect(derive(unmarked)).toEqual(before);
  });
});
