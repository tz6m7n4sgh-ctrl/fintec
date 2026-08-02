'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * The editable budget (US-23 / FR-D1).
 *
 * The survival total is the denominator of runway. Every figure the user opens
 * this app to see — months of cover, the 3/6/9/12 scenarios, the readiness
 * score — moves when a number on this screen moves. That is the whole point of
 * the story, and it is also why the write path is narrower than it looks.
 *
 * **Auto rows are never written here.** "School fees" and "Loan & mortgage
 * payments" are derived by `applyAutoRows()` from the debts and school-fees
 * tables; the database refuses to mark them editable, and a unique index allows
 * only one per source. What neither guard stops is an UPDATE of the *amounts*
 * on an auto row — a form post naming one would be accepted by Postgres. So
 * this action reads the user's own rows first and writes only those with no
 * `auto_source`, rather than trusting the ids it was handed.
 */

export interface BudgetResult {
  ok: boolean;
  error?: string;
  /** How many rows actually changed, so the UI can say something true. */
  saved?: number;
}

function s(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function amount(raw: FormDataEntryValue | null): number | null {
  const v = Number(String(raw ?? '').trim());
  if (!Number.isFinite(v) || v < 0) return null;
  // The column is numeric(14,2); more precision than that is silently lost, so
  // round here rather than letting the database decide.
  return Math.round(v * 100) / 100;
}

function explain(message: string): string {
  if (message.includes('budget_name_unique_per_user')) {
    return 'You already have a category with that name. Budget lines are unique so a payment can point at exactly one.';
  }
  if (message.includes('budget_auto_not_editable')) {
    return 'That is a computed row — it is owned by the Loans or School fees screen and cannot be edited here.';
  }
  if (message.includes('budget_categories_name_check') || message.includes('length(trim(name))')) {
    return 'Give the category a name.';
  }
  if (message.includes('violates check constraint')) {
    return 'Amounts cannot be negative.';
  }
  if (message.includes('violates foreign key constraint')) {
    return 'A scheduled payment still points at this category. Change that payment first, or untick "already in my monthly budget" on it.';
  }
  return message;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

async function client() {
  const supabase = await createClient();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { error: SIGNED_OUT };
  return { supabase, user: auth.user };
}

/**
 * Saves every changed amount in one submission.
 *
 * A single save rather than per-row autosave, deliberately. Editing a budget is
 * an act of planning — you move several lines together and want to see the
 * runway that results — and a per-row write would produce a sequence of
 * intermediate runway figures, each briefly true and none of them the answer.
 */
export async function saveBudget(_prev: BudgetResult, form: FormData): Promise<BudgetResult> {
  const c = await client();
  if ('error' in c) return { ok: false, error: c.error };
  const { supabase } = c;

  // Read first, then write only what is genuinely editable. RLS scopes this to
  // the signed-in user, so there is no `.eq('user_id', …)` — SEC-1 proves the
  // policy filters, and a redundant filter would hide a broken one.
  const { data: existing, error: readError } = await supabase
    .from('budget_categories')
    .select('id, current_amount, survival_amount, auto_source');

  if (readError) return { ok: false, error: explain(readError.message) };

  const updates: { id: string; current_amount: number; survival_amount: number }[] = [];

  for (const row of existing ?? []) {
    // The guard that matters. An auto row's amounts are derived, and letting a
    // form post overwrite them would put a stale number on the budget screen
    // that silently disagrees with the Loans screen it came from.
    if (row.auto_source) continue;

    const current = amount(form.get(`current-${row.id}`));
    const survival = amount(form.get(`survival-${row.id}`));
    // A field absent from the post is a field the form did not render. Leave it.
    if (current === null || survival === null) continue;

    if (current !== Number(row.current_amount) || survival !== Number(row.survival_amount)) {
      updates.push({ id: row.id, current_amount: current, survival_amount: survival });
    }
  }

  if (updates.length === 0) return { ok: true, saved: 0 };

  for (const u of updates) {
    const { error } = await supabase
      .from('budget_categories')
      .update({ current_amount: u.current_amount, survival_amount: u.survival_amount })
      .eq('id', u.id);
    if (error) return { ok: false, error: explain(error.message) };
  }

  // Runway, the scenarios, the readiness score and the projection all read the
  // survival total. Everything is stale.
  revalidatePath('/', 'layout');
  return { ok: true, saved: updates.length };
}

/** Adds an editable category. Auto rows are created by their source, not here. */
export async function addCategory(_prev: BudgetResult, form: FormData): Promise<BudgetResult> {
  const c = await client();
  if ('error' in c) return { ok: false, error: c.error };
  const { supabase, user } = c;

  const name = s(form, 'name');
  if (!name) return { ok: false, error: 'Give the category a name.' };

  const current = amount(form.get('current')) ?? 0;
  const survival = amount(form.get('survival')) ?? 0;

  const { error } = await supabase.from('budget_categories').insert({
    user_id: user.id,
    name,
    current_amount: current,
    survival_amount: survival,
    // Explicitly editable and explicitly not derived. Both are the column
    // defaults; stating them here means a future default change cannot quietly
    // turn a user-created row into something the UI treats as computed.
    editable: true,
    auto_source: null,
  });

  if (error) return { ok: false, error: explain(error.message) };

  revalidatePath('/', 'layout');
  return { ok: true, saved: 1 };
}

/**
 * Deletes an editable category.
 *
 * Refuses auto rows for the same reason `saveBudget` skips them: deleting one
 * would not remove the underlying debts or school fees, so the figure would
 * simply reappear on the next derivation, minus whatever the user believed they
 * had done.
 */
export async function deleteCategory(_prev: BudgetResult, form: FormData): Promise<BudgetResult> {
  const c = await client();
  if ('error' in c) return { ok: false, error: c.error };
  const { supabase } = c;

  const id = s(form, 'id');
  if (!id) return { ok: false, error: 'Nothing to delete.' };

  const { data: row, error: readError } = await supabase
    .from('budget_categories')
    .select('id, auto_source')
    .eq('id', id)
    .maybeSingle();

  if (readError) return { ok: false, error: explain(readError.message) };
  if (!row) return { ok: false, error: 'That category no longer exists. Reload the page.' };
  if (row.auto_source) {
    return {
      ok: false,
      error:
        'That row is computed from your loans or school fees — deleting it here would not remove them, and it would come back on the next recalculation. Remove the underlying entries instead.',
    };
  }

  const { error } = await supabase.from('budget_categories').delete().eq('id', id);
  if (error) return { ok: false, error: explain(error.message) };

  revalidatePath('/', 'layout');
  return { ok: true, saved: 1 };
}
