/**
 * UAE termination calculation engine.
 *
 * Implements §5 of the build spec under Federal Decree-Law 33/2021 and the
 * ILOE scheme, as verified July 2026. Every function here is PURE: same inputs,
 * same outputs, no clock, no I/O. The only time-dependent values (countdowns)
 * live in the date helpers and take an injectable `now`.
 *
 * The constants are gathered in ONE place on purpose — when UAE rules change
 * (risk R-1/RB-7), this block is the whole edit.
 */

import { addDays, daysBetween, isWithin } from './dates';
import { incomeAfterLastDay } from './income';
import type {
  BudgetCategory,
  Deadlines,
  Debt,
  FinalSettlement,
  GratuityBreakdown,
  IloeBenefit,
  IncomeStream,
  IsoDate,
  Profile,
  Readiness,
  Runway,
  RunwayStatus,
  Scenario,
  ScheduledPayment,
  SchoolFee,
  ServicePeriod,
} from './types';

// --- Legal constants — current as of July 2026 -----------------------------
export const RULES = {
  /** Days used to convert a monthly salary to a daily rate. */
  DAYS_PER_MONTH: 30,
  /** Divisor converting service days to years. §5.1 fixes 365.25 (see C-3). */
  DAYS_PER_YEAR: 365.25,
  /** Gratuity accrual: 21 days per year for the first five years. */
  GRATUITY_DAYS_FIRST_5Y: 21,
  /** 30 days per year beyond five years. */
  GRATUITY_DAYS_AFTER_5Y: 30,
  /** Minimum service for any gratuity entitlement. */
  GRATUITY_MIN_YEARS: 1,
  /** Gratuity is capped at two years' basic salary. */
  GRATUITY_CAP_MONTHS: 24,
  /** ILOE pays 60% of average basic salary. */
  ILOE_RATE: 0.6,
  /** Category A applies at or below this average basic salary. */
  ILOE_CATEGORY_THRESHOLD: 16_000,
  ILOE_CAP_A: 10_000,
  ILOE_CAP_B: 20_000,
  /** ILOE pays for a maximum of three months. */
  ILOE_MAX_MONTHS: 3,
  /** Employer must settle within 14 days of the last working day. */
  SETTLEMENT_DUE_DAYS: 14,
  /** Hard ILOE claim window from termination. */
  ILOE_CLAIM_DAYS: 30,
  /** Cheque exposure windows, in days. */
  CHEQUE_WINDOW_6M: 183,
  CHEQUE_WINDOW_12M: 366,
  /** Overstay penalty after the visa grace period, AED per day. */
  OVERSTAY_AED_PER_DAY: 50,
} as const;

/** Runway status bands. Half-open by decision OQ-3/C-2: 6.0 is good, 3.0 is warning. */
export const RUNWAY_BANDS = { GOOD_MIN: 6, WARNING_MIN: 3 } as const;

// --- §5.1 Service period ---------------------------------------------------

export function servicePeriod(profile: Profile): ServicePeriod {
  const calendarDays = daysBetween(profile.employmentStart, profile.expectedLastDay);
  const serviceDays = calendarDays - profile.unpaidLeaveDays;
  return {
    serviceDays,
    serviceYears: serviceDays / RULES.DAYS_PER_YEAR,
  };
}

// --- §5.2 End-of-service gratuity -----------------------------------------

/**
 * Gratuity is calculated on BASIC salary only — never gross. The rate is the
 * same for resignation and termination.
 */
export function gratuity(profile: Profile, service?: ServicePeriod): GratuityBreakdown {
  const { serviceYears } = service ?? servicePeriod(profile);
  const dailyBasic = profile.basicSalary / RULES.DAYS_PER_MONTH;

  const gratuityDays =
    RULES.GRATUITY_DAYS_FIRST_5Y * Math.min(serviceYears, 5) +
    RULES.GRATUITY_DAYS_AFTER_5Y * Math.max(serviceYears - 5, 0);

  const ineligible = serviceYears < RULES.GRATUITY_MIN_YEARS;
  const gratuityRaw = ineligible ? 0 : gratuityDays * dailyBasic;
  const gratuityCap = RULES.GRATUITY_CAP_MONTHS * profile.basicSalary;
  const capped = Math.min(gratuityRaw, gratuityCap);

  return {
    dailyBasic,
    gratuityDays,
    gratuityRaw,
    gratuityCap,
    gratuity: capped,
    capApplied: gratuityRaw > gratuityCap,
    ineligible,
  };
}

