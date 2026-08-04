/**
 * The §11 acceptance-test dataset.
 *
 * This is the reference profile the whole spec is calibrated against, so it
 * doubles as the seed for a fresh account and as the fixture the UI is
 * developed on. Changing these numbers changes what the acceptance tests mean —
 * don't tune them to make a screen look better.
 */

import type { CategoryRule } from '@/lib/engine/categorise';
import type {
  BudgetCategory,
  Debt,
  IncomeStream,
  Profile,
  ScheduledPayment,
  SchoolFee,
} from '@/lib/engine/types';
import { applyAutoRows } from '@/lib/engine/uae';

export interface BankAccount {
  id: string;
  bankName: string;
  accountLabel: string;
  last4: string;
  currency: string;
  currentBalance?: number;
  isChequeAccount: boolean;
}

export interface Transaction {
  id: string;
  bankAccountId: string;
  date: string;
  description: string;
  amount: number;
  direction: 'credit' | 'debit';
  balanceAfter?: number;
  categoryId?: string;
  source: 'statement' | 'manual';
  matchedScheduledPaymentId?: string;
  /** Which income stream a credit came from (US-33). Attribution only. */
  matchedIncomeStreamId?: string;
  isDuplicate: boolean;
  reviewStatus: 'pending' | 'confirmed' | 'edited';
}

export interface StatementUpload {
  id: string;
  bankAccountId: string;
  fileName: string;
  storagePath: string;
  fileType: 'pdf' | 'csv' | 'xlsx';
  periodStart?: string;
  periodEnd?: string;
  status: 'uploaded' | 'queued' | 'processing' | 'parsed' | 'failed' | 'reviewed';
  errorMessage?: string;
  transactionCount?: number;
  /**
   * What the parser did, line by line (NFR-6).
   *
   * The interesting outcome of reading a statement is rarely "worked" or
   * "failed" — it is "worked, and skipped four rows". A user told that 96 of
   * 100 rows imported, with no way to learn which four or why, has a ledger
   * they can neither trust nor check.
   */
  processingLog?: { level: 'info' | 'skipped' | 'error'; message: string; line?: number }[];
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  title: string;
  detail: string;
  /** Resolved against the computed deadlines at render time. */
  deadlineKey?: 'beforeLastDay' | 'lastDay' | 'settlementDue' | 'iloeDeadline' | 'visaGraceEnd' | 'healthCoverEnd' | 'recurring';
  done: boolean;
}

export const SEED_PROFILE: Profile = {
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
  healthCoverMonthsAfterEnd: 1,
};

export const SEED_ACCOUNTS: BankAccount[] = [
  { id: 'acc-enbd', bankName: 'Emirates NBD', accountLabel: 'Salary & cheques', last4: '4821', currency: 'AED', currentBalance: 62_400, isChequeAccount: true },
  { id: 'acc-adcb', bankName: 'ADCB', accountLabel: 'Car loan', last4: '9013', currency: 'AED', currentBalance: 8_900, isChequeAccount: true },
  { id: 'acc-fab', bankName: 'FAB', accountLabel: 'Mortgage', last4: '2277', currency: 'AED', currentBalance: 6_100, isChequeAccount: false },
];

export const SEED_DEBTS: Debt[] = [
  { id: 'debt-car', type: 'carLoan', name: 'Car loan', outstandingBalance: 48_000, monthlyPayment: 2_400, monthsRemaining: 20, lender: 'ADCB' },
  { id: 'debt-mortgage', type: 'mortgage', name: 'Mortgage — Al Barsha', outstandingBalance: 540_000, monthlyPayment: 3_600, monthsRemaining: 150, lender: 'FAB' },
];

/** Annual total 36,000 → 3,000/month on the budget auto row. */
export const SEED_SCHOOL_FEES: SchoolFee[] = [
  { id: 'fee-t1', child: 'Layla', school: 'GEMS', term: 'Term 1', dueDate: '2026-09-05', amount: 12_000, paidByCheque: true, paid: true },
  { id: 'fee-t2', child: 'Layla', school: 'GEMS', term: 'Term 2', dueDate: '2027-01-12', amount: 12_000, paidByCheque: true, paid: false },
  { id: 'fee-t3', child: 'Layla', school: 'GEMS', term: 'Term 3', dueDate: '2027-04-20', amount: 12_000, paidByCheque: true, paid: false },
];

