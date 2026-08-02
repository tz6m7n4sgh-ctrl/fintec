/**
 * Acceptance tests for the calculation engine.
 *
 * §11 of the build spec: "the build is wrong if these fail". Every row of the
 * acceptance table and every edge case below is asserted against the engine,
 * plus the boundary cases the spec left ambiguous (see C-2/OQ-3).
 */

import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, addMonths, formatDate, isWithin, todayInDubai } from './dates';
import {
  AUTO_ROW_ID,
  RULES,
  applyAutoRows,
  chequeExposure,
  computeReadiness,
  currentSpend,
  deadlines,
  finalSettlement,
  gratuity,
  iloeBenefit,
  leaveEncashment,
  monthlyDebtService,
  monthlySchoolFees,
  noticePayInLieu,
  runway,
  runwayFrom,
  runwayStatus,
  schoolFeeObligations,
  scenarios,
  servicePeriod,
  survivalSpend,
} from './uae';
import type {
  BudgetCategory, Debt, IncomeStream, Profile, ScheduledPayment, SchoolFee,
} from './types';
import { SEED_BUDGET, SEED_INCOME, SEED_PAYMENTS, SEED_PROFILE } from '@/lib/data/seed';

/** The §11 reference profile. */
const REF: Profile = {
  basicSalary: 15_000,
  grossSalary: 25_000,
  employmentStart: '2019-06-01',
  expectedLastDay: '2026-09-30',
  unpaidLeaveDays: 0,
  unusedLeaveDays: 12,
  noticePeriodDays: 30,
  noticeDaysPaidInLieu: 0,
  otherOwedToEmployee: 0,
  owedToEmployer: 0,
  iloeSubscribed12m: true,
  iloeInvoluntary: true,
  iloeAvgBasic6m: 15_000,
  cashSavings: 80_000,
  otherLiquidAssets: 20_000,
  dependents: 2,
  visaGraceDays: 90,
  healthCoverMonthsAfterEnd: 0,
};

/** Survival budget totalling 23,000 including auto rows (debt 6,000, school 3,000). */
const REF_DEBTS: Debt[] = [
  { id: 'd1', type: 'carLoan', name: 'Car loan', outstandingBalance: 48_000, monthlyPayment: 2_400, monthsRemaining: 20, lender: 'ADCB' },
  { id: 'd2', type: 'mortgage', name: 'Mortgage', outstandingBalance: 540_000, monthlyPayment: 3_600, monthsRemaining: 150, lender: 'FAB' },
];

/** Annual school fees of 36,000 → 3,000/month. */
const REF_FEES: SchoolFee[] = [
  { id: 'f1', child: 'Child 1', school: 'GEMS', term: 'Term 1', dueDate: '2026-09-05', amount: 12_000, paidByCheque: true, paid: true },
  { id: 'f2', child: 'Child 1', school: 'GEMS', term: 'Term 2', dueDate: '2027-01-12', amount: 12_000, paidByCheque: true, paid: false },
  { id: 'f3', child: 'Child 1', school: 'GEMS', term: 'Term 3', dueDate: '2027-04-20', amount: 12_000, paidByCheque: true, paid: false },
];

function refBudget(): BudgetCategory[] {
  const base: BudgetCategory[] = [
    { id: 'b1', name: 'Rent / housing', currentAmount: 8_000, survivalAmount: 7_000, editable: true },
    { id: 'b2', name: 'Utilities', currentAmount: 900, survivalAmount: 700, editable: true },
    { id: 'b3', name: 'Groceries', currentAmount: 3_200, survivalAmount: 2_400, editable: true },
    { id: 'b4', name: 'School fees', currentAmount: 0, survivalAmount: 0, editable: false, autoSource: 'schoolFees' },
    { id: 'b5', name: 'Transport', currentAmount: 1_200, survivalAmount: 800, editable: true },
    { id: 'b6', name: 'Health & insurance', currentAmount: 800, survivalAmount: 600, editable: true },
    { id: 'b7', name: 'Loan & mortgage payments', currentAmount: 0, survivalAmount: 0, editable: false, autoSource: 'debts' },
    { id: 'b8', name: 'Phone & subscriptions', currentAmount: 600, survivalAmount: 300, editable: true },
    { id: 'b9', name: 'Dining & entertainment', currentAmount: 2_500, survivalAmount: 400, editable: true },
    { id: 'b10', name: 'Family support', currentAmount: 1_500, survivalAmount: 1_000, editable: true },
    { id: 'b11', name: 'Other', currentAmount: 1_000, survivalAmount: 800, editable: true },
  ];
  return applyAutoRows(base, REF_DEBTS, REF_FEES);
}

