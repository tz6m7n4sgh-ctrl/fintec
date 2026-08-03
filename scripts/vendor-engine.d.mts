/**
 * Types for `vendor-engine.mjs`.
 *
 * The script is plain `.mjs` because `node scripts/vendor-engine.mjs` has to
 * run without a build step — it is the thing that runs *before* everything
 * else. `allowJs` is off, so its test cannot import it untyped; this declares
 * the surface instead of turning `allowJs` on for the whole project.
 */

export interface VendorBundle {
  /** Where the real modules live, e.g. `lib/engine`. */
  sourceDir: string;
  /** Where the Deno copies go, e.g. `supabase/functions/send-reminders/_engine`. */
  vendorDir: string;
  /** The modules copied, in dependency order. */
  files: string[];
}

/** Every source-to-function copy this repository maintains. */
export const BUNDLES: VendorBundle[];

/** Bare npm specifiers a vendored module may import, mapped to their Deno form. */
export function npmSpecifiers(): Record<string, string>;

/** Rewrites a source module for Deno. See the script for what and why. */
export function vendorSource(source: string, sourceDir: string): string;