// --- §5.3 Other final-settlement items ------------------------------------

/** Accrued annual leave, encashed at BASIC salary. */
export function leaveEncashment(profile: Profile): number {
  return (profile.unusedLeaveDays * profile.basicSalary) / RULES.DAYS_PER_MONTH;
}

/** Waived notice days, paid at GROSS salary. */
export function noticePayInLieu(profile: Profile): number {
  return (profile.noticeDaysPaidInLieu * profile.grossSalary) / RULES.DAYS_PER_MONTH;
}

export function finalSettlement(profile: Profile): FinalSettlement {
  const g = gratuity(profile).gratuity;
  const leave = leaveEncashment(profile);
  const notice = noticePayInLieu(profile);
  return {
    gratuity: g,
    leaveEncashment: leave,
    noticePayInLieu: notice,
    otherOwedToEmployee: profile.otherOwedToEmployee,
    owedToEmployer: profile.owedToEmployer,
    finalSettlement:
      g + leave + notice + profile.otherOwedToEmployee - profile.owedToEmployer,
  };
}

// --- §5.4 ILOE unemployment benefit ---------------------------------------

export function iloeBenefit(profile: Profile): IloeBenefit {
  const eligible = profile.iloeSubscribed12m && profile.iloeInvoluntary;
  const category =
    profile.iloeAvgBasic6m <= RULES.ILOE_CATEGORY_THRESHOLD ? 'A' : 'B';
  const monthlyCap = category === 'A' ? RULES.ILOE_CAP_A : RULES.ILOE_CAP_B;
  const rated = RULES.ILOE_RATE * profile.iloeAvgBasic6m;
  const monthlyBenefit = eligible ? Math.min(rated, monthlyCap) : 0;

  return {
    eligible,
    category: eligible ? category : null,
    monthlyCap,
    monthlyBenefit,
    iloeTotal: RULES.ILOE_MAX_MONTHS * monthlyBenefit,
    capApplied: eligible && rated > monthlyCap,
  };
}

// --- Budget auto rows ------------------------------------------------------

/** Σ monthly debt payments — the read-only "Loan & mortgage payments" row. */
export function monthlyDebtService(debts: Debt[]): number {
  return debts.reduce((sum, d) => sum + d.monthlyPayment, 0);
}

/** Annual school fees ÷ 12 — the read-only "School fees" row. */
export function monthlySchoolFees(fees: SchoolFee[]): number {
  const annual = fees.reduce((sum, f) => sum + f.amount, 0);
  return annual / 12;
}

/**
 * Applies the computed values onto the auto rows so both the current and
 * survival columns agree, leaving editable rows untouched.
 */
/**
 * Stable ids for a derived row that has no database row behind it.
 *
 * `auto:` is not a uuid, which is the point — it cannot collide with a real
 * `budget_categories.id`, and anything that tries to write one will fail loudly
 * rather than create a duplicate.
 */
export const AUTO_ROW_ID = { debts: 'auto:debts', schoolFees: 'auto:schoolFees' } as const;

/**
 * Overlays the computed budget rows onto the stored ones.
 *
 * Two behaviours, and the second one was missing until it was measured.
 *
 * **Update.** A stored row marked `autoSource` has its amounts replaced by the
 * live derivation and is forced read-only, so the budget can never disagree
 * with the screen that owns the data.
 *
 * **Create.** If no stored row exists for a source that currently has a
 * non-zero total, one is *derived* rather than skipped. Without this, a user
 * whose budget has no seeded auto rows — which is every user who signs up,
 * since per-user budget rows are not seeded (HAD-69) — could add a mortgage,
 * see it on the Loans screen, and watch the budget total, the survival spend
 * and the runway all ignore it completely. The debt would be real, every
 * derived figure would be wrong, and nothing would look broken.
 *
 * Derived rather than inserted, deliberately: the amounts belong to the debts
 * and school-fees tables, and a second write path into `budget_categories`
 * would be a second place for them to drift. Nothing here writes.
 */
