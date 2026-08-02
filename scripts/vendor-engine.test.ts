import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOURCE_DIR, VENDOR_DIR, VENDORED, vendorSource } from './vendor-engine.mjs';

/**
 * The reminder job and the reminder screen must never disagree.
 *
 * `supabase/functions/send-reminders` runs on Deno and cannot import from
 * `lib/engine/`, so it carries a generated copy. A copy is only safe while
 * something proves it is current — otherwise the app shows one schedule, the
 * job sends another, and both look right.
 *
 * This is that proof. It re-runs the transform in memory and compares bytes.
 */

const read = (path: string) => readFileSync(path, 'utf8');

describe('the vendored engine is current', () => {
  for (const file of VENDORED) {
    it(`${file} matches ${SOURCE_DIR}/${file}`, () => {
      const expected = vendorSource(read(`${SOURCE_DIR}/${file}`));
      const actual = read(`${VENDOR_DIR}/${file}`);
      expect(
        actual,
        `Out of date. Run: node scripts/vendor-engine.mjs`,
      ).toBe(expected);
    });
  }
});

describe('the vendored set is closed', () => {
  it('imports nothing it does not carry', () => {
    /*
     * The list in the script is hand-maintained, and a module added to the
     * chain and forgotten there would still deploy — Deno would fail at
     * *runtime*, on the daily job, where nobody is watching. So the imports are
     * walked rather than trusted.
     */
    const carried = new Set(VENDORED);
    const missing: string[] = [];

    for (const file of VENDORED) {
      const source = read(`${VENDOR_DIR}/${file}`);
      for (const match of source.matchAll(/from '(\.\/[^']+)'/g)) {
        const target = match[1].replace('./', '');
        if (!carried.has(target)) missing.push(`${file} -> ${target}`);
      }
    }

    expect(missing, 'add these to VENDORED in scripts/vendor-engine.mjs').toEqual([]);
  });

  it('leaves no path alias Deno cannot resolve', () => {
    // `@/…` is a Next tsconfig alias. Deno has never heard of it, and an import
    // that survives here is a function that fails to boot.
    for (const file of VENDORED) {
      expect(read(`${VENDOR_DIR}/${file}`), `${file} still has an @/ import`).not.toMatch(
        /from '@\//,
      );
    }
  });

  it('gives every relative import the extension Deno requires', () => {
    for (const file of VENDORED) {
      for (const match of read(`${VENDOR_DIR}/${file}`).matchAll(/from '(\.\.?\/[^']+)'/g)) {
        expect(match[1], `${file} imports ${match[1]} without .ts`).toMatch(/\.ts$/);
      }
    }
  });

  it('marks every copy as generated, so nobody edits the wrong one', () => {
    for (const file of VENDORED) {
      expect(read(`${VENDOR_DIR}/${file}`)).toContain('GENERATED FILE — do not edit');
    }
  });
});
