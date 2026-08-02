'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { validatePasswordChange } from '@/lib/auth/credentials';

/**
 * Changing a password from inside the app (HAD-74 / FR-K1 / FR-K3).
 *
 * The missing half of a no-email auth flow. Sign-in is email and password with
 * nothing emailed, which also means no reset link — so until now a password
 * could only be changed from the Supabase dashboard, which is not a control the
 * person using the app has.
 *
 * ## Re-authentication is the point, not a formality
 *
 * `supabase.auth.updateUser({ password })` does **not** ask for the current
 * one. It trusts the session. So a change-password form built on it alone turns
 * any unattended open session into a permanent lockout: someone borrows the
 * laptop, sets a password of their choosing, and the owner — who has no reset
 * email, by design — cannot get back in.
 *
 * Re-authenticating first closes that. `signInWithPassword` against the current
 * password is the check, and it fails cleanly if the password is wrong.
 *
 * ## What this deliberately does not do
 *
 * Recover a *forgotten* password. Changing one requires knowing it. Recovery
 * with no email path needs either a reset email — the one exception worth
 * reconsidering — or a second factor such as a passkey (US-40). Both are
 * separate decisions, and the screen says so rather than implying this covers
 * it.
 */

export interface PasswordResult {
  ok: boolean;
  error?: string;
  /** True once the password has actually changed, so the UI can offer sign-out. */
  changed?: boolean;
}

export const PASSWORD_INITIAL: PasswordResult = { ok: false };

const NOT_CONFIGURED = 'Supabase is not configured for this deployment.';
const SIGNED_OUT = 'You are signed out. Sign in again to change your password.';

export async function changePassword(
  _prev: PasswordResult,
  form: FormData,
): Promise<PasswordResult> {
  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const invalid = validatePasswordChange(current, next, confirm);
  if (invalid) return { ok: false, error: invalid };

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: NOT_CONFIGURED };

  const { data: auth } = await supabase.auth.getUser();
  const email = auth?.user?.email;
  if (!email) return { ok: false, error: SIGNED_OUT };

  /*
   * The re-authentication. Deliberately re-signs in as the same user with the
   * password they typed: if it is wrong this fails, and if it is right the
   * session is simply refreshed, which is harmless.
   */
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });

  if (reauthError) {
    /*
     * Rate limiting is checked first, and separately, because it is the one
     * case where "that is not your current password" would be a lie.
     *
     * Supabase rate-limits `signInWithPassword`, and a few wrong attempts in a
     * row is exactly what someone does when they are not sure which password
     * they set. Telling them the right one is wrong — because they are
     * temporarily throttled — is how a person concludes their account is
     * broken and stops trying.
     */
    const m = reauthError.message.toLowerCase();
    if (m.includes('rate limit') || m.includes('too many') || reauthError.status === 429) {
      return {
        ok: false,
        error:
          'Too many attempts in a short time, so this one was not checked at all. Wait a minute and try again — nothing has been changed, and this is not a statement about whether the password was right.',
      };
    }

    /*
     * Not `reauthError.message`. Supabase returns "Invalid login credentials"
     * here, which on a form where the email is not even a field reads as though
     * the account is gone. The user needs to know which of the two things they
     * typed was wrong, and only one of them is a password they might have
     * mistyped.
     */
    return {
      ok: false,
      error: 'That is not your current password. Nothing has been changed.',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return { ok: false, error: `Could not change your password: ${error.message}` };
  }

  // The account card shows who is signed in, and the session cookie is new.
  revalidatePath('/', 'layout');
  return { ok: true, changed: true };
}
