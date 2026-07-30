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
import type {
  BudgetCategory,
  Deadlines,
  Debt,
  FinalSettlement,
  GratuityBreakdown,
  IloeBenefit,
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
export function applyAutoRows(
  categories: BudgetCategory[],
  debts: Debt[],
  fees: SchoolFee[],
): BudgetCategory[] {
  const debt = monthlyDebtService(debts);
  const school = monthlySchoolFees(fees);
  return categories.map((c) => {
    if (c.autoSource === 'debts') {
      return { ...c, currentAmount: debt, survivalAmount: debt, editable: false };
    }
    if (c.autoSource === 'schoolFees') {
      return { ...c, currentAmount: school, survivalAmount: school, editable: false };
    }
    return c;
  });
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

export function runway(
  profile: Profile,
  categories: BudgetCategory[],
  settlement?: FinalSettlement,
  iloe?: IloeBenefit,
): Runway {
  const s = settlement ?? finalSettlement(profile);
  const i = iloe ?? iloeBenefit(profile);

  const totalResources =
    profile.cashSavings + profile.otherLiquidAssets + s.finalSettlement + i.iloeTotal;
  const spend = survivalSpend(categories);
  const netMonthlyBurn = Math.max(spend - profile.monthlySideIncome, 0);
  const runwayMonths = netMonthlyBurn === 0 ? Infinity : totalResources / netMonthlyBurn;

  return {
    totalResources,
    survivalSpend: spend,
    netMonthlyBurn,
    runwayMonths,
    status: runwayStatus(runwayMonths),
  };
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
  payments: ScheduledPayment[] = [],
): Readiness {
  const service = servicePeriod(profile);
  const g = gratuity(profile, service);
  const settlement = finalSettlement(profile);
  const iloe = iloeBenefit(profile);
  const r = runway(profile, categories, settlement, iloe);
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
