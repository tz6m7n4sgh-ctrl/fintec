/**
 * Projection tests — the double-count rule (G-1) and the zero-crossing that the
 * flat-burn runway figure cannot see.
 */

import { describe, expect, it } from 'vitest';

import { monthlyActuals, projectCash } from './projection';
import type { ActualTransaction } from './projection';
import type { Runway, ScheduledPayment } from './types';
import { computeReadiness } from './uae';
import { SEED_BUDGET, SEED_PAYMENTS, SEED_PROFILE } from '@/lib/data/seed';

const RUNWAY: Runway = {
  totalResources: 220_479.47,
  survivalSpend: 23_000,
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
    const r = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS);
    const p = projectCash(r.runway, SEED_PAYMENTS, SEED_PROFILE.expectedLastDay);
    expect(p.totalLumpSums).toBe(65_000);
    expect(p.zeroCrossingMonth).toBe(7);
  });
});
