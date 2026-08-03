/**
 * UAE termination calculation engine.
 *
 * Implements §5 of the build spec under Federal Decree-Law 33/2021 and the
 * ILOE scheme. Every function here is PURE: same inputs, same outputs, no
 * clock, no I/O. The only time-dependent values (countdowns) live in the date
 * helpers and take an injectable `now`.
 *
 * This header used to end "as verified July 2026". It was not verified in July
 * 2026 or since, so the claim is gone and each constant in `RULES` now carries
 * its own provenance — all of it null. A comment asserting currency is one
 * nobody can check; a field on the value is one the UI can render and a test
 * can enforce. See `citations.ts` for the helpers that read it.
 *
 * The constants are gathered in ONE place on purpose — when UAE rules change
 * (risk R-1/RB-7), this block is the whole edit.
 */

import { addDays, daysBetween, isWithin } from './dates';
import { incomeAfterLastDay } from './income';
import { isOutstanding } from './settle';
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

// --- Legal constants — each one carrying its own provenance ----------------

/**
 * A number the engine computes from, and the evidence for it.
 *
 * The evidence lives *on the value* rather than in a table beside it. A
 * separate map can fall out of step with what it describes — somebody adds a
 * constant, the map does not grow, and the new number quietly has no basis. Here
 * a constant without provenance is not a gap to notice later; it does not
 * compile.
 */
export type Rule<T extends number = number> = Readonly<{
  value: T;
  /** What this rule is, in words, so the UI can name an unverified basis. */
  label: string;
  /**
   * The provision it comes from. `null` means nobody has sourced it — an
   * honest, renderable state.
   */
  provision: string | null;
  /**
   * The day a person last checked it against the current legal text. `null`
   * means never — not "a while ago", not "probably fine".
   *
   * Separate from `provision` because law changes underneath a correct article
   * number. UAE employment law was substantially rewritten in 2022, and a
   * citation with no date cannot tell you whether it predates that.
   */
  verifiedOn: IsoDate | null;
}>;

/**
 * All four arguments are required, which is the point: omitting the evidence is
 * a type error rather than an oversight. `null` is a decision you have to type.
 */
function rule<const T extends number>(
  value: T,
  label: string,
  provision: string | null,
  verifiedOn: IsoDate | null,
): Rule<T> {
  return { value, label, provision, verifiedOn };
}

/**
 * Every provision below is `null` on purpose.
 *
 * Phase 2 decision OD-1: there is no access to the current UAE legal text and
 * no contact who can confirm it, so P2-4 downgraded from *a figure good enough
 * to take to HR* to *orient me, roughly*.
 *
 * The tempting response is to leave provenance out until a lawyer is available.
 * That is the wrong order — without somewhere to record its absence the app
 * cannot *say* it is unsourced, so it says nothing, and a figure that says
 * nothing about its own basis reads as authoritative. This project's signature
 * failure is a plausible wrong answer rather than a visible one; in law it is
 * worse, because a wrong article number quoted in an HR meeting destroys the
 * user's credibility at the moment they most need it.
 *
 * `citations.test.ts` fails on a half-citation — a provision with no date —
 * because that is the state that *looks* sourced.
 */
export const RULES = {
  DAYS_PER_MONTH: rule(30, 'Converting a monthly salary to a daily rate', null, null),
  DAYS_PER_YEAR: rule(365.25, 'Converting service days to years', null, null),
  GRATUITY_DAYS_FIRST_5Y: rule(21, 'Gratuity accrual for the first five years', null, null),
  GRATUITY_DAYS_AFTER_5Y: rule(30, 'Gratuity accrual beyond five years', null, null),
  GRATUITY_MIN_YEARS: rule(1, 'Minimum service before any gratuity is owed', null, null),
  GRATUITY_CAP_MONTHS: rule(24, 'The ceiling on total gratuity', null, null),
  ILOE_RATE: rule(0.6, 'ILOE benefit as a share of basic salary', null, null),
  ILOE_CATEGORY_THRESHOLD: rule(
    16_000,
    'The salary threshold dividing ILOE category A from B',
    null,
    null,
  ),
  ILOE_CAP_A: rule(10_000, 'ILOE monthly cap, category A', null, null),
  ILOE_CAP_B: rule(20_000, 'ILOE monthly cap, category B', null, null),
  ILOE_MAX_MONTHS: rule(3, 'How long ILOE pays for', null, null),
  SETTLEMENT_DUE_DAYS: rule(14, 'The window an employer has to settle', null, null),
  ILOE_CLAIM_DAYS: rule(
    30,
    'The window to claim ILOE, which cannot be recovered once missed',
    null,
    null,
  ),
  CHEQUE_WINDOW_6M: rule(183, 'Cheque exposure window, six months', null, null),
  CHEQUE_WINDOW_12M: rule(366, 'Cheque exposure window, twelve months', null, null),
  OVERSTAY_AED_PER_DAY: rule(50, 'The daily penalty after the visa grace period', null, null),
} as const;

