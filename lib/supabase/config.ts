/**
 * Supabase connection details, in one place.
 *
 * Both values are public by design, but they still identify a real backend.
 * Committing them would make every fork and preview deployment share that
 * backend. Deployments therefore have to opt in by setting both variables.
 *
 * The app deliberately supports the unconfigured state: it renders the
 * reference dataset and disables account actions rather than failing to boot.
 * The service-role key is different: it bypasses RLS, is server-only, and must
 * never be added here.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

/** True only when this deployment explicitly supplies both values. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Identifies the configured project without exposing the key. Keeping this
 * answer beside `isSupabaseConfigured` prevents the UI and client factories
 * from developing different definitions of configuration again (HAD-75).
 */
export function supabaseProjectHost(): string | null {
  if (!isSupabaseConfigured()) return null;

  try {
    return new URL(SUPABASE_URL).host;
  } catch {
    return SUPABASE_URL;
  }
}