export function applyAutoRows(
  categories: BudgetCategory[],
  debts: Debt[],
  fees: SchoolFee[],
): BudgetCategory[] {
  const debt = monthlyDebtService(debts);
  const school = monthlySchoolFees(fees);

  const updated = categories.map((c) => {
    if (c.autoSource === 'debts') {
      return { ...c, currentAmount: debt, survivalAmount: debt, editable: false };
    }
    if (c.autoSource === 'schoolFees') {
      return { ...c, currentAmount: school, survivalAmount: school, editable: false };
    }
    return c;
  });

  const derived: BudgetCategory[] = [];
  const has = (src: 'debts' | 'schoolFees') => updated.some((c) => c.autoSource === src);

  // Zero total and no stored row means there is nothing to show. A row reading
  // AED 0 would be noise on a budget the user is trying to read.
  if (debt > 0 && !has('debts')) {
    derived.push({
      id: AUTO_ROW_ID.debts,
      name: 'Loan & mortgage payments',
      currentAmount: debt,
      survivalAmount: debt,
      editable: false,
      autoSource: 'debts',
    });
  }
  if (school > 0 && !has('schoolFees')) {
    derived.push({
      id: AUTO_ROW_ID.schoolFees,
      name: 'School fees',
      currentAmount: school,
      survivalAmount: school,
      editable: false,
      autoSource: 'schoolFees',
    });
  }

  return [...updated, ...derived];
}

export function survivalSpend(categories: BudgetCategory[]): number {
  return categories.reduce((sum, c) => sum + c.survivalAmount, 0);
}

export function currentSpend(categories: BudgetCategory[]): number {
  return categories.reduce((sum, c) => sum + c.currentAmount, 0);
}

// --- §5.5 Runway & scenarios ----------------------------------------------

export function runwayStatus(runwayMonths: number): RunwayStatus {
  if (runwayMonths >= RUNWAY_BANDS.GOOD_MIN) return 'good';
  if (runwayMonths >= RUNWAY_BANDS.WARNING_MIN) return 'warning';
  return 'critical';
}

/**
 * Runway from three already-computed figures.
 *
 * Split out of `runway()` so the budget editor can recompute live as the user
 * types without a second copy of the formula. It needs the same answer as the
 * server, and "the same answer" is a property worth having structurally rather
 * than by two implementations agreeing today.
 *
 * The floor at zero is load-bearing: side income above survival spending means
 * the money never runs out, and `Infinity` is the honest answer. The UI renders
 * it as "Unlimited". Removing the floor would produce a negative burn and a
 * negative runway, which reads as a deadline rather than as safety.
 */
export function runwayFrom(
  totalResources: number,
  spend: number,
  monthlySideIncome: number,
): Runway {
  const netMonthlyBurn = Math.max(spend - monthlySideIncome, 0);
  const runwayMonths = netMonthlyBurn === 0 ? Infinity : totalResources / netMonthlyBurn;

  return {
    totalResources,
    survivalSpend: spend,
    monthlySideIncome,
    netMonthlyBurn,
    runwayMonths,
    status: runwayStatus(runwayMonths),
  };
}

/**
 * Runway, with side income **derived from the income streams** (HAD-80).
 *
 * `streams` is required and third rather than appended as an optional, so the
 * compiler names every caller instead of silently handing one a zero. The
 * omission would be conservative — no side income understates runway — but a
 * figure that is quietly pessimistic is still a figure nobody can trust.
 *
 * This used to read `profile.monthlySideIncome`, a single number on the profile
 * form, while `income_streams` sat beside it feeding nothing. The two agreed
 * only because both were zero in the §11 seed. Once US-27 made streams
 * editable, a user could add a 5,000 freelance stream, see it in the table, and
 * watch their runway not move — the project's signature defect, a real figure
 * and a derived number silently disagreeing.
 *
 * `incomeAfterLastDay` is the right derivation rather than a plain sum: it asks
 * what still arrives the day *after* employment ends, so salary drops out on
 * its end date and a stream starting mid-scenario is counted only once it does.
 */
export function runway(
  profile: Profile,
  categories: BudgetCategory[],
  streams: IncomeStream[],
  settlement?: FinalSettlement,
  iloe?: IloeBenefit,
): Runway {
  const s = settlement ?? finalSettlement(profile);
  const i = iloe ?? iloeBenefit(profile);

  const totalResources =
    profile.cashSavings + profile.otherLiquidAssets + s.finalSettlement + i.iloeTotal;

  return runwayFrom(
    totalResources,
    survivalSpend(categories),
    incomeAfterLastDay(streams, profile.expectedLastDay),
  );
}

export const SCENARIO_MONTHS = [3, 6, 9, 12] as const;

