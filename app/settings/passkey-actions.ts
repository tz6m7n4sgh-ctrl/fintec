'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  callPasskeyFunction,
  PASSKEYS_UNAVAILABLE,
} from '@/lib/supabase/passkey-function';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

/**
 * Adding and removing passkeys (US-40 / FR-K2 / HAD-17).
 *
 * ## Why adding goes through the Edge Function and removing does not
 *
 * They are not symmetric, and the asymmetry is the security model rather than
 * an inconsistency.
 *
 * *Adding* writes a challenge, and the challenge table has RLS enabled with no
 * policies at all — nothing but the service-role key can touch it. That is
 * deliberate: the same table serves the signed-*out* half of the ceremony,
 * where there is no `auth.uid()` for a policy to key on, so the table cannot
 * have a policy that is safe in one case and correct in the other. It has none.
 *
 * *Removing* is an ordinary delete of an ordinary row, and `passkeys` has a
 * `delete using auth.uid() = user_id` policy. Routing it through the function
 * would mean a second endpoint able to delete credentials by id, protected by
 * code, replacing one that is protected by the database. There is no version of
 * that trade worth taking.
 *
 * There is deliberately no *update* path anywhere in the app. The only mutable
 * column is `counter`, and the table has no update policy — a user who could
 * rewind their own counter could disable the clone detection on their own
 * credential.
 */

export interface RegisterBegin {
  options?: PublicKeyCredentialCreationOptionsJSON;
  error?: string;
}

export interface RegisterFinish {
  error?: string;
  /** The name the new passkey will appear under, e.g. "This device". */
  label?: string;
}

/**
 * The access token for the signed-in user, or null.
 *
 * The Edge Function resolves the user from this and takes the user id from
 * nowhere else, so this is how "who is registering" travels — there is no field
 * in the request that names an account.
 */
async function accessToken(): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  /*
   * `getSession()` rather than `getUser()`, because the token itself is what is
   * needed and `getUser` does not return one. The usual objection — that
   * getSession trusts the cookie — does not apply: the function this token is
   * sent to validates it against the auth server before doing anything, so a
   * forged cookie buys a 401 there rather than a registration here.
   */
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Step 1: options and a challenge for creating a passkey. */
export async function beginPasskeyRegistration(): Promise<RegisterBegin> {
  const token = await accessToken();
  if (!token) return { error: 'Sign in before adding a passkey.' };

  const reply = await callPasskeyFunction<{ options: PublicKeyCredentialCreationOptionsJSON }>({
    step: 'register-options',
    accessToken: token,
  });

  if (!reply.ok || !reply.data?.options) {
    return { error: reply.error ?? PASSKEYS_UNAVAILABLE };
  }
  return { options: reply.data.options };
}

/** Step 3: verify the attestation and store the credential. */
export async function finishPasskeyRegistration(
  challenge: string,
  response: unknown,
): Promise<RegisterFinish> {
  const token = await accessToken();
  if (!token) return { error: 'Sign in before adding a passkey.' };

  const reply = await callPasskeyFunction<{ label: string }>({
    step: 'register-verify',
    challenge,
    response,
    accessToken: token,
  });

  if (!reply.ok) return { error: reply.error ?? 'That passkey could not be saved.' };

  revalidatePath('/settings');
  return { label: reply.data?.label ?? 'Passkey' };
}

export interface RemoveResult {
  error?: string;
}

/**
 * Removes one passkey.
 *
 * No `.eq('user_id', …)`. The delete policy is the boundary, and adding a
 * redundant filter here would mean a broken policy still looked like it worked
 * — the test would pass against application code rather than against the thing
 * that actually protects the row.
 */
export async function removePasskey(id: string): Promise<RemoveResult> {
  const supabase = await createClient();
  if (!supabase) return { error: PASSKEYS_UNAVAILABLE };

  const { error } = await supabase.from('passkeys').delete().eq('id', id);
  if (error) return { error: 'That passkey could not be removed.' };

  revalidatePath('/settings');
  return {};
}