export const SEED_INCOME: IncomeStream[] = [
  { id: 'inc-salary', name: 'Salary', amount: 25_000, frequency: 'monthly', endDate: '2026-09-30', active: true },
  { id: 'inc-side', name: 'Freelance / side income', amount: 0, frequency: 'monthly', active: true },
];

/** Survival total is exactly 23,000 including the two auto rows. */
const BASE_BUDGET: BudgetCategory[] = [
  { id: 'cat-rent', name: 'Rent / housing', currentAmount: 8_000, survivalAmount: 7_000, editable: true },
  { id: 'cat-util', name: 'Utilities', currentAmount: 900, survivalAmount: 700, editable: true },
  { id: 'cat-groc', name: 'Groceries', currentAmount: 3_200, survivalAmount: 2_400, editable: true },
  { id: 'cat-school', name: 'School fees', currentAmount: 0, survivalAmount: 0, editable: false, autoSource: 'schoolFees' },
  { id: 'cat-transport', name: 'Transport', currentAmount: 1_200, survivalAmount: 800, editable: true },
  { id: 'cat-health', name: 'Health & insurance', currentAmount: 800, survivalAmount: 600, editable: true },
  { id: 'cat-debt', name: 'Loan & mortgage payments', currentAmount: 0, survivalAmount: 0, editable: false, autoSource: 'debts' },
  { id: 'cat-phone', name: 'Phone & subscriptions', currentAmount: 600, survivalAmount: 300, editable: true },
  { id: 'cat-dining', name: 'Dining & entertainment', currentAmount: 2_500, survivalAmount: 400, editable: true },
  { id: 'cat-family', name: 'Family support', currentAmount: 1_500, survivalAmount: 1_000, editable: true },
  { id: 'cat-other', name: 'Other', currentAmount: 1_000, survivalAmount: 800, editable: true },
];

export const SEED_BUDGET: BudgetCategory[] = applyAutoRows(
  BASE_BUDGET,
  SEED_DEBTS,
  SEED_SCHOOL_FEES,
);

/**
 * Cheque exposure: 113,000 over 6 months, 161,000 over 12.
 * The family loan and the car-loan balloon are the only items NOT inside a
 * monthly budget line, so they are the only ones the projection subtracts as
 * lump sums (G-1).
 *
 * Every status here is `upcoming` or `paid` — never `atRisk`. Two rows
 * (`pay-rent-q4`, `pay-balloon`) used to carry a hand-set `atRisk`, and the
 * two of them implied two different rules that nothing computed (HAD-83 /
 * HAD-110). At-risk is now DERIVED at read time from the settlement-aware
 * projection (`deriveAtRisk` in lib/engine/projection.ts), which overrides
 * any stored non-paid status — so a value written here would be dead weight
 * pretending to be data. For the record, the derivation flags the Q2 and Q3
 * rent cheques (the ones straddling the projected zero-crossing), and clears
 * the two formerly-flagged rows: Q4 rent is covered by cash on hand even
 * before the settlement lands, and the balloon by the projected balance on its
 * date. `projection.test.ts` pins exactly that.
 */