export function scenarios(
  r: Runway,
  months: readonly number[] = SCENARIO_MONTHS,
): Scenario[] {
  return months.map((m) => {
    const remaining = r.totalResources - r.netMonthlyBurn * m;
    return { months: m, remaining, shortfall: remaining < 0 };
  });
}

// --- §5.6 Key deadline dates ----------------------------------------------

/** Cheques falling in [lastDay, lastDay + windowDays]. */
export function chequeExposure(
  payments: ScheduledPayment[],
  lastDay: IsoDate,
  windowDays: number,
): number {
  const end = addDays(lastDay, windowDays);
  return payments
    .filter((p) => p.type === 'cheque' && isWithin(p.dueDate, lastDay, end))
    .reduce((sum, p) => sum + p.amount, 0);
}

export function deadlines(profile: Profile, payments: ScheduledPayment[] = []): Deadlines {
  const last = profile.expectedLastDay;
  return {
    settlementDue: addDays(last, RULES.SETTLEMENT_DUE_DAYS),
    iloeDeadline: addDays(last, RULES.ILOE_CLAIM_DAYS),
    visaGraceEnd: addDays(last, profile.visaGraceDays),
    cheques6m: chequeExposure(payments, last, RULES.CHEQUE_WINDOW_6M),
    cheques12m: chequeExposure(payments, last, RULES.CHEQUE_WINDOW_12M),
  };
}

// --- Composite -------------------------------------------------------------

/** Computes everything the dashboard and termination report need in one pass. */
export function computeReadiness(
  profile: Profile,
  categories: BudgetCategory[],
  payments: ScheduledPayment[],
  streams: IncomeStream[],
): Readiness {
  const service = servicePeriod(profile);
  const g = gratuity(profile, service);
  const settlement = finalSettlement(profile);
  const iloe = iloeBenefit(profile);
  const r = runway(profile, categories, streams, settlement, iloe);
  return {
    service,
    gratuity: g,
    settlement,
    iloe,
    runway: r,
    scenarios: scenarios(r),
    deadlines: deadlines(profile, payments),
  };
}

/**
 * School-fee terms, as the dated obligations they already are.
 *
 * `chequeExposure()`, the calendar and the projection all read
 * `ScheduledPayment[]`. `SchoolFee` was not among their inputs, so a
 * cheque-paid term reached the budget through `monthlySchoolFees()` and
 * reached nothing else — invisible on the calendar, absent from both exposure
 * tiles. For an obligation whose whole risk is a bounced cheque (R-5), that is
 * the worst place to be invisible.
 *
 * The §11 figures hid it: the seed entered every cheque-paid term twice, once
 * in `school_fees` and once in `scheduled_payments`. Correct only because a
 * human remembered to do it twice, and impossible to reproduce through the UI.
 *
 * So the obligation is **derived** here rather than written a second time —
 * the same choice as `applyAutoRows`, for the same reason: one source per
 * fact, and nothing to drift.
 *
 * Two details that are load-bearing:
 *
 * - `includedInBudget: true`. School fees are already inside the monthly burn
 *   via the "School fees" auto row, so the projection must **not** subtract
 *   them again as lump sums. That is G-1, and getting it wrong here would
 *   understate runway by the full annual fee.
 * - `recurrence: 'none'`. Each term is its own row with its own date. Marking
 *   these termly would expand one term into three and treble the exposure.
 */
export function schoolFeeObligations(fees: SchoolFee[]): ScheduledPayment[] {
  return fees
    // A paid term is not an exposure. The seed models this the same way: only
    // the two unpaid terms had a matching scheduled payment.
    .filter((f) => !f.paid)
    .map((f) => ({
      // `fee:` marks a derived row and cannot collide with a real uuid, so
      // anything that tries to write one fails loudly.
      id: `fee:${f.id}`,
      dueDate: f.dueDate,
      payee: `${f.school} school`,
      purpose: `School fees — ${f.term}${f.child ? ` (${f.child})` : ''}`,
      amount: f.amount,
      account: '',
      type: f.paidByCheque ? ('cheque' as const) : ('transfer' as const),
      recurrence: 'none' as const,
      includedInBudget: true,
      // So the schedule editor can show this row without offering to edit a
      // record that does not exist. The term is owned by the Loans screen.
      derivedFrom: 'schoolFees' as const,
      status: 'upcoming' as const,
    }));
}
