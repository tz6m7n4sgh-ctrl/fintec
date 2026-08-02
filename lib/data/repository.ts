/**
 * Supabase-backed repository — the live read path.
 *
 * Reads happen in **server components**, deliberately. Doing them client-side
 * would pull the Supabase client into the shared bundle, so every screen would
 * pay the ~67 kB that currently sits only on /sign-in. Reading here keeps the
 * other routes at zero client JavaScript.
 *
 * Row-level security does the filtering. Every policy is keyed to
 * `(select auth.uid()) = user_id`, so these queries carry no `.eq('user_id', …)`
 * — not as a shortcut, but because the database refusing the rows is a stronger
 * guarantee than a `where` clause the caller could forget. If RLS were ever
 * misconfigured, adding that filter here would hide it rather than fix it.
 *
 * Money arrives from `numeric(14,2)` as a string, because JS numbers cannot
 * represent every decimal exactly and the Postgres driver refuses to lose
 * precision silently. `num()` is the single conversion point.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BudgetCategory,
  Debt,
  IncomeStream,
  Profile,
  ScheduledPayment,
  SchoolFee,
} from '@/lib/engine/types';
import type { BankAccount, ChecklistItem, StatementUpload, Transaction } from './seed';

/** numeric(14,2) arrives as a string. One place converts it. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A live dataset for one user, or null when the user has no profile row yet. */
export interface LiveData {
  profile: Profile;
  budget: BudgetCategory[];
  debts: Debt[];
  schoolFees: SchoolFee[];
  payments: ScheduledPayment[];
  income: IncomeStream[];
  accounts: BankAccount[];
  transactions: Transaction[];
  uploads: StatementUpload[];
  checklist: ChecklistItem[];
}

/**
 * Loads everything the read model needs for the signed-in user.
 *
 * Returns `null` when there is no profile row. That is the honest answer for a
 * newly created account: the engine cannot compute a gratuity without a salary
 * or an employment start date, and inventing defaults would produce confident
 * figures about nothing. The caller falls back to the seed and says so.
 */
export async function loadLiveData(supabase: SupabaseClient): Promise<LiveData | null> {
  const { data: profileRow, error } = await supabase
    .from('profiles')
    .select('*')
    .maybeSingle();

  // A missing profile is an expected state, not a failure. A real error (RLS
  // rejection, network) is not — surface it rather than silently seeding.
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  if (!profileRow) return null;

  const [budget, debts, schoolFees, payments, income, accounts, transactions, uploads, checklist] =
    await Promise.all([
      supabase.from('budget_categories').select('*').order('sort_order'),
      supabase.from('debts').select('*').order('created_at'),
      supabase.from('school_fees').select('*').order('due_date'),
      supabase.from('scheduled_payments').select('*').order('due_date'),
      supabase.from('income_streams').select('*').order('created_at'),
      supabase.from('bank_accounts').select('*').order('created_at'),
      supabase.from('transactions').select('*').order('date', { ascending: false }),
      supabase.from('statement_uploads').select('*').order('created_at', { ascending: false }),
      supabase.from('checklist_items').select('*').order('sort_order'),
    ]);

  const profile: Profile = {
    basicSalary: num(profileRow.basic_salary),
    grossSalary: num(profileRow.gross_salary),
    employmentStart: profileRow.employment_start,
    expectedLastDay: profileRow.expected_last_day,
    unpaidLeaveDays: profileRow.unpaid_leave_days,
    unusedLeaveDays: profileRow.unused_leave_days,
    noticePeriodDays: profileRow.notice_period_days,
    noticeDaysPaidInLieu: profileRow.notice_days_paid_in_lieu,
    otherOwedToEmployee: num(profileRow.other_owed_to_employee),
    owedToEmployer: num(profileRow.owed_to_employer),
    iloeSubscribed12m: profileRow.iloe_subscribed_12m,
    iloeInvoluntary: profileRow.iloe_involuntary,
    iloeAvgBasic6m: num(profileRow.iloe_avg_basic_6m),
    cashSavings: num(profileRow.cash_savings),
    otherLiquidAssets: num(profileRow.other_liquid_assets),
    monthlySideIncome: num(profileRow.monthly_side_income),
    dependents: profileRow.dependents,
    visaGraceDays: profileRow.visa_grace_days,
    healthCoverMonthsAfterEnd: profileRow.health_cover_months_after_end,
  };

  return {
    profile,
    budget: (budget.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      currentAmount: num(r.current_amount),
      survivalAmount: num(r.survival_amount),
      editable: r.editable,
      autoSource: r.auto_source ?? undefined,
    })),
    debts: (debts.data ?? []).map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      outstandingBalance: num(r.outstanding_balance),
      monthlyPayment: num(r.monthly_payment),
      monthsRemaining: r.months_remaining,
      lender: r.lender,
    })),
    schoolFees: (schoolFees.data ?? []).map((r) => ({
      id: r.id,
      child: r.child,
      school: r.school,
      term: r.term,
      dueDate: r.due_date,
      amount: num(r.amount),
      paidByCheque: r.paid_by_cheque,
      paid: r.paid,
    })),
    payments: (payments.data ?? []).map((r) => ({
      id: r.id,
      dueDate: r.due_date,
      payee: r.payee,
      purpose: r.purpose,
      amount: num(r.amount),
      account: r.account_label,
      type: r.type,
      recurrence: r.recurrence,
      includedInBudget: r.included_in_budget,
      status: r.status,
    })),
    income: (income.data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      amount: num(r.amount),
      frequency: r.frequency,
      endDate: r.end_date ?? undefined,
      active: r.active,
    })),
    accounts: (accounts.data ?? []).map((r) => ({
      id: r.id,
      bankName: r.bank_name,
      accountLabel: r.account_label,
      // The schema stores a label, not a card number — never the full account.
      // The UI shows the last four characters of whatever the user chose to
      // call it, so nothing sensitive is reconstructed here.
      last4: r.account_label.slice(-4),
      currency: r.currency,
      currentBalance: r.current_balance === null ? undefined : num(r.current_balance),
      isChequeAccount: r.is_cheque_account,
    })),
    transactions: (transactions.data ?? []).map((r) => ({
      id: r.id,
      bankAccountId: r.bank_account_id,
      date: r.date,
      description: r.description,
      amount: num(r.amount),
      direction: r.direction,
      balanceAfter: r.balance_after === null ? undefined : num(r.balance_after),
      categoryId: r.category_id ?? undefined,
      source: r.source,
      matchedScheduledPaymentId: r.matched_scheduled_payment_id ?? undefined,
      isDuplicate: r.is_duplicate,
      reviewStatus: r.review_status,
    })),
    uploads: (uploads.data ?? []).map((r) => ({
      id: r.id,
      bankAccountId: r.bank_account_id,
      fileName: r.file_name,
      storagePath: r.storage_path,
      fileType: r.file_type,
      periodStart: r.period_start ?? undefined,
      periodEnd: r.period_end ?? undefined,
      status: r.status,
      errorMessage: r.error_message ?? undefined,
      transactionCount: r.transaction_count ?? undefined,
      createdAt: r.created_at,
    })),
    checklist: (checklist.data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      deadlineKey: r.deadline_key ?? undefined,
      done: r.done,
    })),
  };
}
