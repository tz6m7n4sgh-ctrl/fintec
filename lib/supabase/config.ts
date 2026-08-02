/**
 * Supabase connection details, in one place.
 *
 * Both values are public by design: the publishable key is meant for the
 * browser, and row-level security — enabled *and forced* on all 13 tables — is
 * what actually protects the data. The key is not a secret; the policies are
 * the boundary.
 *
 * The app must render without either of these set. That is not a convenience:
 * the whole e2e suite runs unconfigured, against the §11 seed, and a missing
 * environment variable should degrade to "you cannot sign in" rather than
 * crash a screen showing someone their termination deadlines.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/** True once both values are present. Checked before every client is built. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}
