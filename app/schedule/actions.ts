'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Scheduled payments and post-dated cheques (US-21 / FR-E1 / §4.6).
 *
 * The highest-consequence write path in this app, for two reasons that have
 * nothing to do with each other.
 *
 * **G-1, the double-count rule.** `included_in_budget` decides whether the cash
 * projection subtracts a payment as a lump sum. If it is true the amount is
 * already inside `netMonthlyBurn`, and subtracting it again understates runway.
 * For the §11 reference profile, AED 161,000 of cheques fall due within twelve
 * months but only 65,000 is deducted as lump sums — get the flag wrong and the
 * runway figure is wrong in a way that looks entirely reasonable.
 *
 * **R-5, cheques.** A bounced cheque in the UAE carries civil and criminal
 * consequences. A cheque that fails to reach the calendar is the worst thing
 * this screen can produce, which is why the flag is surfaced in the form and in
 * the table rather than hidden behind a sensible default.
 *
 * Follows the write pattern set by `app/profile/actions.ts`: a server action so
 * no Supabase client reaches the browser, validation left in the database with
 * a translation layer over the constraint names, `revalidatePath` after, and no
 * `.eq('user_id', ...)` — RLS filters on `auth.uid()` and is proven to (SEC-1),
 * so a redundant filter would hide a broken policy rather than fix one.
 */

export interface SaveResult {
  ok: boolean;
  error?: string;
  /** Which row failed, so the editor can reopen the right form. */
  id?: string;
}

function s(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function n(form: FormData, key: string): number {
  const raw = s(form, key);
  if (raw === '') return 0;
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Turns a constraint violation into a sentence.
 *
 * `scheduled_in_budget_needs_category` is the one that matters: it is the
 * database half of G-1, and a user hitting it has done something meaningful —
 * claimed a payment is already budgeted without saying which line covers it.
 */
function explain(message: string): string {
  if (message.includes('scheduled_in_budget_needs_category')) {
    return 'An in-budget payment must name the budget line it belongs to — that link is what stops the projection subtracting it twice. Either pick a budget line, or untick "already in my monthly budget".';
  }
  if (message.includes('scheduled_payments_payee_check') || message.includes('length(trim(payee))')) {
    return 'Give the payment a payee — it is how you will recognise it on the calendar.';
  }
  if (message.includes('violates check constraint') && message.includes('amount')) {
    return 'The amount cannot be negative.';
  }
  if (message.includes('violates foreign key constraint')) {
    return 'That budget line or bank account no longer exists. Reload the page and pick again.';
  }
  return message;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

/**
 * Creates or updates one payment.
 *
 * `id` present means update, absent means insert — the form decides, not this
 * action, so the same code path serves both and cannot drift between them.
 */
export async function savePayment(_prev: SaveResult, form: FormData): Promise<SaveResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): SaveResult => ({ ok: false, error, id });

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail(SIGNED_OUT);

  const dueDate = s(form, 'dueDate');
  if (!dueDate) {
    return fail('A due date is required — without one the payment cannot reach the calendar.');
  }

  const includedInBudget = form.get('includedInBudget') === 'on';
  const budgetCategoryId = s(form, 'budgetCategoryId') || null;

  /*
   * The database enforces this too, and that constraint is the real boundary.
   * Checking here as well is deliberate rather than duplicated logic: the
   * constraint produces a rejection *after* a round trip, and this is the one
   * rule where the user needs to understand the consequence rather than just be
   * told no. The message is the same in both paths.
   */
  if (includedInBudget && !budgetCategoryId) {
    return fail(explain('scheduled_in_budget_needs_category'));
  }

  const row = {
    user_id: user.id,
    due_date: dueDate,
    payee: s(form, 'payee'),
    purpose: s(form, 'purpose'),
    amount: n(form, 'amount'),
    account_label: s(form, 'accountLabel'),
    type: s(form, 'type') || 'transfer',
    recurrence: s(form, 'recurrence') || 'none',
    included_in_budget: includedInBudget,
    // Null rather than '' — the column is a uuid foreign key, and an empty
    // string is not a uuid.
    budget_category_id: includedInBudget ? budgetCategoryId : null,
    status: s(form, 'status') || 'upcoming',
  };

  const { error } = id
    ? await supabase.from('scheduled_payments').update(row).eq('id', id)
    : await supabase.from('scheduled_payments').insert(row);

  if (error) return fail(explain(error.message));

  // The calendar, the projection, the dashboard exposure tile and the report
  // all read payments. Every one of them is stale now.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Deletes one payment.
 *
 * Filtered by `id` alone. RLS makes a delete of somebody else's row a zero-row
 * no-op rather than an error, which SEC-1 asserts directly — adding
 * `.eq('user_id', ...)` here would make a broken policy look like a working one.
 */
export async function deletePayment(_prev: SaveResult, form: FormData): Promise<SaveResult> {
  const id = s(form, 'id');
  const fail = (error: string): SaveResult => ({ ok: false, error, id });

  if (!id) return fail('Nothing to delete.');

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail(SIGNED_OUT);

  const { error } = await supabase.from('scheduled_payments').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}
