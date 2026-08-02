'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { normaliseEmail, validateSignIn, validateSignUp } from '@/lib/auth/credentials';

/**
 * Sign in, sign up and sign out (US-39 / FR-K1).
 *
 * All three are server actions, and that is the design rather than a detail.
 * The previous flow verified a one-time code in the browser, which meant the
 * Supabase client had to be in the client bundle — 67 kB on /sign-in, the
 * heaviest route in the app and the first one a new user sees. Nothing here
 * runs in the browser now, so the sign-in screen ships the same near-zero
 * JavaScript as every other screen, and the session cookie is written onto the
 * response the browser is already receiving rather than by a script afterwards.
 *
 * There is no email in any of this. No one-time code, no magic link, no
 * confirmation, no reset. That removes a class of failure that could not be
 * fixed from application code — Supabase decides between a code and a link by
 * reading the *email template*, clickable links depend on an allowed-redirect
 * list that defaults to localhost, and the built-in SMTP is rate-limited and
 * not meant for production. A password depends on none of it.
 *
 * The cost is stated rather than hidden: with no mailbox in the loop there is
 * no password reset. A forgotten password has to be cleared from the Supabase
 * dashboard. The screens say so before anyone chooses a password.
 */

export interface AuthResult {
  error?: string;
  /**
   * The address that was submitted, echoed back so the form can refill it.
   *
   * React 19 resets an uncontrolled form once its action settles, so without
   * this the email box empties on every rejection — and the rejection most
   * likely to repeat is a mistyped password, which punishes the user in a field
   * they got right. The form sets it as `defaultValue`, which is what a reset
   * restores to.
   *
   * The password is deliberately NOT echoed. Putting it back into component
   * state and into the DOM as an attribute is a worse trade than retyping it.
   */
  email?: string;
}

/** Nothing to sign in to. The pages render this state too, but the actions must
 *  refuse independently — a form can be submitted without the page agreeing. */
const NOT_CONFIGURED =
  'This deployment has no Supabase project configured, so there is nothing to sign in to.';

/**
 * One project setting stands between this flow and the email it is meant to
 * avoid. With **Confirm email** on, `signUp` mails a confirmation link and
 * returns no session — the exact behaviour this replaced. That state is
 * detectable, so it is named rather than left as a form that appears to do
 * nothing.
 */
const CONFIRMATION_STILL_ON =
  'Your account was created, but the Supabase project still has email confirmation switched on, so it cannot sign you in until an emailed link is clicked. Turn off Authentication → Providers → Email → "Confirm email" in the Supabase dashboard, then sign in.';

/**
 * Turns an auth-server message into something a person can act on.
 *
 * Only where the original is genuinely unhelpful. Supabase's other messages —
 * "Signups not allowed for this instance", "Password should be at least …" —
 * already say what is wrong and what to change, and replacing them with
 * something generic would throw that away.
 */
function explain(message: string): string {
  const m = message.toLowerCase();

  /*
   * Deliberately does not say which half was wrong. "No account with that
   * address" would let anyone test addresses against this app one at a time,
   * and it helps a real user not at all — they retype both either way.
   */
  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match an account. If you have not signed up yet, create an account instead.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account was created while email confirmation was switched on, so it is still waiting on a link. Turn off Authentication → Providers → Email → "Confirm email" in Supabase, then confirm this user under Authentication → Users.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'An account already exists for that email. Sign in instead.';
  }
  if (m.includes('email logins are disabled') || m.includes('signups not allowed')) {
    return `${message} Enable the Email provider under Authentication → Providers in the Supabase dashboard.`;
  }
  return message;
}

/** Signs an existing user in. */
export async function signIn(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const email = normaliseEmail(String(form.get('email') ?? ''));
  const password = String(form.get('password') ?? '');
  // Every failure carries the address back to the form. One helper so a new
  // early return cannot quietly forget to.
  const fail = (error: string): AuthResult => ({ error, email });

  const invalid = validateSignIn(email, password);
  if (invalid) return fail(invalid);

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return fail(explain(error.message));

  // The layout, the shell and every server-rendered screen read the session, so
  // the whole tree is stale the moment this succeeds.
  revalidatePath('/', 'layout');
  // Outside any try/catch on purpose — redirect() signals by throwing, and
  // catching that would turn a successful sign-in into a silent no-op.
  redirect('/');
}

/**
 * Creates an account and signs straight into it.
 *
 * There is no verification step because there is nothing to verify against: the
 * address is never used to send anything. It is the account's name and the way
 * to sign back in, and that is all it needs to be.
 */
export async function signUp(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const email = normaliseEmail(String(form.get('email') ?? ''));
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');
  const fail = (error: string): AuthResult => ({ error, email });

  const invalid = validateSignUp(email, password, confirm);
  if (invalid) return fail(invalid);

  const supabase = await createClient();
  if (!supabase) return fail(NOT_CONFIGURED);

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return fail(explain(error.message));

  /*
   * With confirmations on, Supabase does not reject a duplicate sign-up — it
   * returns a plausible-looking user with an empty `identities` array, so that
   * an attacker cannot enumerate addresses. Reading that array is the only way
   * to tell the case apart, and "already registered" is the right answer for
   * the person actually sitting there.
   */
  if (data.user && data.user.identities?.length === 0) {
    return fail('An account already exists for that email. Sign in instead.');
  }

  // No session means the project is still gating on a confirmation email.
  if (!data.session) return fail(CONFIRMATION_STILL_ON);

  revalidatePath('/', 'layout');
  // A new account has no figures in it, and every screen is computed from the
  // profile — so the only useful next screen is the one that fills it in.
  redirect('/profile');
}

/**
 * Sign out (part of FR-K3).
 *
 * A server action rather than a client call so the session cookie is cleared on
 * the response the browser is already receiving — no window where the UI says
 * signed out while the cookie still works.
 *
 * `scope: 'global'` revokes every refresh token for the user, which is the
 * "sign out everywhere" half of US-41. The idle auto-lock half is separate and
 * still unbuilt.
 */
export async function signOut() {
  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut({ scope: 'global' });

  revalidatePath('/', 'layout');
  redirect('/');
}
