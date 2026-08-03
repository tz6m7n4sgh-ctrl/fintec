import { describe, expect, it } from 'vitest';
import { onboardingAnswer } from './Onboarding';

const valid = { employmentStart: '2020-01-01', expectedLastDay: '2026-01-01', basicSalary: '20,000', grossSalary: '32,000', unpaidLeaveDays: '0', unusedLeaveDays: '12' };

describe('onboardingAnswer', () => {
  it('counts blank answers instead of inventing defaults', () => {
    const result = onboardingAnswer({});
    expect(result.missing).toHaveLength(6);
    expect(result.errors).toEqual({});
  });

  it('accepts human-formatted money without reading it as zero', () => {
    expect(onboardingAnswer(valid)).toEqual({ missing: [], errors: {} });
  });

  it('rejects a last day before the employment start', () => {
    const result = onboardingAnswer({ ...valid, expectedLastDay: '2019-12-31' });
    expect(result.errors.expectedLastDay).toMatch(/on or after/);
  });

  it('requires an explicit zero for leave fields', () => {
    const result = onboardingAnswer({ ...valid, unpaidLeaveDays: '', unusedLeaveDays: '' });
    expect(result.missing).toEqual(['unpaidLeaveDays', 'unusedLeaveDays']);
  });
});
