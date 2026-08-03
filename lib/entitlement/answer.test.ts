import { describe, expect, it } from 'vitest';
import { SEED_PROFILE } from '@/lib/data/seed';
import { entitlementFor } from './answer';

describe('date-driven entitlement answer', () => {
  it('changes the engine answer and deadlines when the last day changes', () => {
    const september = entitlementFor(SEED_PROFILE, '2026-09-30');
    const december = entitlementFor(SEED_PROFILE, '2026-12-31');

    expect(september.settlement.finalSettlement).toBeCloseTo(93_479.47, 2);
    expect(december.settlement.finalSettlement).toBeGreaterThan(
      september.settlement.finalSettlement,
    );
    expect(december.deadlines.settlementDue).toBe('2027-01-14');
    expect(december.deadlines.iloeDeadline).toBe('2027-01-30');
  });

  it('preserves the engine zero state for service under one year', () => {
    const answer = entitlementFor(
      { ...SEED_PROFILE, employmentStart: '2026-02-01' },
      '2026-09-30',
    );

    expect(answer.gratuity.ineligible).toBe(true);
    expect(answer.gratuity.gratuity).toBe(0);
  });

  it('preserves the engine cap state', () => {
    const answer = entitlementFor(
      { ...SEED_PROFILE, employmentStart: '1970-01-01' },
      '2026-09-30',
    );

    expect(answer.gratuity.capApplied).toBe(true);
    expect(answer.gratuity.gratuity).toBe(answer.gratuity.gratuityCap);
  });
});

