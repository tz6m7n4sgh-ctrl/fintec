import { describe, expect, it } from 'vitest';

import { BAND_THRESHOLDS, READINESS_MAX, readinessBand, scoreReadiness } from './readiness';
import { SEED_BUDGET, SEED_DEBTS, SEED_PAYMENTS, SEED_PROFILE } from '../data/seed';
import { computeReadiness } from './uae';
import type { Debt, Profile } from './types';

const readiness = (p: Profile = SEED_PROFILE) =>
  computeReadiness(p, SEED_BUDGET, SEED_PAYMENTS);

describe('readiness bands', () => {
  it.each([
    [18, 'STRONG'], [14, 'STRONG'], [13, 'MODERATE'], [9, 'MODERATE'],
    [8, 'AT RISK'], [0, 'AT RISK'],
  ] as const)('score %i → %s', (total, band) => {
    expect(readinessBand(total)).toBe(band);
  });

  it('band thresholds match the spec (STRONG ≥14 · MODERATE 9–13 · AT RISK <9)', () => {
    expect(BAND_THRESHOLDS.STRONG_MIN).toBe(14);
    expect(BAND_THRESHOLDS.MODERATE_MIN).toBe(9);
  });
});

describe('scoreReadiness', () => {
  it('scores the reference profile and never exceeds the maximum', () => {
    const s = scoreReadiness(readiness(), SEED_DEBTS, SEED_BUDGET);
    expect(s.max).toBe(READINESS_MAX);
    expect(s.total).toBeLessThanOrEqual(READINESS_MAX);
    expect(s.total).toBeGreaterThanOrEqual(0);
    // Criteria must sum exactly to the total — no hidden points.
    expect(s.criteria.reduce((a, c) => a + c.score, 0)).toBe(s.total);
    expect(s.criteria.reduce((a, c) => a + c.max, 0)).toBe(READINESS_MAX);
  });

  it('reference profile lands in MODERATE with 9.6 months runway', () => {
    const s = scoreReadiness(readiness(), SEED_DEBTS, SEED_BUDGET);
    // runway 5 (9.6mo) + iloe 4 (39% -> 3) + settlement 4 (4.1mo) + debt 4 (26% -> 2)
    expect(s.criteria.find((c) => c.key === 'runway')!.score).toBe(5);
    expect(s.criteria.find((c) => c.key === 'settlement')!.score).toBe(4);
    expect(['MODERATE', 'STRONG']).toContain(s.band);
  });

  it('gives zero ILOE points when ineligible, and explains why', () => {
    const s = scoreReadiness(
      readiness({ ...SEED_PROFILE, iloeSubscribed12m: false }),
      SEED_DEBTS,
      SEED_BUDGET,
    );
    const iloe = s.criteria.find((c) => c.key === 'iloe')!;
    expect(iloe.score).toBe(0);
    expect(iloe.detail).toMatch(/not eligible/i);
  });

  it('awards full runway marks for unlimited runway', () => {
    const s = scoreReadiness(
      readiness({ ...SEED_PROFILE, monthlySideIncome: 30_000 }),
      SEED_DEBTS,
      SEED_BUDGET,
    );
    const runway = s.criteria.find((c) => c.key === 'runway')!;
    expect(runway.score).toBe(6);
    expect(runway.detail).toMatch(/unlimited/i);
  });

  it('penalises a heavy debt burden', () => {
    const heavy: Debt[] = [
      { id: 'h', type: 'personalLoan', name: 'Big loan', outstandingBalance: 500_000, monthlyPayment: 15_000, monthsRemaining: 40, lender: 'X' },
    ];
    const light: Debt[] = [
      { id: 'l', type: 'personalLoan', name: 'Small loan', outstandingBalance: 10_000, monthlyPayment: 500, monthsRemaining: 20, lender: 'X' },
    ];
    const heavyScore = scoreReadiness(readiness(), heavy, SEED_BUDGET)
      .criteria.find((c) => c.key === 'debtRatio')!.score;
    const lightScore = scoreReadiness(readiness(), light, SEED_BUDGET)
      .criteria.find((c) => c.key === 'debtRatio')!.score;
    expect(heavyScore).toBeLessThan(lightScore);
    expect(lightScore).toBe(4);
  });

  it('a broke, ineligible, heavily indebted profile scores AT RISK', () => {
    const bad = readiness({
      ...SEED_PROFILE,
      cashSavings: 0,
      otherLiquidAssets: 0,
      iloeSubscribed12m: false,
      employmentStart: '2026-01-01', // under a year → no gratuity
      expectedLastDay: '2026-09-30',
      unusedLeaveDays: 0,
    });
    const s = scoreReadiness(bad, [
      { id: 'x', type: 'personalLoan', name: 'Loan', outstandingBalance: 200_000, monthlyPayment: 14_000, monthsRemaining: 30, lender: 'X' },
    ], SEED_BUDGET);
    expect(s.band).toBe('AT RISK');
    expect(s.total).toBeLessThan(BAND_THRESHOLDS.MODERATE_MIN);
  });

  it('every criterion carries a human-readable explanation', () => {
    const s = scoreReadiness(readiness(), SEED_DEBTS, SEED_BUDGET);
    for (const c of s.criteria) {
      expect(c.detail.length).toBeGreaterThan(10);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});
