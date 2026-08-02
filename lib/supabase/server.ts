import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from './config';

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Returns `null` when Supabase is not configured rather than throwing, so an
 * unconfigured deployment renders the seeded dataset instead of erroring. Every
 * caller must handle null — which is the point: it makes "no backend" a state
 * the code has to acknowledge rather than a crash.
 */
export async function createClient() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. The middleware refreshes the
          // session instead, so this is expected rather than an error.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * Uses `getUser()` rather than `getSession()` deliberately: getSession reads
 * the cookie and trusts it, while getUser revalidates against the auth server.
 * For a screen that decides whose financial data to show, that difference
 * matters.
 *
 * Wrapped in React's `cache()` because that revalidation is a network round
 * trip to `/auth/v1/user`, and more than one caller wants the answer during a
 * single render — `getReadModel` needs it to decide between live and seeded
 * figures, and the page itself needs it to decide what to draw. Uncached, a
 * page view spent two or three sequential auth requests answering the same
 * question. `cache()` scopes the result to one request, so it stays as fresh as
 * before and costs one call.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
});
