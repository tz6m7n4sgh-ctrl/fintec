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
  if (message.includes('scheduled_one_override_per_occurrence')) {
    return 'That occurrence has already been changed once. Edit the existing entry rather than detaching it again — two overrides for one date would show the payment twice.';
  }
  if (message.includes('scheduled_detached_is_one_off')) {
    return 'A single changed occurrence cannot itself repeat.';
  }
  if (message.includes('scheduled_detach_needs_both')) {
    return 'That occurrence could not be identified. Reload the page and try again.';
  }
  if (message.includes('violates foreign key constraint')) {
    return 'That budget line or bank account no longer exists. Reload the page and pick again.';
  }
  return message;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

/**
 * Derived rows carry a sentinel id — `fee:<uuid>` for a school-fee term
 * (HAD-81), `auto:*` for a computed budget line — precisely so that a write
 * against one cannot silently succeed. Postgres already refuses them: the id
 * column is a uuid and the comparison fails with `22P02`.
 *
 * This is the second line, not the first. The editor does not offer Edit or
 * Delete on a derived row at all. But a stale page, a replayed form or a future
 * screen that forgets could still get here, and `22P02 invalid input syntax for
 * type uuid` is not a sentence to show anybody. The rule is the same either
 * way: change the record that owns the number, not the row derived from it.
 */
const DERIVED_ID = /^(fee|auto):/;
const DERIVED_MESSAGE =
  'That row is computed from a school-fee term, not stored as a payment — change it on the Loans & fees screen and it will update here.';

/**
 * Creates or updates one payment.
 *
 * `id` present means update, absent means insert — the form decides, not this
 * action, so the same code path serves both and cannot drift between them.
 */
export async function savePayment(_prev: SaveResult, form: FormData): Promise<SaveResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): SaveResult => ({ ok: false, error, id });

  if (id && DERIVED_ID.test(id)) return fail(DERIVED_MESSAGE);

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return fail(SIGNED_OUT);

  const dueDate = s(form, 'dueDate');
  if (!dueDate) {
    return fail('A due date is required — without one the payment cannot reach the calendar.');
  }

  /*
   * Detaching one occurrence (US-22 / OQ-4). Both fields travel together or not
   * at all — the database enforces that pairing, because a row claiming to
   * replace an occurrence without saying which one cannot be expanded either
   * way. A detached row must also not recur, so the form forces `none`.
   */
  const seriesId = s(form, 'seriesId') || null;
  const detachedDate = s(form, 'detachedDate') || null;
  if ((seriesId === null) !== (detachedDate === null)) {
    return fail('That occurrence could not be identified. Reload the page and try again.');
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
    // A detached occurrence stands alone; two levels of recurrence would make
    // "which occurrence does this replace" unanswerable.
    recurrence: seriesId ? 'none' : s(form, 'recurrence') || 'none',
    series_id: seriesId,
    detached_date: detachedDate,
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
  if (DERIVED_ID.test(id)) return fail(DERIVED_MESSAGE);

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail(SIGNED_OUT);

  const { error } = await supabase.from('scheduled_payments').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Marks one payment paid, or un-marks it (US-18 / FR-B4).
 *
 * The *manual* half. The automatic half writes nothing at all: a confirmed
 * transaction naming a payment marks it paid by derivation in
 * `lib/engine/settle.ts`, so removing that match reverts the status for free
 * and a stored `atRisk` is never destroyed.
 *
 * This is the other case — the user asserting something the transactions do
 * not show, like a cash payment or a transfer from an account the app cannot
 * see. That is a fact only they have, so it is stored, and stored `paid` wins
 * over the absence of a match.
 *
 * Un-marking writes `upcoming` rather than restoring a previous value, and
 * that is a real limitation rather than an oversight: nothing records what the
 * status was before, so a payment manually marked paid from `atRisk` comes
 * back as `upcoming`. The automatic path does not have this problem, which is
 * the argument for preferring it. Filed as HAD-83.
 */
export async function setPaymentPaid(_prev: SaveResult, form: FormData): Promise<SaveResult> {
  const id = s(form, 'id');
  const fail = (error: string): SaveResult => ({ ok: false, error, id });

  if (!id) return fail('Nothing to update.');
  if (DERIVED_ID.test(id)) {
    // A school-fee obligation is derived; its paid state lives on the term.
    return fail('That row is a school-fee term — mark it paid on the Loans & fees screen.');
  }

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail(SIGNED_OUT);

  const paid = form.get('paid') === 'on';

  const { error } = await supabase
    .from('scheduled_payments')
    .update({ status: paid ? 'paid' : 'upcoming' })
    .eq('id', id);

  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}