/** Runway status bands. Half-open by decision OQ-3/C-2: 6.0 is good, 3.0 is warning. */
export const RUNWAY_BANDS = { GOOD_MIN: 6, WARNING_MIN: 3 } as const;

// --- §5.1 Service period ---------------------------------------------------

export function servicePeriod(profile: Profile): ServicePeriod {
  const calendarDays = daysBetween(profile.employmentStart, profile.expectedLastDay);
  const serviceDays = calendarDays - profile.unpaidLeaveDays;
  return {
    serviceDays,
    serviceYears: serviceDays / RULES.DAYS_PER_YEAR.value,
  };
}

// --- §5.2 End-of-service gratuity -----------------------------------------

/**
 * Gratuity is calculated on BASIC salary only — never gross. The rate is the
 * same for resignation and termination.
 */
export function gratuity(profile: Profile, service?: ServicePeriod): GratuityBreakdown {
  const { serviceYears } = service ?? servicePeriod(profile);
  const dailyBasic = profile.basicSalary / RULES.DAYS_PER_MONTH.value;

  const gratuityDays =
    RULES.GRATUITY_DAYS_FIRST_5Y.value * Math.min(serviceYears, 5) +
    RULES.GRATUITY_DAYS_AFTER_5Y.value * Math.max(serviceYears - 5, 0);

  const ineligible = serviceYears < RULES.GRATUITY_MIN_YEARS.value;

  /*
   * The accrual is kept even when it is not payable.
   *
   * `gratuityRaw` used to become 0 the moment service fell under a year, which
   * erased the very thing the explanation screen has to show: what you accrued,
   * and why none of it is owed. A user who cannot see both figures cannot
   * restate the rule, and restating it is the whole point of B3.
   *
   * Eligibility is applied to what is *paid*, not to what is counted.
   */
  const gratuityRaw = gratuityDays * dailyBasic;
  const gratuityCap = RULES.GRATUITY_CAP_MONTHS.value * profile.basicSalary;
  const capped = ineligible ? 0 : Math.min(gratuityRaw, gratuityCap);

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
  return (profile.unusedLeaveDays * profile.basicSalary) / RULES.DAYS_PER_MONTH.value;
}

/** Waived notice days, paid at GROSS salary. */
export function noticePayInLieu(profile: Profile): number {
  return (profile.noticeDaysPaidInLieu * profile.grossSalary) / RULES.DAYS_PER_MONTH.value;
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
    profile.iloeAvgBasic6m <= RULES.ILOE_CATEGORY_THRESHOLD.value ? 'A' : 'B';
  const monthlyCap = category === 'A' ? RULES.ILOE_CAP_A.value : RULES.ILOE_CAP_B.value;
  const rated = RULES.ILOE_RATE.value * profile.iloeAvgBasic6m;
  const monthlyBenefit = eligible ? Math.min(rated, monthlyCap) : 0;

  return {
    eligible,
    category: eligible ? category : null,
    monthlyCap,
    monthlyBenefit,
    iloeTotal: RULES.ILOE_MAX_MONTHS.value * monthlyBenefit,
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

/**
 * The cheques still to fund in [lastDay, lastDay + windowDays].
 *
 * Exported as the **list**, not only the total, because three screens print a
 * count or a table beside the total and every one of them had rebuilt this
 * filter by hand. `app/page.tsx` even carried a comment saying the caption
 * "must count the SAME cheques the 113,000 figure sums… or the tile's caption
 * contradicts its own number" — and hand-copying was the only thing holding
 * that together.
 *
 * Adding the status rule (HAD-82) to the total alone would have broken all
 * three at once: the figure dropping a cleared cheque while the count beside it
 * kept counting one. So the filter moved here and the total is derived from it,
 * which is the same "one source per fact" rule as the budget's auto rows.
 *
 * "Still to fund" is `isOutstanding()`, shared with the projection so the tile
 * and the forward balance cannot disagree either.
 */
export function chequesInWindow(
  payments: ScheduledPayment[],
  lastDay: IsoDate,
  windowDays: number,
): ScheduledPayment[] {
  const end = addDays(lastDay, windowDays);
  return payments.filter(
    (p) => p.type === 'cheque' && isOutstanding(p) && isWithin(p.dueDate, lastDay, end),
  );
}

/** What those cheques come to. */
export function chequeExposure(
  payments: ScheduledPayment[],
  lastDay: IsoDate,
  windowDays: number,
): number {
  return chequesInWindow(payments, lastDay, windowDays).reduce((sum, p) => sum + p.amount, 0);
}

export function deadlines(profile: Profile, payments: ScheduledPayment[] = []): Deadlines {
  const last = profile.expectedLastDay;
  return {
    settlementDue: addDays(last, RULES.SETTLEMENT_DUE_DAYS.value),
    iloeDeadline: addDays(last, RULES.ILOE_CLAIM_DAYS.value),
    visaGraceEnd: addDays(last, profile.visaGraceDays),
    cheques6m: chequeExposure(payments, last, RULES.CHEQUE_WINDOW_6M.value),
    cheques12m: chequeExposure(payments, last, RULES.CHEQUE_WINDOW_12M.value),
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
