import { describe, expect, it } from 'vitest';
import { isComputableProfile } from './repository';
import { parseIso } from '@/lib/engine/dates';

/**
 * Guards against a class of failure this app is uniquely bad at surviving: a
 * saved row that no screen can be rendered from, including the screen that
 * would let you fix it.
 */

describe('isComputableProfile', () => {
  it('accepts a profile with both dates', () => {
    expect(isComputableProfile({ employment_start: '2019-06-01', expected_last_day: '2026-09-30' })).toBe(true);
  });

  it.each([
    ['no start date', { employment_start: null, expected_last_day: '2026-09-30' }],
    ['no last day', { employment_start: '2019-06-01', expected_last_day: null }],
    ['neither', { employment_start: null, expected_last_day: null }],
    ['undefined rather than null', { employment_start: undefined, expected_last_day: undefined }],
  ])('rejects a profile with %s', (_label, row) => {
    expect(isComputableProfile(row)).toBe(false);
  });

  it('rejects exactly the values that would take the whole app down', () => {
    // The reason this guard exists, stated as an assertion rather than a
    // comment: parseIso throws on a null date, and it is reached from
    // getReadModel, which every one of the ten screens calls. A profile saved
    // without dates would 500 every page — including /profile, the only place
    // the date could be corrected.
    const row = { employment_start: null, expected_last_day: null };
    expect(isComputableProfile(row)).toBe(false);
    expect(() => parseIso(row.employment_start as unknown as string)).toThrow(/Invalid ISO date/);
  });
});
