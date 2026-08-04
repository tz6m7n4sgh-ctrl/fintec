import { describe, expect, it } from 'vitest';
import { varianceInk, varianceLabel, varianceVsPlan } from './variance';

/**
 * Budget vs actual, per category (US-25 / HAD-53).
 *
 * The "Difference" column this table always had compares plan against plan —
 * current vs survival. The variance these functions carry is the corrected
 * criterion: what was actually spent against what the current plan budgeted.
 * The tests pin the sign convention and, above all, the distinction between
 * "spent exactly to plan" and "nothing to compare" — collapsing those two is
 * this project's signature defect, a plausible figure computed from nothing.
 */

describe('varianceVsPlan', () => {
  it('is actual minus current plan — positive means over plan', () => {
    expect(varianceVsPlan(2100, 1800)).toBe(300);
    expect(varianceVsPlan(1500, 1800)).toBe(-300);
    expect(varianceVsPlan(1800, 1800)).toBe(0);
  });

  it('is null, not zero, where no actual exists for the category', () => {
    // A category no confirmed transaction ever landed in has no verdict.
    // Zero would read as "spent exactly to plan", which was never measured.
    expect(varianceVsPlan(undefined, 1800)).toBeNull();
  });
});

describe('varianceLabel', () => {
  it('says over or under in words, not by sign or colour alone (NFR-4)', () => {
    expect(varianceLabel(300)).toBe('+300 over');
    expect(varianceLabel(-300)).toBe('−300 under');
  });

  it('formats with the thousands separator the rest of the table uses', () => {
    expect(varianceLabel(1250)).toBe('+1,250 over');
  });

  it('distinguishes on-plan from nothing-to-compare', () => {
    expect(varianceLabel(0)).toBe('on plan');
    expect(varianceLabel(null)).toBe('—');
  });

  it('rounds to whole dirhams before deciding, so fils never read as over', () => {
    // The table shows whole dirhams; "+0 over" for a 40-fils drift would be
    // an alarm with no figure behind it.
    expect(varianceLabel(0.4)).toBe('on plan');
    expect(varianceLabel(-0.4)).toBe('on plan');
    expect(varianceLabel(0.6)).toBe('+1 over');
  });
});

describe('varianceInk', () => {
  it('agrees with the words: over is critical, under is good, neither otherwise', () => {
    expect(varianceInk(300)).toBe('var(--critical-ink)');
    expect(varianceInk(-300)).toBe('var(--good-ink)');
    expect(varianceInk(0)).toBeUndefined();
    expect(varianceInk(null)).toBeUndefined();
    // Consistent with the label's rounding: what says "on plan" is not tinted.
    expect(varianceInk(0.4)).toBeUndefined();
  });
});