const REF_CHEQUES: ScheduledPayment[] = [
  { id: 'p1', dueDate: '2026-10-05', payee: 'Landlord', purpose: 'Rent', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'p2', dueDate: '2026-12-10', payee: 'Family loan', purpose: 'Personal', amount: 20_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'none', includedInBudget: false, status: 'upcoming' },
  { id: 'p3', dueDate: '2027-01-05', payee: 'Landlord', purpose: 'Rent', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'p4', dueDate: '2027-01-12', payee: 'GEMS school', purpose: 'Term 2', amount: 12_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'termly', includedInBudget: true, status: 'upcoming' },
  { id: 'p5', dueDate: '2027-03-15', payee: 'ADCB balloon', purpose: 'Final instalment', amount: 45_000, account: 'ADCB ··9013', type: 'cheque', recurrence: 'none', includedInBudget: false, status: 'upcoming' },
  { id: 'p6', dueDate: '2027-04-05', payee: 'Landlord', purpose: 'Rent', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'p7', dueDate: '2027-04-20', payee: 'GEMS school', purpose: 'Term 3', amount: 12_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'termly', includedInBudget: true, status: 'upcoming' },
  { id: 'p8', dueDate: '2027-07-05', payee: 'Landlord', purpose: 'Rent', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  // A transfer inside the window must NOT count as cheque exposure.
  { id: 'p9', dueDate: '2026-10-08', payee: 'FAB mortgage', purpose: 'Debt service', amount: 3_600, account: 'FAB ··2277', type: 'autoDebit', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
];

// ===========================================================================
// §11 acceptance table
// ===========================================================================

describe('§11 acceptance table', () => {
  it('serviceYears ≈ 7.332', () => {
    const s = servicePeriod(REF);
    expect(s.serviceDays).toBe(2_678);
    expect(s.serviceYears).toBeCloseTo(7.332, 3);
  });

  it('gratuity = AED 87,479 (105 days + 69.96 days × 500/day, under the 360,000 cap)', () => {
    const g = gratuity(REF);
    expect(g.dailyBasic).toBe(500);
    expect(g.gratuityDays).toBeCloseTo(174.96, 2);
    expect(g.gratuityCap).toBe(360_000);
    expect(g.capApplied).toBe(false);
    expect(g.ineligible).toBe(false);
    expect(Math.round(g.gratuity)).toBe(87_479);
  });

  it('leaveEncashment = AED 6,000', () => {
    expect(leaveEncashment(REF)).toBe(6_000);
  });

  it('finalSettlement = AED 93,479', () => {
    expect(Math.round(finalSettlement(REF).finalSettlement)).toBe(93_479);
  });

  it('ILOE monthly / total = AED 9,000 / AED 27,000 (Category A, cap not hit)', () => {
    const i = iloeBenefit(REF);
    expect(i.eligible).toBe(true);
    expect(i.category).toBe('A');
    expect(i.monthlyCap).toBe(10_000);
    expect(i.capApplied).toBe(false);
    expect(i.monthlyBenefit).toBe(9_000);
    expect(i.iloeTotal).toBe(27_000);
  });

  it('totalResources = AED 220,479', () => {
    expect(Math.round(runway(REF, refBudget(), []).totalResources)).toBe(220_479);
  });

  it('netMonthlyBurn = AED 23,000', () => {
    const r = runway(REF, refBudget(), []);
    expect(r.survivalSpend).toBe(23_000);
    expect(r.netMonthlyBurn).toBe(23_000);
  });

  it('runwayMonths ≈ 9.6', () => {
    expect(runway(REF, refBudget(), []).runwayMonths).toBeCloseTo(9.586, 3);
  });

  it('scenario(12) ≈ −AED 55,521 → SHORTFALL', () => {
    const s = scenarios(runway(REF, refBudget(), []));
    const twelve = s.find((x) => x.months === 12)!;
    expect(Math.round(twelve.remaining)).toBe(-55_521);
    expect(twelve.shortfall).toBe(true);
  });

  it('settlementDue / iloeDeadline = 2026-10-14 / 2026-10-30', () => {
    const d = deadlines(REF, REF_CHEQUES);
    expect(d.settlementDue).toBe('2026-10-14');
    expect(d.iloeDeadline).toBe('2026-10-30');
  });
});

// ===========================================================================
// §11 edge cases
// ===========================================================================

describe('§11 edge cases', () => {
  it('serviceYears 0.9 → gratuity = 0', () => {
    // 0.9 × 365.25 ≈ 329 days of service.
    const p: Profile = { ...REF, employmentStart: '2026-01-01', expectedLastDay: '2026-11-26' };
    const s = servicePeriod(p);
    expect(s.serviceYears).toBeCloseTo(0.9, 2);
    const g = gratuity(p);
    expect(g.ineligible).toBe(true);
    expect(g.gratuity).toBe(0);
    expect(finalSettlement(p).gratuity).toBe(0);
  });

  it('basic 40,000 with avgBasic 40,000 → ILOE monthly = 20,000 (Category B cap binds, not 24,000)', () => {
    const i = iloeBenefit({ ...REF, basicSalary: 40_000, iloeAvgBasic6m: 40_000 });
    expect(i.category).toBe('B');
    expect(i.monthlyCap).toBe(20_000);
    expect(i.capApplied).toBe(true);
    // 60% of 40,000 would be 24,000 — the cap must bind.
    expect(i.monthlyBenefit).toBe(20_000);
    expect(i.iloeTotal).toBe(60_000);
  });

  it('serviceYears 30 with basic 10,000 → gratuity = 240,000 (cap binds)', () => {
    const p: Profile = {
      ...REF,
      basicSalary: 10_000,
      // 30 service years needs 30 × 365.25 = 10,957.5 days, so a plain
      // "30 calendar years" start date is half a day short.
      employmentStart: '1996-09-25',
      expectedLastDay: '2026-09-30',
    };
    expect(servicePeriod(p).serviceYears).toBeGreaterThanOrEqual(30);
    const g = gratuity(p);
    expect(g.capApplied).toBe(true);
    expect(g.gratuity).toBe(240_000);
  });

  /**
   * A monthly stream with no end date — income the user expects to keep
   * arriving through the job search. No `endDate` is the load-bearing part:
   * `incomeAfterLastDay` asks what still pays on the day *after* the last
   * working day, so a stream that ends with the job contributes nothing, which
   * is exactly how the salary stream drops out.
   */
  const sideStream = (amount: number): IncomeStream => ({
    id: 'inc-side-test',
    name: 'Freelance',
    amount,
    frequency: 'monthly',
    active: true,
  });

  it('sideIncome ≥ survival spend → runway = ∞ (UI shows "Unlimited")', () => {
    const r = runway(REF, refBudget(), [sideStream(23_000)]);
    expect(r.monthlySideIncome).toBe(23_000);
    expect(r.netMonthlyBurn).toBe(0);
    expect(r.runwayMonths).toBe(Infinity);
    expect(Number.isFinite(r.runwayMonths)).toBe(false);
    expect(r.status).toBe('good');

    // Scenarios must stay flat rather than becoming NaN.
    for (const s of scenarios(r)) {
      expect(s.remaining).toBe(r.totalResources);
      expect(s.shortfall).toBe(false);
    }
  });

  it('sideIncome exceeding survival spend still floors burn at zero', () => {
    const r = runway(REF, refBudget(), [sideStream(40_000)]);
    expect(r.netMonthlyBurn).toBe(0);
    expect(r.runwayMonths).toBe(Infinity);
  });

  /*
   * HAD-80. The assertion the issue asked for by name: "one assertion that
   * adding a side-income stream moves netMonthlyBurn, so the two can never
   * silently diverge again."
   *
   * Before this, `runway()` read `profile.monthlySideIncome` and nothing read
   * `income_streams`. Both were zero in the §11 seed, so every figure agreed
   * and no test could tell. Once US-27 made streams editable, a user could add
   * a 5,000 freelance stream, watch it appear in the table, and see runway sit
   * exactly where it was.
   */
  it('adding a side-income stream moves netMonthlyBurn — HAD-80', () => {
    const without = runway(REF, refBudget(), []);
    const with5k = runway(REF, refBudget(), [sideStream(5_000)]);

    expect(without.netMonthlyBurn).toBe(23_000);
    expect(with5k.netMonthlyBurn).toBe(18_000);
    expect(with5k.runwayMonths).toBeGreaterThan(without.runwayMonths);
  });

  it('a stream that ends with the job does not extend runway', () => {
    // The salary itself is such a stream. If this failed, the first month of
    // unemployment would look funded by the job that just ended.
    const salary: IncomeStream = {
      id: 'inc-salary', name: 'Salary', amount: 25_000, frequency: 'monthly',
      endDate: REF.expectedLastDay, active: true,
    };
    expect(runway(REF, refBudget(), [salary]).netMonthlyBurn).toBe(23_000);
  });

  it('a one-off is not monthly income', () => {
    // A single payment on a date is not a per-month figure. Counting it would
    // overstate every month after the one it lands in.
    const bonus: IncomeStream = {
      id: 'inc-bonus', name: 'Bonus', amount: 50_000, frequency: 'oneOff', active: true,
    };
    expect(runway(REF, refBudget(), [bonus]).netMonthlyBurn).toBe(23_000);
  });

  it('an inactive stream contributes nothing', () => {
    expect(
      runway(REF, refBudget(), [{ ...sideStream(9_000), active: false }]).netMonthlyBurn,
    ).toBe(23_000);
  });
});

// ===========================================================================
// Runway status bands — C-2 / OQ-3 boundary convention
// ===========================================================================

describe('runway status bands (≥6 good, 3 ≤ r < 6 warning, r < 3 critical)', () => {
  it.each([
    [Infinity, 'good'],
    [12, 'good'],
    [6.01, 'good'],
    [6, 'good'],
    [5.99, 'warning'],
    [3.5, 'warning'],
    [3, 'warning'],
    [2.99, 'critical'],
    [0, 'critical'],
  ] as const)('runway %s → %s', (months, expected) => {
    expect(runwayStatus(months)).toBe(expected);
  });
});

// ===========================================================================
// Settlement composition
// ===========================================================================

describe('final settlement composition', () => {
  it('notice pay in lieu uses GROSS salary, leave encashment uses BASIC', () => {
    const p: Profile = { ...REF, noticeDaysPaidInLieu: 30 };
    // 30 days at gross 25,000/30 = 25,000.
    expect(noticePayInLieu(p)).toBe(25_000);
    // 12 days at basic 15,000/30 = 6,000 — unchanged by the gross salary.
    expect(leaveEncashment(p)).toBe(6_000);
    expect(Math.round(finalSettlement(p).finalSettlement)).toBe(93_479 + 25_000);
  });

  it('deducts amounts owed to the employer and adds other amounts owed to me', () => {
    const s = finalSettlement({ ...REF, otherOwedToEmployee: 10_000, owedToEmployer: 4_000 });
    expect(Math.round(s.finalSettlement)).toBe(93_479 + 10_000 - 4_000);
  });

  it('gratuity never uses gross salary', () => {
    const onGross = gratuity({ ...REF, grossSalary: 99_999 });
    expect(Math.round(onGross.gratuity)).toBe(87_479);
  });

  it('ILOE is zero when not subscribed or when the exit was voluntary', () => {
    expect(iloeBenefit({ ...REF, iloeSubscribed12m: false }).iloeTotal).toBe(0);
    expect(iloeBenefit({ ...REF, iloeInvoluntary: false }).iloeTotal).toBe(0);
    expect(iloeBenefit({ ...REF, iloeSubscribed12m: false }).category).toBeNull();
  });

  it('ILOE category boundary: exactly 16,000 is Category A', () => {
    expect(iloeBenefit({ ...REF, iloeAvgBasic6m: 16_000 }).category).toBe('A');
    expect(iloeBenefit({ ...REF, iloeAvgBasic6m: 16_000 }).monthlyBenefit).toBe(9_600);
    expect(iloeBenefit({ ...REF, iloeAvgBasic6m: 16_001 }).category).toBe('B');
  });

  it('unpaid leave reduces pensionable service', () => {
    const withUnpaid = servicePeriod({ ...REF, unpaidLeaveDays: 365 });
    expect(withUnpaid.serviceDays).toBe(2_678 - 365);
    expect(gratuity({ ...REF, unpaidLeaveDays: 365 }).gratuity).toBeLessThan(
      gratuity(REF).gratuity,
    );
  });
});

// ===========================================================================
// Budget auto rows
// ===========================================================================

describe('budget auto rows', () => {
  it('debt service and school fees are computed, read-only, and equal in both columns', () => {
    const b = refBudget();
    const debtRow = b.find((c) => c.autoSource === 'debts')!;
    const schoolRow = b.find((c) => c.autoSource === 'schoolFees')!;

    expect(monthlyDebtService(REF_DEBTS)).toBe(6_000);
    expect(monthlySchoolFees(REF_FEES)).toBe(3_000);

    expect(debtRow.currentAmount).toBe(6_000);
    expect(debtRow.survivalAmount).toBe(6_000);
    expect(debtRow.editable).toBe(false);

    expect(schoolRow.currentAmount).toBe(3_000);
    expect(schoolRow.survivalAmount).toBe(3_000);
    expect(schoolRow.editable).toBe(false);
  });

  it('totals reflect the §11 budget', () => {
    expect(survivalSpend(refBudget())).toBe(23_000);
    expect(currentSpend(refBudget())).toBe(28_700);
  });

  it('editable rows are left alone', () => {
    const rent = refBudget().find((c) => c.name === 'Rent / housing')!;
    expect(rent.currentAmount).toBe(8_000);
    expect(rent.survivalAmount).toBe(7_000);
    expect(rent.editable).toBe(true);
  });
});

// ===========================================================================
// Cheque exposure windows
// ===========================================================================

describe('cheque exposure', () => {
  it('sums only cheques inside the 6- and 12-month windows', () => {
    const d = deadlines(REF, REF_CHEQUES);
    // Oct 18,000 + Dec 20,000 + Jan 18,000 + Jan 12,000 + Mar 45,000
    expect(d.cheques6m).toBe(113_000);
    // plus Apr 18,000 + Apr 12,000 + Jul 18,000
    expect(d.cheques12m).toBe(161_000);
  });

  it('excludes non-cheque payment types', () => {
    const onlyAutoDebit = REF_CHEQUES.filter((p) => p.type === 'autoDebit');
    expect(chequeExposure(onlyAutoDebit, REF.expectedLastDay, RULES.CHEQUE_WINDOW_6M)).toBe(0);
  });

  it('excludes cheques dated before the last working day', () => {
    const past: ScheduledPayment[] = [
      { ...REF_CHEQUES[0], id: 'past', dueDate: '2026-09-29', amount: 99_000 },
    ];
    expect(chequeExposure(past, REF.expectedLastDay, RULES.CHEQUE_WINDOW_12M)).toBe(0);
  });

  it('includes a cheque falling exactly on the window boundary', () => {
    const boundary = addDays(REF.expectedLastDay, RULES.CHEQUE_WINDOW_6M);
    const p: ScheduledPayment[] = [{ ...REF_CHEQUES[0], id: 'edge', dueDate: boundary, amount: 1_000 }];
    expect(chequeExposure(p, REF.expectedLastDay, RULES.CHEQUE_WINDOW_6M)).toBe(1_000);
    const dayAfter = addDays(boundary, 1);
    const q: ScheduledPayment[] = [{ ...REF_CHEQUES[0], id: 'edge2', dueDate: dayAfter, amount: 1_000 }];
    expect(chequeExposure(q, REF.expectedLastDay, RULES.CHEQUE_WINDOW_6M)).toBe(0);
  });

  it('visa grace end follows the profile grace days', () => {
    expect(deadlines(REF).visaGraceEnd).toBe('2026-12-29');
    expect(deadlines({ ...REF, visaGraceDays: 180 }).visaGraceEnd).toBe('2027-03-29');
  });
});

// ===========================================================================
// Composite
// ===========================================================================

describe('computeReadiness', () => {
  it('produces every §11 headline figure in one pass', () => {
    const r = computeReadiness(REF, refBudget(), REF_CHEQUES, []);
    expect(Math.round(r.gratuity.gratuity)).toBe(87_479);
    expect(Math.round(r.settlement.finalSettlement)).toBe(93_479);
    expect(r.iloe.iloeTotal).toBe(27_000);
    expect(Math.round(r.runway.totalResources)).toBe(220_479);
    expect(r.runway.netMonthlyBurn).toBe(23_000);
    expect(r.runway.runwayMonths).toBeCloseTo(9.586, 3);
    expect(r.runway.status).toBe('good');
    expect(r.deadlines.settlementDue).toBe('2026-10-14');
    expect(r.deadlines.iloeDeadline).toBe('2026-10-30');
    expect(r.deadlines.cheques6m).toBe(113_000);
    expect(r.scenarios.map((s) => s.shortfall)).toEqual([false, false, false, true]);
  });
});

// ===========================================================================
// Date helpers — R-7 timezone safety
// ===========================================================================

describe('date helpers', () => {
  it('counts calendar days inclusive of leap years', () => {
    expect(daysBetween('2019-06-01', '2026-09-30')).toBe(2_678);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2); // 2024 is a leap year
    expect(daysBetween('2023-02-28', '2023-03-01')).toBe(1);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 14)).toBe('2026-10-14');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds months clamping to the shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-10-05', 3)).toBe('2027-01-05');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('formats dates as dd MMM yyyy', () => {
    expect(formatDate('2026-09-30')).toBe('30 Sep 2026');
    expect(formatDate('2026-10-14')).toBe('14 Oct 2026');
  });

  it('treats range membership as inclusive on both ends', () => {
    expect(isWithin('2026-10-01', '2026-10-01', '2026-10-31')).toBe(true);
    expect(isWithin('2026-10-31', '2026-10-01', '2026-10-31')).toBe(true);
    expect(isWithin('2026-09-30', '2026-10-01', '2026-10-31')).toBe(false);
  });

  it('resolves "today" in Asia/Dubai, not the server timezone', () => {
    // 22:30 UTC is already the NEXT day in Dubai (UTC+4).
    const late = new Date('2026-07-30T22:30:00Z');
    expect(todayInDubai(late)).toBe('2026-07-31');
    // 04:00 UTC is the same calendar day in Dubai.
    expect(todayInDubai(new Date('2026-07-30T04:00:00Z'))).toBe('2026-07-30');
  });

  it('rejects malformed dates rather than silently coercing', () => {
    expect(() => daysBetween('2026-13-01', '2026-01-01')).toThrow();
    expect(() => addDays('not-a-date', 1)).toThrow();
  });
});

