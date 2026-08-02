'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Loans and mortgages (US-19 / FR-E1 / §4.4).
 *
 * The rule this screen has to respect is that it does **not** own the budget.
 * `monthlyDebtService()` sums `monthly_payment` into the read-only "Loan &
 * mortgage payments" row, and that derivation is defended at three layers:
 * `applyAutoRows()` forces the row read-only, a check constraint rejects an
 * editable auto row, and a unique index allows one per source.
 *
 * So nothing here writes `budget_categories`. Adding a debt changes the budget
 * only by changing what the derivation reads. A second write path would be a
 * second place for the figure to drift, and the figure in question is a
 * component of runway.
 */

export interface DebtResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const DEBT_TYPES = ['carLoan', 'mortgage', 'personalLoan', 'creditCard', 'other'] as const;
type DebtType = (typeof DEBT_TYPES)[number];

function s(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function n(form: FormData, key: string): number {
  const raw = s(form, key);
  if (raw === '') return 0;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function explain(message: string): string {
  if (message.includes('debts_name_check') || message.includes('length(trim(name))')) {
    return 'Give the facility a name — it is how you will recognise it in the budget breakdown.';
  }
  if (message.includes('monthly_payment')) {
    return 'The monthly payment cannot be negative.';
  }
  if (message.includes('outstanding_balance')) {
    return 'The outstanding balance cannot be negative.';
  }
  if (message.includes('months_remaining')) {
    return 'Months remaining cannot be negative.';
  }
  if (message.includes('invalid input value for enum')) {
    return 'Pick one of the listed facility types.';
  }
  return message;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

/** Discriminated on `ok` so a failure narrows to a real string, not a maybe. */
async function client() {
  const supabase = await createClient();
  if (!supabase) return { ok: false as const, error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false as const, error: SIGNED_OUT };
  return { ok: true as const, supabase, user: auth.user };
}

/** Creates or updates one facility. `id` present means update. */
export async function saveDebt(_prev: DebtResult, form: FormData): Promise<DebtResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): DebtResult => ({ ok: false, error, id });

  const c = await client();
  if (!c.ok) return fail(c.error);
  const { supabase, user } = c;

  const name = s(form, 'name');
  if (!name) return fail('Give the facility a name.');

  const type = s(form, 'type') as DebtType;
  if (!DEBT_TYPES.includes(type)) return fail('Pick one of the listed facility types.');

  const row = {
    user_id: user.id,
    type,
    name,
    lender: s(form, 'lender'),
    outstanding_balance: n(form, 'outstandingBalance'),
    monthly_payment: n(form, 'monthlyPayment'),
    // An integer column; a fractional month is not a thing.
    months_remaining: Math.round(n(form, 'monthsRemaining')),
  };

  const { error } = id
    ? await supabase.from('debts').update(row).eq('id', id)
    : await supabase.from('debts').insert(row);

  if (error) return fail(explain(error.message));

  // The budget's auto row, the survival total, runway, the scenarios and the
  // readiness score are all downstream of monthly_payment.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Deletes one facility.
 *
 * No `.eq('user_id', …)`: RLS makes a delete of someone else's row a zero-row
 * no-op, and SEC-1 asserts that directly. A redundant filter would make a
 * broken policy look like a working one.
 */
export async function deleteDebt(_prev: DebtResult, form: FormData): Promise<DebtResult> {
  const id = s(form, 'id');
  const fail = (error: string): DebtResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to delete.');

  const c = await client();
  if (!c.ok) return fail(c.error);

  const { error } = await c.supabase.from('debts').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// School fees (US-20 / HAD-23)
// ---------------------------------------------------------------------------

export interface SchoolFeeResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * School fees reach three places, and this screen writes to none of them.
 *
 * - The **budget**, through `monthlySchoolFees()` into the read-only "School
 *   fees" auto row — annual total ÷ 12.
 * - The **calendar and cheque exposure**, through `schoolFeeObligations()`,
 *   which derives one dated obligation per unpaid term (HAD-81).
 * - The **projection**, via those obligations.
 *
 * All three are derivations from `school_fees`. Writing a `scheduled_payments`
 * row when a fee is saved would be a second write path for one obligation —
 * which is exactly what the seed used to do by hand, and what HAD-81 removed.
 * The issue says so explicitly: *do not fix it by writing a scheduled_payments
 * row.* Saving a term here is the whole of the write.
 */
function explainFee(message: string): string {
  if (message.includes('school_fees_child_check') || message.includes('length(trim(child))')) {
    return 'Give the child a name — it is how you will recognise whose fee is due.';
  }
  if (message.includes('school_fees_school_check') || message.includes('length(trim(school))')) {
    return 'Give the school a name — it becomes the payee on the calendar.';
  }
  if (message.includes('school_fees_term_check') || message.includes('length(trim(term))')) {
    return 'Name the term, so you can tell one instalment from the next.';
  }
  if (message.includes('violates check constraint') && message.includes('amount')) {
    return 'The amount cannot be negative.';
  }
  return message;
}

/**
 * Creates or updates one term.
 *
 * A cheque-paid term becomes a dated cheque on the calendar the moment this
 * returns — derived, not written. Before HAD-81 it reached the budget and
 * nothing else, which for an obligation whose whole risk is a bounced cheque
 * (R-5) was the worst place to be invisible.
 */
export async function saveSchoolFee(
  _prev: SchoolFeeResult,
  form: FormData,
): Promise<SchoolFeeResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): SchoolFeeResult => ({ ok: false, error, id });

  const c = await client();
  if (!c.ok) return fail(c.error);

  const dueDate = s(form, 'dueDate');
  if (!dueDate) {
    return fail('A due date is required — without one the term cannot reach the calendar.');
  }

  /*
   * Parsed here rather than through `n()`, which is the helper the debts
   * actions use. `n()` coerces anything unparseable to 0 — fine for an
   * optional balance, wrong for this.
   *
   * A fee silently stored as 0 does not fail: it drops out of the budget's
   * annual ÷ 12, and if it is cheque-paid it renders on the calendar as a
   * cheque for nothing. The user typed an amount, saw "saved", and now owes
   * money the app does not know about. Codex caught this in PR #18 and it is
   * the better call, so it is taken from there.
   */
  const rawAmount = s(form, 'amount');
  const amount = Number(rawAmount);
  if (rawAmount === '' || !Number.isFinite(amount) || amount < 0) {
    return fail('Enter the fee amount as a number — a term saved without one would vanish from the budget and show on the calendar as a cheque for nothing.');
  }

  const row = {
    user_id: c.user.id,
    child: s(form, 'child'),
    school: s(form, 'school'),
    term: s(form, 'term'),
    due_date: dueDate,
    amount,
    paid_by_cheque: form.get('paidByCheque') === 'on',
    paid: form.get('paid') === 'on',
  };

  const { error } = id
    ? await c.supabase.from('school_fees').update(row).eq('id', id)
    : await c.supabase.from('school_fees').insert(row);
  if (error) return fail(explainFee(error.message));

  // The budget auto row, the calendar, both exposure tiles, the projection and
  // the report all derive from this table. Every one of them is stale now.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Deletes one term. RLS, not a redundant user filter, owns the isolation. */
export async function deleteSchoolFee(
  _prev: SchoolFeeResult,
  form: FormData,
): Promise<SchoolFeeResult> {
  const id = s(form, 'id');
  const fail = (error: string): SchoolFeeResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to delete.');

  const c = await client();
  if (!c.ok) return fail(c.error);

  const { error } = await c.supabase.from('school_fees').delete().eq('id', id);
  if (error) return fail(explainFee(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}
