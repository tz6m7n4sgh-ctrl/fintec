#!/usr/bin/env node
/**
 * Copies the reminder engine into the Edge Function, for Deno.
 *
 * ## Why a copy exists at all
 *
 * `supabase/functions/send-reminders` runs on Deno inside Supabase. It cannot
 * reach `lib/engine/` — a deployed function is its own bundle — and it needs
 * the exact same answer the app gives, because the two are showing the user the
 * same reminders. A reminder job that disagrees with the screen listing the
 * reminders is this project's signature defect with the stakes turned up.
 *
 * ## Why it is generated rather than written
 *
 * The alternative is a second hand-written implementation in Deno, which would
 * drift the first time either side changed, and drift silently — both would
 * keep producing plausible schedules. So this copies the real modules and
 * changes exactly one thing: Deno requires explicit `.ts` extensions on
 * relative imports, which TypeScript's bundler resolution does not write.
 *
 * `vendor-engine.test.ts` re-runs this transform in memory and fails if the
 * checked-in copy differs, so the copy cannot go stale without CI saying so.
 *
 * Run with: node scripts/vendor-engine.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SOURCE_DIR = 'lib/engine';
export const VENDOR_DIR = 'supabase/functions/send-reminders/_engine';

/**
 * The closed set `reminders.ts` needs. Verified closed by the test, which walks
 * the imports rather than trusting this list — a module added to the chain and
 * forgotten here would fail to deploy, but only at deploy time.
 */
export const VENDORED = ['types.ts', 'dates.ts', 'schedule.ts', 'settle.ts', 'reminders.ts'];

const BANNER = `// GENERATED FILE — do not edit.
//
// Copied from ${SOURCE_DIR}/ by scripts/vendor-engine.mjs so the reminder job
// computes exactly what the app shows. Edit the source and re-run the script;
// vendor-engine.test.ts fails if this copy is out of date.
`;

/**
 * The one transform.
 *
 * Deno resolves relative imports literally, so `from './dates'` is a 404 there
 * and `from './dates.ts'` is correct. Nothing else about these modules changes
 * — which is the point, and what makes the drift test a byte comparison rather
 * than a judgement call.
 *
 * `settle.ts`'s only non-relative import is `import type { Transaction } from
 * '@/lib/data/seed'`. It is type-only, so it erases at compile time and Deno
 * never fetches it — but Deno still parses the specifier, so it is rewritten to
 * a local declaration rather than left to resolve against an alias that does
 * not exist outside Next.
 */
export function vendorSource(source) {
  let out = source.replace(
    /from '(\.\.?\/[^']+?)'/g,
    (match, spec) => (spec.endsWith('.ts') ? match : `from '${spec}.ts'`),
  );

  out = out.replace(
    /import type \{ Transaction \} from '@\/lib\/data\/seed';/,
    `// Vendored: the alias '@/lib/data/seed' does not exist outside Next, and
// only this row's shape is used. Kept structural so a change to the real type
// that this module depends on still fails the typecheck at source.
type Transaction = { reviewStatus: 'pending' | 'confirmed' | 'edited' };`,
  );

  return BANNER + out;
}

function main() {
  mkdirSync(join(ROOT, VENDOR_DIR), { recursive: true });
  for (const file of VENDORED) {
    const source = readFileSync(join(ROOT, SOURCE_DIR, file), 'utf8');
    writeFileSync(join(ROOT, VENDOR_DIR, file), vendorSource(source));
    console.log(`  ${SOURCE_DIR}/${file} -> ${VENDOR_DIR}/${file}`);
  }
  console.log(`\n  Vendored ${VENDORED.length} modules.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