/**
 * `runwayFrom` — the core `runway()` delegates to, and the budget editor calls
 * directly so it can recompute live as the user types.
 *
 * It exists so there is one formula rather than two that agree today. These
 * tests pin the behaviour the editor depends on, including the one case where
 * the honest answer is not a number.
 */
describe('runwayFrom', () => {
  it('matches runway() for the reference profile', () => {
    const full = runway(SEED_PROFILE, SEED_BUDGET, SEED_INCOME);
    const direct = runwayFrom(full.totalResources, full.survivalSpend, full.monthlySideIncome);
    expect(direct).toEqual(full);
  });

  it('divides resources by net burn', () => {
    const r = runwayFrom(120_000, 12_000, 2_000);
    expect(r.netMonthlyBurn).toBe(10_000);
    expect(r.runwayMonths).toBe(12);
  });

  it('side income covering survival spend gives unlimited runway, not a negative one', () => {
    // The floor at zero is load-bearing. Without it the burn goes negative and
    // so does the runway, which reads as a deadline rather than as safety.
    const r = runwayFrom(120_000, 8_000, 9_000);
    expect(r.netMonthlyBurn).toBe(0);
    expect(r.runwayMonths).toBe(Infinity);
    expect(r.status).toBe('good');
  });

  it('side income exactly equal to survival spend is still unlimited', () => {
    expect(runwayFrom(1, 5_000, 5_000).runwayMonths).toBe(Infinity);
  });

  it('carries the band boundaries the dashboard colours depend on', () => {
    // OQ-3: >=6 good, 3 <= r < 6 warning, r < 3 critical.
    expect(runwayFrom(60_000, 10_000, 0).status).toBe('good');
    expect(runwayFrom(59_999, 10_000, 0).status).toBe('warning');
    expect(runwayFrom(30_000, 10_000, 0).status).toBe('warning');
    expect(runwayFrom(29_999, 10_000, 0).status).toBe('critical');
  });

  it('no resources is zero months, not unlimited', () => {
    const r = runwayFrom(0, 10_000, 0);
    expect(r.runwayMonths).toBe(0);
    expect(r.status).toBe('critical');
  });
});

