import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUNDLES, npmSpecifiers, vendorSource } from './vendor-engine.mjs';

/**
 * A deployed function and the code it was copied from must never disagree.
 *
 * The Edge Functions run on Deno and cannot import from `lib/`, so each carries
 * a generated copy. A copy is only safe while something proves it is current —
 * otherwise the app shows one schedule and the job sends another, or the tests
 * exercise one WebAuthn verifier and production runs a different one, and both
 * look right.
 *
 * This is that proof. It re-runs the transform in memory and compares bytes.
 */

const read = (path: string) => readFileSync(path, 'utf8');

describe.each(BUNDLES)('$vendorDir is current', ({ sourceDir, vendorDir, files }) => {
  for (const file of files) {
    it(`${file} matches ${sourceDir}/${file}`, () => {
      const expected = vendorSource(read(`${sourceDir}/${file}`), sourceDir);
      const actual = read(`${vendorDir}/${file}`);
      expect(actual, `Out of date. Run: node scripts/vendor-engine.mjs`).toBe(expected);
    });
  }
});

describe.each(BUNDLES)('$vendorDir is closed', ({ vendorDir, files }) => {
  it('imports no local module it does not carry', () => {
    /*
     * The list in the script is hand-maintained, and a module added to the
     * chain and forgotten there would still deploy — Deno would fail at
     * *runtime*, on the daily job or on somebody's sign-in, where nobody is
     * watching. So the imports are walked rather than trusted.
     */
    const carried = new Set(files);
    const missing: string[] = [];

    for (const file of files) {
      const source = read(`${vendorDir}/${file}`);
      for (const match of source.matchAll(/from '(\.\/[^']+)'/g)) {
        const target = match[1].replace('./', '');
        if (!carried.has(target)) missing.push(`${file} -> ${target}`);
      }
    }

    expect(missing, 'add these to the bundle in scripts/vendor-engine.mjs').toEqual([]);
  });

  it('leaves no path alias Deno cannot resolve', () => {
    // `@/…` is a Next tsconfig alias. Deno has never heard of it, and an import
    // that survives here is a function that fails to boot.
    for (const file of files) {
      expect(read(`${vendorDir}/${file}`), `${file} still has an @/ import`).not.toMatch(
        /from '@\//,
      );
    }
  });

  it('gives every relative import the extension Deno requires', () => {
    for (const file of files) {
      for (const match of read(`${vendorDir}/${file}`).matchAll(/from '(\.\.?\/[^']+)'/g)) {
        expect(match[1], `${file} imports ${match[1]} without .ts`).toMatch(/\.ts$/);
      }
    }
  });

  it('pins every npm import to a version, not a range', () => {
    /*
     * `npm:@simplewebauthn/server` with no version lets Deno resolve whatever
     * is latest at cold-start. For a WebAuthn verifier that means production
     * could be running code the tests never saw — silently, and only on the
     * deploys that happen to land after a release.
     */
    for (const file of files) {
      for (const match of read(`${vendorDir}/${file}`).matchAll(/from '(npm:[^']+)'/g)) {
        expect(match[1], `${file} imports ${match[1]} unpinned`).toMatch(/@\d+\.\d+\.\d+/);
      }
    }
  });

  it('carries no bare npm specifier Deno would fail to resolve', () => {
    // Anything that is neither relative, nor `npm:`, nor `jsr:` is a specifier
    // Deno cannot resolve — and unlike a missing extension it is easy to add by
    // importing a new package into a shared module and forgetting this list.
    for (const file of files) {
      for (const match of read(`${vendorDir}/${file}`).matchAll(/from '([^']+)'/g)) {
        expect(match[1], `${file} imports ${match[1]}; add it to npmSpecifiers()`).toMatch(
          /^(\.\.?\/|npm:|jsr:|node:)/,
        );
      }
    }
  });

  it('marks every copy as generated, so nobody edits the wrong one', () => {
    for (const file of files) {
      expect(read(`${vendorDir}/${file}`)).toContain('GENERATED FILE — do not edit');
    }
  });
});

describe('npm specifiers', () => {
  it('pins to the installed version, not the declared range', () => {
    /*
     * The range in package.json is the wrong thing to pin to: `^13.3.2` lets
     * Deno fetch a version Node never ran. This asserts the lockfile is the
     * source, which is what makes a dependency bump force a re-vendor.
     */
    const lock = JSON.parse(read('package-lock.json'));
    const installed = lock.packages['node_modules/@simplewebauthn/server'].version;
    expect(npmSpecifiers()['@simplewebauthn/server']).toBe(
      `npm:@simplewebauthn/server@${installed}`,
    );
    expect(npmSpecifiers()['@simplewebauthn/server']).not.toContain('^');
  });
});