export const SEED_PAYMENTS: ScheduledPayment[] = [
  { id: 'pay-dewa', dueDate: '2026-10-01', payee: 'DEWA', purpose: 'Utilities', amount: 700, account: 'ENBD ··4821', type: 'autoDebit', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-rent-q4', dueDate: '2026-10-05', payee: 'Landlord — Al Barsha villa', purpose: 'Rent — Q4 cheque', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-car', dueDate: '2026-10-06', payee: 'ADCB — car loan', purpose: 'Debt service', amount: 2_400, account: 'ADCB ··9013', type: 'autoDebit', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-mortgage', dueDate: '2026-10-08', payee: 'FAB — mortgage', purpose: 'Debt service', amount: 3_600, account: 'FAB ··2277', type: 'autoDebit', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-etisalat', dueDate: '2026-10-10', payee: 'Etisalat', purpose: 'Phone & internet', amount: 300, account: 'ENBD ··4821', type: 'autoDebit', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-daman', dueDate: '2026-10-20', payee: 'Daman — health cover', purpose: 'Insurance', amount: 600, account: 'ENBD ··4821', type: 'transfer', recurrence: 'monthly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-family', dueDate: '2026-12-10', payee: 'Family loan repayment', purpose: 'Personal obligation', amount: 20_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'none', includedInBudget: false, status: 'upcoming' },
  { id: 'pay-rent-q1', dueDate: '2027-01-05', payee: 'Landlord — Al Barsha villa', purpose: 'Rent — Q1 cheque', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-balloon', dueDate: '2027-03-15', payee: 'ADCB — car loan balloon', purpose: 'Final settlement instalment', amount: 45_000, account: 'ADCB ··9013', type: 'cheque', recurrence: 'none', includedInBudget: false, status: 'upcoming' },
  { id: 'pay-rent-q2', dueDate: '2027-04-05', payee: 'Landlord — Al Barsha villa', purpose: 'Rent — Q2 cheque', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
  { id: 'pay-rent-q3', dueDate: '2027-07-05', payee: 'Landlord — Al Barsha villa', purpose: 'Rent — Q3 cheque', amount: 18_000, account: 'ENBD ··4821', type: 'cheque', recurrence: 'quarterly', includedInBudget: true, status: 'upcoming' },
];

/** Six months of confirmed history, driving the actual-spend trend. */
export const SEED_TRANSACTIONS: Transaction[] = (() => {
  const months: Array<[string, number]> = [
    ['2026-04', 26_800], ['2026-05', 27_900], ['2026-06', 26_400],
    ['2026-07', 28_700], ['2026-08', 27_200], ['2026-09', 28_900],
  ];
  const rows: Transaction[] = [];
  months.forEach(([m, spend], i) => {
    rows.push({
      id: `txn-sal-${m}`, bankAccountId: 'acc-enbd', date: `${m}-25`,
      description: 'SALARY CREDIT — EMPLOYER LLC', amount: 25_000, direction: 'credit',
      source: 'statement', isDuplicate: false, reviewStatus: 'confirmed',
      matchedScheduledPaymentId: undefined,
    });
    // One aggregate debit per month keeps the seed readable while still
    // producing a truthful month-over-month spend series.
    rows.push({
      id: `txn-spend-${m}`, bankAccountId: 'acc-enbd', date: `${m}-28`,
      description: 'MONTHLY OUTGOINGS (aggregated)', amount: spend, direction: 'debit',
      source: 'statement', isDuplicate: false, reviewStatus: 'confirmed',
      categoryId: i % 2 === 0 ? 'cat-groc' : 'cat-dining',
    });
  });
  // A few pending rows so the review inbox is not empty on first run.
  rows.push(
    { id: 'txn-p1', bankAccountId: 'acc-enbd', date: '2026-09-29', description: 'DEWA SEP BILL', amount: 690, direction: 'debit', source: 'statement', isDuplicate: false, reviewStatus: 'pending' },
    { id: 'txn-p2', bankAccountId: 'acc-enbd', date: '2026-09-29', description: 'SALIK TOLL RECHARGE', amount: 100, direction: 'debit', source: 'statement', isDuplicate: false, reviewStatus: 'pending' },
    { id: 'txn-p3', bankAccountId: 'acc-adcb', date: '2026-09-28', description: 'ADCB CAR LOAN INSTALMENT', amount: 2_400, direction: 'debit', source: 'statement', isDuplicate: false, reviewStatus: 'pending', matchedScheduledPaymentId: 'pay-car' },
  );
  return rows;
})();

/**
 * Categorisation rules for the reference profile (US-32).
 *
 * Chosen to demonstrate the ordering rules rather than to be exhaustive:
 * `ADCB CAR LOAN` is longer than `ADCB` and beats it on specificity at equal
 * priority, which is the tie-break most likely to be got wrong.
 */
export const SEED_CATEGORY_RULES: CategoryRule[] = [
  { id: 'rule-dewa', keyword: 'DEWA', categoryId: 'cat-util', priority: 100 },
  { id: 'rule-salik', keyword: 'SALIK', categoryId: 'cat-transport', priority: 100 },
  { id: 'rule-etisalat', keyword: 'ETISALAT', categoryId: 'cat-phone', priority: 100 },
  { id: 'rule-carrefour', keyword: 'CARREFOUR', categoryId: 'cat-groc', priority: 100 },
  { id: 'rule-adcb-car', keyword: 'ADCB CAR LOAN', categoryId: 'cat-debt', priority: 100 },
];

export const SEED_UPLOADS: StatementUpload[] = [
  { id: 'up-1', bankAccountId: 'acc-enbd', fileName: 'ENBD-statement-Sep2026.pdf', storagePath: 'seed/ENBD-Sep2026.pdf', fileType: 'pdf', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'parsed', transactionCount: 2, createdAt: '2026-09-30' },
  { id: 'up-2', bankAccountId: 'acc-adcb', fileName: 'ADCB-Sep2026.csv', storagePath: 'seed/ADCB-Sep2026.csv', fileType: 'csv', periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'parsed', transactionCount: 1, processingLog: [{ level: 'info', message: 'Read dates as day/month/year and "." as the decimal point.' }, { level: 'skipped', line: 14, message: 'No readable date in "TOTAL FOR PERIOD". Totals and subtotal lines look like this.' }, { level: 'info', message: 'Checked against the running balance: 1 of 1 rows agree, so the debit and credit directions are confirmed by the file itself.' }, { level: 'info', message: 'Read 1 transaction from 2 rows.' }, { level: 'info', message: '1 transaction added, waiting for you to confirm it.' }], createdAt: '2026-09-30' },
  { id: 'up-3', bankAccountId: 'acc-fab', fileName: 'FAB-scan-Sep2026.pdf', storagePath: 'seed/FAB-scan.pdf', fileType: 'pdf', status: 'failed', errorMessage: 'The PDF contains no extractable text — it looks like a scanned image. Re-export the statement as text or CSV from your bank, or enter the transactions manually.', processingLog: [{ level: 'error', message: 'PDF statements are not parsed yet. Reading one needs layout reconstruction, and a PDF read as plain text produces a scatter of numbers that would import as convincing, wrong transactions. Export CSV from your bank instead — every UAE bank offers it.' }], createdAt: '2026-09-30' },
];

/** §8 action plan. Deadline dates are computed, not stored. */
export const SEED_CHECKLIST: ChecklistItem[] = [
  { id: 'ck-1', title: 'Save contract, 6 payslips and leave records', detail: 'HR systems lock you out on termination — download everything while you still have access.', deadlineKey: 'beforeLastDay', done: false },
  { id: 'ck-2', title: 'Verify ILOE subscription is active', detail: 'iloe.ae or 600 599 555. Without 12 months of paid premiums there is no claim.', deadlineKey: 'beforeLastDay', done: false },
  { id: 'ck-3', title: 'Switch to the survival budget and move buffer cash to a second bank', detail: 'Banks can freeze accounts when salary payments stop.', deadlineKey: 'beforeLastDay', done: false },
  { id: 'ck-4', title: 'Talk to your bank about restructuring loans BEFORE missing a payment', detail: 'Restructuring is far easier while your record is clean.', deadlineKey: 'beforeLastDay', done: false },
  { id: 'ck-5', title: 'Get the termination letter in writing', detail: 'Required for the ILOE claim.', deadlineKey: 'lastDay', done: false },
  { id: 'ck-6', title: 'Final settlement due — compare against the app figure', detail: 'If short or late, contact MOHRE on 600 590 000.', deadlineKey: 'settlementDue', done: false },
  { id: 'ck-7', title: 'Claim ILOE at iloe.ae — HARD DEADLINE', detail: 'Emirates ID, termination letter, work-permit cancellation. Miss this and the benefit is gone.', deadlineKey: 'iloeDeadline', done: false },
  { id: 'ck-8', title: 'Decide your visa path', detail: 'New employer, own visa, family sponsorship or exit. AED 50/day overstay after the grace period.', deadlineKey: 'visaGraceEnd', done: false },
  { id: 'ck-9', title: 'Arrange health insurance', detail: 'Mandatory for residency once employer cover ends.', deadlineKey: 'healthCoverEnd', done: false },
  { id: 'ck-10', title: 'Weekly job pipeline review; monthly budget and runway refresh', detail: 'Keeps the runway figure honest as circumstances change.', deadlineKey: 'recurring', done: false },
];