/**
 * `applyAutoRows` creating a row that is not stored anywhere.
 *
 * Measured, not assumed: before this, `applyAutoRows` only *updated* rows that
 * already carried an `autoSource`. Per-user budget rows are not seeded on
 * sign-up (HAD-69), so a real user could add a mortgage, see it on the Loans
 * screen, and watch the budget total, survival spend and runway ignore it
 * entirely. Nothing would look broken — which is what makes it the shape of
 * defect this project keeps producing.
 */
describe('applyAutoRows — derived rows for an unseeded budget', () => {
  const debts: Debt[] = [
    { id: 'd1', type: 'carLoan', name: 'Car', outstandingBalance: 50_000, monthlyPayment: 2_400, monthsRemaining: 20, lender: 'ADCB' },
    { id: 'd2', type: 'mortgage', name: 'Home', outstandingBalance: 900_000, monthlyPayment: 3_600, monthsRemaining: 200, lender: 'FAB' },
  ];
  const fees: SchoolFee[] = [
    { id: 'f1', child: 'A', school: 'GEMS', term: 'T1', dueDate: '2026-09-01', amount: 12_000, paidByCheque: true, paid: false },
    { id: 'f2', child: 'A', school: 'GEMS', term: 'T2', dueDate: '2027-01-12', amount: 12_000, paidByCheque: true, paid: false },
    { id: 'f3', child: 'A', school: 'GEMS', term: 'T3', dueDate: '2027-04-20', amount: 12_000, paidByCheque: true, paid: false },
  ];
  const plain: BudgetCategory[] = [
    { id: 'c1', name: 'Groceries', currentAmount: 3_000, survivalAmount: 2_000, editable: true },
  ];

  it('derives the debts row when the budget has none', () => {
    const out = applyAutoRows(plain, debts, []);
    const row = out.find((c) => c.autoSource === 'debts');
    expect(row).toBeDefined();
    expect(row!.currentAmount).toBe(6_000);
    expect(row!.survivalAmount).toBe(6_000);
    expect(row!.editable).toBe(false);
  });

  it('a derived debt row reaches the survival total, and therefore runway', () => {
    // The assertion that would have caught the gap: without the derived row,
    // survivalSpend stays at 2,000 and the mortgage is invisible to runway.
    const out = applyAutoRows(plain, debts, []);
    expect(survivalSpend(out)).toBe(8_000);
    expect(survivalSpend(applyAutoRows(plain, [], []))).toBe(2_000);
  });

  it('derives the school-fees row at annual ÷ 12', () => {
    const row = applyAutoRows(plain, [], fees).find((c) => c.autoSource === 'schoolFees');
    expect(row!.currentAmount).toBe(3_000);
  });

  it('does not duplicate a row the budget already stores', () => {
    const stored: BudgetCategory[] = [
      ...plain,
      { id: 'c2', name: 'Loan & mortgage payments', currentAmount: 0, survivalAmount: 0, editable: false, autoSource: 'debts' },
    ];
    const out = applyAutoRows(stored, debts, []);
    expect(out.filter((c) => c.autoSource === 'debts')).toHaveLength(1);
    // The stored row is still the one that wins, updated to the live figure.
    expect(out.find((c) => c.autoSource === 'debts')!.id).toBe('c2');
    expect(out.find((c) => c.autoSource === 'debts')!.currentAmount).toBe(6_000);
  });

  it('adds nothing when there is nothing to derive', () => {
    // A row reading AED 0 would be noise on a budget someone is trying to read.
    expect(applyAutoRows(plain, [], [])).toHaveLength(1);
  });

  it('a derived row carries a non-uuid id, so nothing can write it by mistake', () => {
    const row = applyAutoRows(plain, debts, []).find((c) => c.autoSource === 'debts')!;
    expect(row.id).toBe(AUTO_ROW_ID.debts);
    expect(row.id).not.toMatch(/^[0-9a-f-]{36}$/i);
  });
});

