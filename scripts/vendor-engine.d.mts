/**
 * Types for `vendor-engine.mjs`.
 *
 * The script is plain `.mjs` because `node scripts/vendor-engine.mjs` has to
 * run without a build step — it is the thing that runs *before* everything
 * else. `allowJs` is off, so its test cannot import it untyped; this declares
 * the surface instead of turning `allowJs` on for the whole project.
 */

/** `lib/engine`. */
export const SOURCE_DIR: string;

/** `supabase/functions/send-reminders/_engine`. */
export const VENDOR_DIR: string;

/** The modules copied, in dependency order. */
export const VENDORED: string[];

/** Rewrites a source module for Deno. See the script for what and why. */
export function vendorSource(source: string): string;
