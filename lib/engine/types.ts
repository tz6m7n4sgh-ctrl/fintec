/**
 * Domain types for the calculation engine.
 *
 * Everything here is plain data — the engine is a set of pure functions over
 * these shapes so it can be unit-tested without a database, a browser, or a
 * network. See docs/stage-1-requirements.md FR-J1.
 */

/** An ISO date string, `yyyy-mm-dd`. Dates are calendar dates, not instants. */
export type IsoDate = string;

/** §4.1 Profile — the inputs that drive every termination calculation. */
export interface Profile {
  /** Monthly BASIC salary per the MOHRE contract. Drives gratuity, leave, ILOE. */
  basicSalary: number;
  /** Monthly total including allowances. Drives notice pay in lieu only. */
  grossSalary: number;
  employmentStart: IsoDate;
  /** Actual or estimated termination date. */
  expectedLastDay: IsoDate;
  /** Excluded from gratuity service. */
  unpaidLeaveDays: number;
  /** Accrued annual leave balance, encashed at basic salary. */
  unusedLeaveDays: number;
  noticePeriodDays: number;
  /** Notice days waived by the employer — paid at GROSS, not worked. */
  noticeDaysPaidInLieu: number;
  /** Unpaid salary, commissions, ticket, reimbursements. */
  otherOwedToEmployee: number;
  /** Staff loans/advances deducted from the settlement. */
  owedToEmployer: number;
  /** ILOE subscribed >= 12 consecutive months with premiums paid. */
  iloeSubscribed12m: boolean;
  /** Termination was involuntary and non-disciplinary. */
  iloeInvoluntary: boolean;
  /** Average basic salary over the last 6 months. */
  iloeAvgBasic6m: number;
  cashSavings: number;
  otherLiquidAssets: number;
  /** Expected income during the job search. */
  monthlySideIncome: number;
  dependents: number;
  /** 30–90 standard; 180 for Golden/Green/skill-level-1-2 visas. */
  visaGraceDays: number;
  healthCoverMonthsAfterEnd: number;
}

/** §4.4 Debt. */
export interface Debt {
  id: string;
  type: 'carLoan' | 'mortgage' | 'personalLoan' | 'creditCard' | 'other';
  name: string;
  outstandingBalance: number;
  monthlyPayment: number;
  monthsRemaining: number;
  lender: string;
}

/** §4.5 SchoolFee. */
export interface SchoolFee {
  id: string;
  child: string;
  school: string;
  term: string;
  dueDate: IsoDate;
  amount: number;
  paidByCheque: boolean;
  paid: boolean;
}

export type PaymentType = 'cheque' | 'transfer' | 'autoDebit';
export type Recurrence = 'none' | 'monthly' | 'quarterly' | 'termly' | 'yearly';
export type PaymentStatus = 'upcoming' | 'paid' | 'atRisk';

/** §4.6 ScheduledPayment, including post-dated cheques. */
export interface ScheduledPayment {
  id: string;
  dueDate: IsoDate;
  payee: string;
  purpose: string;
  amount: number;
  account: string;
  type: PaymentType;
  recurrence: Recurrence;
  /**
   * True when this amount is already inside a monthly budget line. The cash
   * projection must NOT subtract such payments as lump sums or it double-counts
   * them against `netMonthlyBurn`. See G-1 in the requirements doc.
   */
  includedInBudget: boolean;
  /**
   * The budget line this payment belongs to, when `includedInBudget` is true.
   *
   * Carried on the read model only so the editor can round-trip it — nothing in
   * the engine reads it. The 1:1 rule it encodes is enforced by
   * `scheduled_in_budget_needs_category` in the database, which is where it
   * belongs; this is the form's copy, not a second source of truth.
   */
  budgetCategoryId?: string;
  /**
   * The recurring payment this row was detached from (US-22 / OQ-4).
   *
   * Set together with `detachedDate` or not at all — the database enforces that
   * pairing, because a row claiming to replace an occurrence without saying
   * which one cannot be expanded either way.
   */
  seriesId?: string;
  /**
   * Which occurrence of `seriesId` this row replaces.
   *
   * Deliberately distinct from `dueDate`: detaching an occurrence and then
   * moving it is the normal case, and without a fixed record of the occurrence
   * being replaced the series would keep generating the original date and the
   * payment would appear twice.
   */
  detachedDate?: IsoDate;
  status: PaymentStatus;
}

/** §4.3 BudgetCategory. `auto` rows are computed and read-only. */
export interface BudgetCategory {
  id: string;
  name: string;
  currentAmount: number;
  survivalAmount: number;
  editable: boolean;
  /** Which computed source owns this row, if any. */
  autoSource?: 'debts' | 'schoolFees';
}

/** §4.2 IncomeStream. */
export interface IncomeStream {
  id: string;
  name: string;
  amount: number;
  frequency: 'monthly' | 'oneOff';
  /** First day the stream pays. Undefined means "already running". */
  startDate?: IsoDate;
  /** Last day the stream pays — not the first day it does not. */
  endDate?: IsoDate;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export interface ServicePeriod {
  serviceDays: number;
  serviceYears: number;
}

export interface GratuityBreakdown {
  dailyBasic: number;
  gratuityDays: number;
  /** Before the 24-month cap is applied. */
  gratuityRaw: number;
  /** 24 × basic salary. */
  gratuityCap: number;
  gratuity: number;
  /** True when the cap reduced the payout. */
  capApplied: boolean;
  /** True when service is under one year, so no gratuity is due. */
  ineligible: boolean;
}

export interface FinalSettlement {
  gratuity: number;
  leaveEncashment: number;
  noticePayInLieu: number;
  otherOwedToEmployee: number;
  owedToEmployer: number;
  finalSettlement: number;
}

export interface IloeBenefit {
  eligible: boolean;
  /** 'A' when avg basic <= 16,000, otherwise 'B'. */
  category: 'A' | 'B' | null;
  monthlyCap: number;
  monthlyBenefit: number;
  /** Maximum three months. */
  iloeTotal: number;
  /** True when the category cap bound instead of the 60% rate. */
  capApplied: boolean;
}

export type RunwayStatus = 'good' | 'warning' | 'critical';

export interface Runway {
  totalResources: number;
  survivalSpend: number;
  netMonthlyBurn: number;
  /** `Infinity` when net burn is zero — the UI must render "Unlimited". */
  runwayMonths: number;
  status: RunwayStatus;
}

export interface Scenario {
  months: number;
  remaining: number;
  shortfall: boolean;
}

export interface Deadlines {
  settlementDue: IsoDate;
  iloeDeadline: IsoDate;
  visaGraceEnd: IsoDate;
  cheques6m: number;
  cheques12m: number;
}

/** Everything the dashboard and termination report need, computed in one pass. */
export interface Readiness {
  service: ServicePeriod;
  gratuity: GratuityBreakdown;
  settlement: FinalSettlement;
  iloe: IloeBenefit;
  runway: Runway;
  scenarios: Scenario[];
  deadlines: Deadlines;
}
