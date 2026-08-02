/**
 * Supabase connection details, in one place.
 *
 * Both values are public by design: the publishable key is meant for the
 * browser, and row-level security — enabled *and forced* on all 13 tables — is
 * what actually protects the data. The key is not a secret; the policies are
 * the boundary.
 *
 * That is asserted rather than assumed. Querying the live project as the `anon`
 * role returns zero rows from every table, and an `anon` insert fails the
 * WITH CHECK clause, because all four policies on all thirteen tables are
 * keyed to `(select auth.uid()) = user_id` and an anonymous request has no
 * uid. The key below buys an attacker exactly what loading the page in a
 * browser already would: the ability to ask, and be told nothing.
 *
 * The real secret is SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. It is not
 * here, is not in the repo, and must never be in either.
 *
 * The app must render with neither of these reachable. That is not a
 * convenience: the whole e2e suite runs unconfigured, against the §11 seed, and
 * a missing environment variable should degrade to "you cannot sign in" rather
 * than crash a screen showing someone their termination deadlines.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** True once both values are present. Checked before every client is built. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}
