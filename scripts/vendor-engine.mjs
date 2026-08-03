#!/usr/bin/env node
/**
 * Copies shared modules into the Edge Functions, for Deno.
 *
 * ## Why a copy exists at all
 *
 * The functions under `supabase/functions/` run on Deno inside Supabase. They
 * cannot reach `lib/` — a deployed function is its own bundle — and they need
 * the exact same answers the app gives:
 *
 *   - `send-reminders` must compute the schedule the screen shows. A reminder
 *     job that disagrees with the screen listing the reminders is this
 *     project's signature defect with the stakes turned up.
 *   - `passkeys` must run the same WebAuthn ceremony the tests exercise. A
 *     verifier that drifts from its tests does not fail loudly; it accepts
 *     something it should have refused.
 *
 * ## Why it is generated rather than written
 *
 * The alternative is a second hand-written implementation in Deno, which would
 * drift the first time either side changed, and drift silently — both would
 * keep producing plausible output. So this copies the real modules and changes
 * only what Deno's resolver requires.
 *
 * `vendor-engine.test.ts` re-runs this transform in memory and fails if a
 * checked-in copy differs, so no copy can go stale without CI saying so.
 *
 * Run with: node scripts/vendor-engine.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * npm packages a vendored module may import, pinned to the version that is
 * actually installed here rather than to the range in `package.json`.
 *
 * The range is the wrong thing to pin to: `^13.3.2` lets Deno fetch a version
 * Node never ran, so the WebAuthn verifier in production could differ from the
 * one the tests passed against — the exact drift this script exists to stop.
 * Reading the lockfile means a dependency bump changes the generated copy, and
 * the drift test then insists on a re-vendor before it can merge.
 */
function resolvedVersion(pkg) {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  const entry = lock.packages?.[`node_modules/${pkg}`];
  if (!entry?.version) throw new Error(`${pkg} is not in package-lock.json`);
  return entry.version;
}

/** Bare specifiers that survive into a vendored module, and their Deno form. */
export function npmSpecifiers() {
  return {
    '@simplewebauthn/server': `npm:@simplewebauthn/server@${resolvedVersion('@simplewebauthn/server')}`,
  };
}

/**
 * What gets copied where.
 *
 * Each `files` list is hand-maintained and the test walks the imports rather
 * than trusting it — a module added to the chain and forgotten here would still
 * deploy, and fail at runtime where nobody is watching.
 */
export const BUNDLES = [
  {
    sourceDir: 'lib/engine',
    vendorDir: 'supabase/functions/send-reminders/_engine',
    files: ['types.ts', 'dates.ts', 'schedule.ts', 'settle.ts', 'reminders.ts'],
  },
  {
    sourceDir: 'lib/auth',
    vendorDir: 'supabase/functions/passkeys/_shared',
    files: ['passkeys.ts'],
  },
];

const banner = (sourceDir) => `// GENERATED FILE — do not edit.
//
// Copied from ${sourceDir}/ by scripts/vendor-engine.mjs so the deployed
// function behaves exactly as the app and its tests do. Edit the source and
// re-run the script; vendor-engine.test.ts fails if this copy is out of date.
`;

/**
 * The transforms.
 *
 * **Relative imports.** Deno resolves them literally, so `from './dates'` is a
 * 404 there and `from './dates.ts'` is correct. TypeScript's bundler resolution
 * does not write the extension, so this adds it.
 *
 * **npm imports.** Deno needs the `npm:` prefix and an explicit version. See
 * `npmSpecifiers` for why the version comes from the lockfile.
 *
 * **The one path alias.** `settle.ts`'s only non-relative import is `import
 * type { Transaction } from '@/lib/data/seed'`. It is type-only, so it erases
 * at compile time and Deno never fetches it — but Deno still parses the
 * specifier, so it is rewritten to a local declaration rather than left to
 * resolve against an alias that does not exist outside Next.
 *
 * Nothing else about these modules changes, which is the point, and what makes
 * the drift test a byte comparison rather than a judgement call.
 */
export function vendorSource(source, sourceDir) {
  let out = source.replace(
    /from '(\.\.?\/[^']+?)'/g,
    (match, spec) => (spec.endsWith('.ts') ? match : `from '${spec}.ts'`),
  );

  for (const [bare, deno] of Object.entries(npmSpecifiers())) {
    out = out.replaceAll(`from '${bare}'`, `from '${deno}'`);
  }

  out = out.replace(
    /import type \{ Transaction \} from '@\/lib\/data\/seed';/,
    `// Vendored: the alias '@/lib/data/seed' does not exist outside Next, and
// only this row's shape is used. Kept structural so a change to the real type
// that this module depends on still fails the typecheck at source.
type Transaction = { reviewStatus: 'pending' | 'confirmed' | 'edited' };`,
  );

  return banner(sourceDir) + out;
}

function main() {
  let count = 0;
  for (const bundle of BUNDLES) {
    mkdirSync(join(ROOT, bundle.vendorDir), { recursive: true });
    for (const file of bundle.files) {
      const source = readFileSync(join(ROOT, bundle.sourceDir, file), 'utf8');
      writeFileSync(join(ROOT, bundle.vendorDir, file), vendorSource(source, bundle.sourceDir));
      console.log(`  ${bundle.sourceDir}/${file} -> ${bundle.vendorDir}/${file}`);
      count += 1;
    }
  }
  console.log(`\n  Vendored ${count} modules.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
