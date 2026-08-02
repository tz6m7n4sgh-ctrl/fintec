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
  if (message.includes('school_fees_child_check') || message.includes('length(trim(child))')) {
    return 'Give the child a name.';
  }
  if (message.includes('school_fees_school_check') || message.includes('length(trim(school))')) {
    return 'Give the school a name.';
  }
  if (message.includes('school_fees_term_check') || message.includes('length(trim(term))')) {
    return 'Give the term a name.';
  }
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

export interface SchoolFeeResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Creates or updates a term. The budget row is derived; this writes only school_fees. */
export async function saveSchoolFee(
  _prev: SchoolFeeResult,
  form: FormData,
): Promise<SchoolFeeResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): SchoolFeeResult => ({ ok: false, error, id });
  const c = await client();
  if (!c.ok) return fail(c.error);

  const child = s(form, 'child');
  const school = s(form, 'school');
  const term = s(form, 'term');
  const dueDate = s(form, 'dueDate');
  if (!child) return fail('Give the child a name.');
  if (!school) return fail('Give the school a name.');
  if (!term) return fail('Give the term a name.');
  if (!dueDate) return fail('Choose a due date.');

  const rawAmount = s(form, 'amount');
  const amount = Number(rawAmount);
  if (rawAmount === '' || !Number.isFinite(amount) || amount < 0) {
    return fail('Enter a valid fee amount.');
  }

  const row = {
    user_id: c.user.id,
    child,
    school,
    term,
    due_date: dueDate,
    amount,
    paid_by_cheque: form.get('paidByCheque') === 'on',
    paid: form.get('paid') === 'on',
  };
  const { error } = id
    ? await c.supabase.from('school_fees').update(row).eq('id', id)
    : await c.supabase.from('school_fees').insert(row);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function deleteSchoolFee(
  _prev: SchoolFeeResult,
  form: FormData,
): Promise<SchoolFeeResult> {
  const id = s(form, 'id');
  const fail = (error: string): SchoolFeeResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to delete.');
  const c = await client();
  if (!c.ok) return fail(c.error);

  // RLS owns tenant isolation; a user_id predicate here would only mask a broken policy.
  const { error } = await c.supabase.from('school_fees').delete().eq('id', id);
  if (error) return fail(explain(error.message));
  revalidatePath('/', 'layout');
  return { ok: true };
}
