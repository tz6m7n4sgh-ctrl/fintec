'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { parsePrefs, type NotificationPrefs } from '@/lib/settings/notifications';

/**
 * Saving notification preferences (US-44 / FR-I2).
 *
 * One row per user, enforced by `notification_prefs_one_per_user`, so this is
 * an upsert on `user_id` rather than a read-then-insert-or-update. The latter
 * has a race the constraint would turn into a duplicate-key error on the second
 * of two tabs — a message about a unique index, shown to somebody ticking a
 * checkbox.
 */

export interface PrefsResult {
  ok: boolean;
  error?: string;
  saved?: NotificationPrefs;
}

export const PREFS_INITIAL: PrefsResult = { ok: false };

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to change your reminders.';

export async function saveNotificationPrefs(
  _prev: PrefsResult,
  form: FormData,
): Promise<PrefsResult> {
  const parsed = parsePrefs({ leadDays: form.getAll('leadDays').map(String) });

  // Validated before authenticating is the wrong order elsewhere in this app;
  // here it is deliberate and harmless — the rejection reveals nothing but the
  // shape of a form the caller already submitted.
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: SIGNED_OUT };

  /*
   * Push is read back and written unchanged.
   *
   * An upsert replaces the whole conflicting row, so omitting these two would
   * silently turn push off for anyone who saved a lead-time change — the
   * subscription would survive in the browser while the database forgot it, and
   * the app would show push as off on a device still holding a live
   * subscription. This form owns lead times only; `push-actions.ts` owns push.
   */
  const { data: existing } = await supabase
    .from('notification_prefs')
    .select('push_enabled, push_subscription')
    .maybeSingle();

  const { error } = await supabase
    .from('notification_prefs')
    .upsert(
      {
        user_id: user.id,
        // Written explicitly rather than omitted. Leaving it out would let the
        // column default decide on insert and leave a stale `false` in place on
        // update — and `false` here is the one value this app must never store.
        email_enabled: true,
        push_enabled: existing?.push_enabled ?? false,
        push_subscription: existing?.push_subscription ?? null,
        lead_days: parsed.prefs.leadDays,
      },
      { onConflict: 'user_id' },
    );

  if (error) {
    return { ok: false, error: `Could not save your reminder settings: ${error.message}` };
  }

  // The calendar draws its funding markers from these lead times, so a change
  // here moves what is on that screen.
  revalidatePath('/', 'layout');

  return { ok: true, saved: parsed.prefs };
}
