'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const PASSWORD_MIN_LENGTH = 8;

function credentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  };
}

/** Authenticate entirely on the server so supabase-js never enters the page bundle. */
export async function signIn(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect('/sign-in?error=unavailable');

  const { email, password } = credentials(formData);
  if (!email || !password) redirect('/sign-in?error=invalid');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/sign-in?error=invalid');

  revalidatePath('/', 'layout');
  redirect('/');
}

/** Create an account and require an immediate session: confirmation email must be disabled. */
export async function signUp(formData: FormData) {
  const supabase = await createClient();
  if (!supabase) redirect('/sign-up?error=unavailable');

  const { email, password } = credentials(formData);
  const confirmation = String(formData.get('passwordConfirmation') ?? '');
  if (!email || password.length < PASSWORD_MIN_LENGTH) redirect('/sign-up?error=invalid');
  if (password !== confirmation) redirect('/sign-up?error=mismatch');

  const { data, error } = await supabase.auth.signUp({ email, password });
  const alreadyExists =
    error?.code === 'user_already_exists' ||
    /already (?:been )?registered|already exists/i.test(error?.message ?? '') ||
    (data.user?.identities?.length === 0);
  if (alreadyExists) redirect('/sign-up?error=exists');
  if (error) redirect('/sign-up?error=failed');
  if (!data.session) redirect('/sign-up?error=confirmation');

  revalidatePath('/', 'layout');
  redirect('/');
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
