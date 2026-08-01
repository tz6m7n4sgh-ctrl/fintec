'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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
