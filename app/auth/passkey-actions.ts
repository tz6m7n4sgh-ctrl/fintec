'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  callPasskeyFunction,
  PASSKEYS_UNAVAILABLE,
} from '@/lib/supabase/passkey-function';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

/**
 * Signing in with a passkey (US-40 / FR-K2).
 *
 * ## The split, and why it is where it is
 *
 * Three things happen and only one of them can happen in the browser:
 *
 *   1. **Ask for a challenge.** Server action → Edge Function. The challenge is
 *      stored server-side; what comes back here is the public half.
 *   2. **Sign it.** Only the browser can do this — `navigator.credentials.get`
 *      talks to hardware this process cannot reach.
 *   3. **Verify it and start the session.** Server action → Edge Function,
 *      which checks the signature and returns tokens. Those tokens are written
 *      straight into the session cookie here and are never returned to the
 *      page, so the session never exists in client JavaScript.
 *
 * ## Why the challenge makes the round trip
 *
 * `finishPasskeySignIn` takes the challenge back from the browser, which looks
 * like trusting the client with a security parameter. It is not: the challenge
 * is a *lookup key*, and the row it finds is deleted in the same statement that
 * reads it. A caller who sends a challenge that was never issued finds nothing;
 * one who sends a challenge that was already spent finds nothing; one who sends
 * somebody else's finds a row whose signature they cannot produce. Keeping it
 * in a cookie instead would add a second piece of state to keep in step with
 * the row that already exists.
 */

export interface PasskeyBegin {
  options?: PublicKeyCredentialRequestOptionsJSON;
  error?: string;
}

export interface PasskeyFinish {
  error?: string;
  /** Set when the session is live. The client navigates; it is not given tokens. */
  ok?: boolean;
}

/** Step 1: a challenge to sign. */
export async function beginPasskeySignIn(): Promise<PasskeyBegin> {
  const reply = await callPasskeyFunction<{ options: PublicKeyCredentialRequestOptionsJSON }>({
    step: 'signin-options',
  });

  if (!reply.ok || !reply.data?.options) {
    return { error: reply.error ?? PASSKEYS_UNAVAILABLE };
  }
  return { options: reply.data.options };
}

/** Step 3: verify what the authenticator signed, and become signed in. */
export async function finishPasskeySignIn(
  challenge: string,
  response: unknown,
): Promise<PasskeyFinish> {
  const supabase = await createClient();
  if (!supabase) return { error: PASSKEYS_UNAVAILABLE };

  const reply = await callPasskeyFunction<{ accessToken: string; refreshToken: string }>({
    step: 'signin-verify',
    challenge,
    response,
  });

  if (!reply.ok || !reply.data) {
    return { error: reply.error ?? 'That passkey could not be verified.' };
  }

  /*
   * `setSession` writes the cookie through the same SSR client every other
   * screen reads, so nothing downstream has to know this session arrived by a
   * different route than a password one. It also revalidates the tokens against
   * the auth server, which means a reply this action could not have produced
   * still cannot become a session.
   */
  const { error } = await supabase.auth.setSession({
    access_token: reply.data.accessToken,
    refresh_token: reply.data.refreshToken,
  });

  if (error) return { error: 'That passkey could not be verified.' };

  // Every server-rendered screen reads the session, so the whole tree is stale.
  revalidatePath('/', 'layout');
  /*
   * No `redirect()` here, unlike the password action. This runs from an
   * `onClick` rather than a form action, and a redirect thrown out of a plain
   * function call surfaces to the caller as an unhandled error instead of a
   * navigation. The client navigates on `ok` instead.
   */
  return { ok: true };
}
