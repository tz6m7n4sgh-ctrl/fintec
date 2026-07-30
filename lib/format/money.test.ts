/**
 * Formatter tests.
 *
 * These exist because of a real defect: a zero deduction rendered as "-0.00" on
 * the termination report, since `-0` survives `Math.round` and
 * `Intl.NumberFormat` faithfully formats the sign. A settlement line reading
 * "-0.00" looks like a bug in the arithmetic, so negative zero is normalised.
 */

import { describe, expect, it } from 'vitest';

import { aed, money, moneyPrecise, moneySigned, months, percent } from './money';

describe('money', () => {
  it('formats with en-AE thousands separators and no decimals', () => {
    expect(money(220_479.47)).toBe('220,479');
    expect(money(1_000)).toBe('1,000');
    expect(money(0)).toBe('0');
  });

  it('rounds to whole AED', () => {
    expect(money(93_479.47)).toBe('93,479');
    expect(money(93_479.5)).toBe('93,480');
  });

  it('normalises negative zero — a settlement line must never read "-0"', () => {
    expect(money(-0)).toBe('0');
    expect(moneyPrecise(-0)).toBe('0.00');
    expect(moneySigned(-0)).toBe('0');
    // The value that produced the original defect: negating a zero deduction.
    const owedToEmployer = 0;
    expect(moneyPrecise(-owedToEmployer)).toBe('0.00');
  });

  it('renders non-finite values as an em dash rather than "Infinity" or "NaN"', () => {
    expect(money(Infinity)).toBe('—');
    expect(money(NaN)).toBe('—');
    expect(moneyPrecise(Infinity)).toBe('—');
    expect(moneySigned(-Infinity)).toBe('—');
  });

  it('aed() prefixes the currency once', () => {
    expect(aed(220_479)).toBe('AED 220,479');
    expect(aed(Infinity)).toBe('—');
  });

  it('moneyPrecise keeps two decimals for itemised settlement lines', () => {
    expect(moneyPrecise(87_479.47)).toBe('87,479.47');
    expect(moneyPrecise(6_000)).toBe('6,000.00');
  });

  it('moneySigned uses a true minus sign, not a hyphen', () => {
    expect(moneySigned(-55_521)).toBe('−55,521');
    expect(moneySigned(-55_521).charAt(0)).toBe('−');
    expect(moneySigned(55_521)).toBe('55,521');
  });
});

describe('months', () => {
  it('shows one decimal place', () => {
    expect(months(9.586)).toBe('9.6');
    expect(months(3)).toBe('3.0');
  });

  it('shows "Unlimited" for infinite runway (§11 edge case)', () => {
    expect(months(Infinity)).toBe('Unlimited');
  });
});

describe('percent', () => {
  it('rounds to whole percentage points', () => {
    expect(percent(0.6956)).toBe('70%');
    expect(percent(0)).toBe('0%');
    expect(percent(1)).toBe('100%');
  });
});
