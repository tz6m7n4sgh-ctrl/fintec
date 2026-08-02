'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { StoredSubscription } from '@/lib/settings/push';

/**
 * Storing a web-push subscription (US-47 / US-44).
 *
 * One row per user (`notification_prefs_one_per_user`), so this upserts on
 * `user_id` — the read-then-insert-or-update alternative races two tabs into a
 * duplicate-key error, which would surface to somebody tapping "Enable push" as
 * a message about a unique index.
 */

export interface PushResult {
  ok: boolean;
  error?: string;
  enabled?: boolean;
}

export const PUSH_INITIAL: PushResult = { ok: false };

const SIGNED_OUT = 'You are signed out. Sign in again to change push notifications.';

export async function savePushSubscription(
  subscription: StoredSubscription | null,
): Promise<PushResult> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: 'Supabase is not configured for this deployment.' };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: SIGNED_OUT };

  /*
   * `push_enabled` is derived from whether a subscription exists, not stored
   * independently. Two fields would let them disagree, and the disagreement
   * would be the bad kind: `push_enabled = true` with no subscription is an app
   * that believes it can reach someone it cannot — on the channel that warns
   * about bounced cheques.
   */
  const { error } = await supabase.from('notification_prefs').upsert(
    {
      user_id: user.id,
      email_enabled: true,
      push_enabled: subscription !== null,
      push_subscription: subscription,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    return { ok: false, error: `Could not save your push settings: ${error.message}` };
  }

  revalidatePath('/settings', 'page');
  return { ok: true, enabled: subscription !== null };
}