/**
 * HAD-81 — school-fee terms as dated obligations.
 *
 * Before this, `chequeExposure()` took `ScheduledPayment[]` and `SchoolFee` was
 * not among its inputs, so a cheque-paid term reached the budget through
 * `monthlySchoolFees()` and reached nothing else. The §11 figures hid it: the
 * seed entered every cheque-paid term twice, in two tables. R-5 says a cheque
 * the calendar does not show is the worst defect this app can produce.
 */
describe('schoolFeeObligations', () => {
  const fees: SchoolFee[] = [
    { id: 'f1', child: 'Layla', school: 'GEMS', term: 'Term 1', dueDate: '2026-09-05', amount: 12_000, paidByCheque: true, paid: true },
    { id: 'f2', child: 'Layla', school: 'GEMS', term: 'Term 2', dueDate: '2027-01-12', amount: 12_000, paidByCheque: true, paid: false },
    { id: 'f3', child: 'Layla', school: 'GEMS', term: 'Term 3', dueDate: '2027-04-20', amount: 12_000, paidByCheque: false, paid: false },
  ];

  it('a paid term is not an outstanding obligation', () => {
    expect(schoolFeeObligations(fees).map((o) => o.dueDate)).toEqual(['2027-01-12', '2027-04-20']);
  });

  it('a cheque-paid term becomes a cheque and reaches exposure', () => {
    // The whole point. Before, this was 0.
    const derived = schoolFeeObligations(fees);
    expect(chequeExposure(derived, '2026-09-30', RULES.CHEQUE_WINDOW_12M)).toBe(12_000);
  });

  it('a term paid by transfer is not counted as cheque exposure', () => {
    const derived = schoolFeeObligations(fees);
    expect(derived.find((o) => o.dueDate === '2027-04-20')!.type).toBe('transfer');
  });

  it('every derived obligation is in-budget — G-1', () => {
    // School fees are already inside the monthly burn via the auto row. Marking
    // these out-of-budget would make the projection subtract the full annual
    // fee a second time as lump sums, understating runway.
    expect(schoolFeeObligations(fees).every((o) => o.includedInBudget)).toBe(true);
  });

  it('never recurs — a term is one dated obligation', () => {
    // Marking these termly would expand one term into three. That is precisely
    // the 36,000 of phantom school fees the 12-month schedule total carried.
    expect(schoolFeeObligations(fees).every((o) => o.recurrence === 'none')).toBe(true);
  });

  it('carries a non-uuid id so nothing can write one by mistake', () => {
    expect(schoolFeeObligations(fees)[0].id).toBe('fee:f2');
  });

  it('is marked derived, so the editor knows not to offer to change it', () => {
    /*
     * The id guard is real but it is a *database* guard: `scheduled_payments.id`
     * is a uuid, so `.eq('id', 'fee:f2')` fails with 22P02, verified against the
     * live project rather than assumed.
     *
     * Failing loudly is right. Failing loudly *at the user*, on a row whose Edit
     * button the app itself rendered, is not — and that is what the schedule
     * editor did the moment these rows joined `m.payments`. This flag is what
     * the editor reads to show "computed — edit on Loans & fees" instead.
     */
    expect(schoolFeeObligations(fees).every((o) => o.derivedFrom === 'schoolFees')).toBe(true);
  });

  it('a stored payment is never marked derived', () => {
    // The flag has to distinguish, or the editor would refuse to edit anything.
    expect(SEED_PAYMENTS.every((p) => p.derivedFrom === undefined)).toBe(true);
  });
});
