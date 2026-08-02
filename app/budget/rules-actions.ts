'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

/**
 * Keyword categorisation rules (US-32 / FR-L5).
 *
 * These live beside the budget rather than the statements screen on purpose: a
 * rule names a **budget category**, and the list of categories to choose from
 * is here. Putting them on Statements would mean editing a rule without seeing
 * what it sorts into.
 *
 * Nothing here writes a transaction. A rule *proposes* a category on a pending
 * row and the user confirms it — so a bad rule costs a dropdown, never a
 * figure. That is also why "rules re-runnable over existing transactions"
 * needs no re-run for anything still pending: the proposal derives at render.
 */

export interface RuleResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

function s(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

async function client() {
  const supabase = await createClient();
  if (!supabase) return { ok: false as const, error: NOT_CONFIGURED };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false as const, error: SIGNED_OUT };
  return { ok: true as const, supabase, user: auth.user };
}

function explain(message: string): string {
  if (message.includes('category_rules_keyword_unique')) {
    return 'You already have a rule for that keyword. Edit the existing one rather than adding a second — two rules for one keyword would make which category wins depend on row order.';
  }
  if (message.includes('length(trim(keyword))')) {
    return 'Give the rule a keyword to match on.';
  }
  if (message.includes('violates foreign key constraint')) {
    return 'That budget category no longer exists. Reload the page and pick again.';
  }
  return message;
}

/** Creates or updates one rule. */
export async function saveRule(_prev: RuleResult, form: FormData): Promise<RuleResult> {
  const id = s(form, 'id') || undefined;
  const fail = (error: string): RuleResult => ({ ok: false, error, id });

  const c = await client();
  if (!c.ok) return fail(c.error);

  const keyword = s(form, 'keyword');
  if (!keyword) return fail('Give the rule a keyword to match on.');

  const categoryId = s(form, 'categoryId');
  if (!categoryId) return fail('Choose the budget category this keyword sorts into.');

  /*
   * Parsed rather than coerced. `Number('')` is 0, which is a *valid and
   * meaningful* priority — the highest there is — so a blank field would
   * silently create the rule that beats everything.
   */
  const rawPriority = s(form, 'priority');
  const priority = rawPriority === '' ? 100 : Number(rawPriority);
  if (!Number.isInteger(priority) || priority < 0) {
    return fail('Priority must be a whole number, 0 or more. Lower runs first.');
  }

  const row = {
    user_id: c.user.id,
    keyword,
    category_id: categoryId,
    priority,
  };

  const { error } = id
    ? await c.supabase.from('category_rules').update(row).eq('id', id)
    : await c.supabase.from('category_rules').insert(row);

  if (error) return fail(explain(error.message));

  // Every pending row's suggested category derives from these.
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Deletes one rule. */
export async function deleteRule(_prev: RuleResult, form: FormData): Promise<RuleResult> {
  const id = s(form, 'id');
  const fail = (error: string): RuleResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to delete.');

  const c = await client();
  if (!c.ok) return fail(c.error);

  const { error } = await c.supabase.from('category_rules').delete().eq('id', id);
  if (error) return fail(explain(error.message));

  revalidatePath('/', 'layout');
  return { ok: true };
}
