'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { SEED_CHECKLIST } from '@/lib/data/seed';

/**
 * Ticking off the §8 action plan (HAD-85 / FR-J1).
 *
 * `checklist_items` was read, rendered and written by nothing — so the plan
 * showed the seed's `done` state permanently and no item could be ticked. On a
 * screen whose purpose is "here is what you must not miss", a checklist nobody
 * can check is one they track somewhere else.
 *
 * ## Only the boolean is stored
 *
 * The item text is the §8 plan — legal and procedural steps, not user content.
 * A per-user copy frozen at sign-in would keep showing 2026's wording about the
 * ILOE deadline long after a correction, on the screen that exists to stop
 * someone missing a statutory deadline. So the list travels with the app and
 * only `done` is per-user, keyed by `seed_key`.
 *
 * This deliberately does **not** touch the readiness score. The Plan screen
 * says "Completing the checklist below does not inflate the score", and that is
 * true — `scoreReadiness()` never reads `done`, verified rather than assumed.
 * A checklist that moved the score would reward ticking rather than doing.
 */

export interface ChecklistResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to save.';

/** The item ids the §8 plan defines. Anything else is not a checklist item. */
const KNOWN = new Set(SEED_CHECKLIST.map((i) => i.id));

export async function setChecklistDone(
  _prev: ChecklistResult,
  form: FormData,
): Promise<ChecklistResult> {
  const id = String(form.get('id') ?? '').trim();
  const fail = (error: string): ChecklistResult => ({ ok: false, error, id });
  if (!id) return fail('Nothing to update.');

  /*
   * Checked against the plan rather than trusted. `seed_key` is free text as
   * far as the database is concerned, so without this a crafted form could
   * write rows for items that do not exist — invisible clutter that would
   * survive every future version of the plan.
   */
  if (!KNOWN.has(id)) return fail('That is not a checklist item. Reload the page.');

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return fail(SIGNED_OUT);

  const done = form.get('done') === 'on';

  /*
   * Upsert on (user_id, seed_key), which the unique index backs. A plain insert
   * would fail the second time an item is toggled, and a plain update would do
   * nothing the first time — the row does not exist until something is ticked.
   */
  const { error } = await supabase
    .from('checklist_items')
    .upsert(
      { user_id: auth.user.id, seed_key: id, done },
      { onConflict: 'user_id,seed_key' },
    );

  if (error) return fail(error.message);

  revalidatePath('/plan');
  return { ok: true, id };
}
