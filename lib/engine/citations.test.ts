import { describe, expect, it } from 'vitest';

import {
  RULE_KEYS,
  basisStatus,
  isFullyUnverified,
  ruleEntries,
  unverifiedCount,
  unverifiedRuleKeys,
} from './citations';
import { RULES } from './uae';

/**
 * These tests are the loud failure workstream A exists to provide.
 *
 * The engine's numbers are the app's whole claim to be worth reading. The
 * failure mode being guarded against is not a wrong number — it is a number
 * whose provenance nobody recorded, which then reads as authoritative because
 * the screen says nothing to the contrary.
 *
 * A constant declared without evidence no longer reaches these tests: `rule()`
 * takes the provision and the verification date as required arguments, so it
 * fails to compile. What is left to test is the shape of the evidence itself.
 */
describe('every rule declares where it came from', () => {
  it('covers every constant in RULES', () => {
    expect(RULE_KEYS.length).toBe(Object.keys(RULES).length);
    expect(ruleEntries()).toHaveLength(RULE_KEYS.length);
  });

  it('never carries half a citation', () => {
    /*
     * The test the type system cannot do, and the reason this file still exists.
     *
     * `rule(30, 'label', 'Article 51', null)` compiles perfectly well. It is
     * also the most dangerous of the three states: a provision with no
     * verification date *looks* sourced. UAE employment law was substantially
     * rewritten in 2022, so an article number with no date cannot tell a reader
     * whether it predates the rewrite. Either both halves, or neither.
     */
    const half = ruleEntries()
      .filter(([, r]) => (r.provision === null) !== (r.verifiedOn === null))
      .map(([k]) => k);

    expect(half).toEqual([]);
  });

  it('gives every rule a label a person could read', () => {
    const unlabelled = ruleEntries()
      .filter(([, r]) => r.label.trim() === '')
      .map(([k]) => k);

    expect(unlabelled).toEqual([]);
  });

  it('never records a verification date in the future', () => {
    /*
     * "Verified" has to mean somebody has already looked. A date ahead of today
     * is either a typo or a placeholder, and both would render as evidence.
     */
    const today = new Date().toISOString().slice(0, 10);
    const ahead = ruleEntries()
      .filter(([, r]) => r.verifiedOn !== null && r.verifiedOn > today)
      .map(([k]) => k);

    expect(ahead).toEqual([]);
  });
});

describe('the current state, which the UI is required to match', () => {
  /*
   * A tripwire, not a preference.
   *
   * OD-1 resolved as no legal sourcing, so today nothing is verified and every
   * screen says so. The day somebody sources a rule, this fails — and it should,
   * because the copy beside the figure has to change in the same commit. A
   * verified rule still rendering "not checked against the current law" would be
   * a different lie in the opposite direction.
   */
  it('has nothing verified yet', () => {
    expect(unverifiedRuleKeys()).toHaveLength(RULE_KEYS.length);
    expect(isFullyUnverified()).toBe(true);
  });

  it('counts the unsourced rules against the total', () => {
    expect(unverifiedCount()).toEqual({ unverified: 16, total: 16 });
  });

  it('reports a rule as unverified rather than throwing', () => {
    expect(basisStatus('GRATUITY_DAYS_FIRST_5Y')).toBe('unverified');
  });
});
