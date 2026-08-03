import { describe, expect, it } from 'vitest';

import {
  CITATIONS,
  basisStatus,
  isFullyUnverified,
  unverifiedRuleKeys,
  type RuleKey,
} from './citations';
import { RULES } from './uae';

/**
 * These tests are the loud failure workstream A exists to provide.
 *
 * The engine's numbers are the app's whole claim to be worth reading. The
 * failure mode being guarded against is not a wrong number — it is a number
 * whose provenance nobody recorded, which then reads as authoritative because
 * the screen says nothing to the contrary.
 */
describe('every rule declares where it came from', () => {
  it('has a citation entry for every rule constant', () => {
    /*
     * The point of the test. Adding a constant to RULES without deciding its
     * provenance now breaks the build, rather than shipping a figure with a
     * basis nobody thought about.
     */
    expect(Object.keys(CITATIONS).sort()).toEqual(Object.keys(RULES).sort());
  });

  it('never carries half a citation', () => {
    /*
     * A provision with no verification date is worse than no citation: it looks
     * sourced. UAE employment law was substantially rewritten in 2022, so an
     * article number with no date cannot tell a reader whether it predates
     * that rewrite. Either both halves, or neither.
     */
    const half = (Object.entries(CITATIONS) as [RuleKey, (typeof CITATIONS)[RuleKey]][])
      .filter(([, c]) => (c.provision === null) !== (c.verifiedOn === null))
      .map(([k]) => k);

    expect(half).toEqual([]);
  });

  it('gives every rule a label a person could read', () => {
    const unlabelled = (Object.entries(CITATIONS) as [RuleKey, (typeof CITATIONS)[RuleKey]][])
      .filter(([, c]) => c.label.trim() === '')
      .map(([k]) => k);

    expect(unlabelled).toEqual([]);
  });
});

describe('the current state, which the UI is required to match', () => {
  /*
   * This is a tripwire, not a preference.
   *
   * OD-1 resolved as no legal sourcing, so today nothing is verified and every
   * screen says so. The day somebody sources a rule, this test fails — and it
   * should, because the copy beside the figure has to change in the same
   * commit. A verified rule still rendering "not checked against the current
   * law" would be a different lie in the opposite direction.
   */
  it('has nothing verified yet', () => {
    expect(unverifiedRuleKeys()).toHaveLength(Object.keys(RULES).length);
    expect(isFullyUnverified()).toBe(true);
  });

  it('reports a rule as unverified rather than throwing', () => {
    expect(basisStatus('GRATUITY_DAYS_FIRST_5Y')).toBe('unverified');
  });
});
