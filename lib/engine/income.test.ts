import { describe, expect, it } from 'vitest';
import { incomeAfterLastDay, isStreamActiveOn, monthlyIncomeOn, streamsEndingBy } from './income';
import type { IncomeStream } from './types';

/**
 * US-27's real requirement: the salary stopping when the job does is a
 * consequence of the stream's own dates, not a fact asserted about the seed.
 *
 * Before this, `SEED_INCOME` set the salary's endDate to the same value as
 * `expectedLastDay` and nothing checked the two agreed. Changing one would have
 * left the other silently wrong.
 */

const LAST_DAY = '2026-09-30';

const salary: IncomeStream = {
  id: 'inc-salary', name: 'Salary', amount: 25_000, frequency: 'monthly',
  endDate: LAST_DAY, active: true,
};
const side: IncomeStream = {
  id: 'inc-side', name: 'Freelance', amount: 4_000, frequency: 'monthly', active: true,
};
const oneOff: IncomeStream = {
  id: 'inc-bonus', name: 'Bonus', amount: 30_000, frequency: 'oneOff', active: true,
};

describe('isStreamActiveOn', () => {
  it('a stream with no dates is always running', () => {
    expect(isStreamActiveOn(side, '2020-01-01')).toBe(true);
    expect(isStreamActiveOn(side, '2030-01-01')).toBe(true);
  });

  it('an end date is the last day it pays, not the first day it does not', () => {
    expect(isStreamActiveOn(salary, LAST_DAY)).toBe(true);
    expect(isStreamActiveOn(salary, '2026-10-01')).toBe(false);
  });

  it('a stream has not started before its start date', () => {
    const future = { ...side, startDate: '2027-01-01' };
    expect(isStreamActiveOn(future, '2026-12-31')).toBe(false);
    expect(isStreamActiveOn(future, '2027-01-01')).toBe(true);
  });

  it('inactive beats every date', () => {
    expect(isStreamActiveOn({ ...side, active: false }, '2026-01-01')).toBe(false);
  });
});

describe('monthlyIncomeOn', () => {
  it('counts every monthly stream running that day', () => {
    expect(monthlyIncomeOn([salary, side], '2026-06-01')).toBe(29_000);
  });

  it('excludes one-off streams from a per-month figure', () => {
    // A bonus is an amount on a date. Adding it to a monthly total would
    // overstate every month after the one it lands in.
    expect(monthlyIncomeOn([side, oneOff], '2026-06-01')).toBe(4_000);
  });
});

describe('incomeAfterLastDay — the salary auto-end', () => {
  it('salary is gone the day after the last working day', () => {
    // The substance of US-27: enforced by the stream's window, not by the seed.
    expect(monthlyIncomeOn([salary, side], LAST_DAY)).toBe(29_000);
    expect(incomeAfterLastDay([salary, side], LAST_DAY)).toBe(4_000);
  });

  it('takes the day after, not the last day itself', () => {
    // On the last day salary is still active. Counting it would make the first
    // month of unemployment look funded.
    expect(incomeAfterLastDay([salary], LAST_DAY)).toBe(0);
  });

  it('rolls correctly across a month end', () => {
    const s = { ...salary, endDate: '2026-01-31' };
    expect(incomeAfterLastDay([s, side], '2026-01-31')).toBe(4_000);
  });

  it('rolls correctly across a year end', () => {
    const s = { ...salary, endDate: '2026-12-31' };
    expect(incomeAfterLastDay([s, side], '2026-12-31')).toBe(4_000);
  });

  it('a salary ending after the last working day keeps paying — no special case', () => {
    // The rule is the window, not the word "salary". A contract running past
    // the exit date should still count, and it does.
    const s = { ...salary, endDate: '2026-12-31' };
    expect(incomeAfterLastDay([s], LAST_DAY)).toBe(25_000);
  });

  it('no income at all is zero, not a broken number', () => {
    expect(incomeAfterLastDay([], LAST_DAY)).toBe(0);
  });
});

describe('streamsEndingBy', () => {
  it('names which income stops when the job does', () => {
    expect(streamsEndingBy([salary, side], LAST_DAY).map((s) => s.name)).toEqual(['Salary']);
  });
});
