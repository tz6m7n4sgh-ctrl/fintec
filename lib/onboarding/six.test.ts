import { describe, expect, it } from 'vitest';

import { SIX_FIELDS, readSix, summariseProblems, type SixFieldName } from './six';

const COMPLETE: Record<string, string> = {
  employmentStart: '2019-06-01',
  expectedLastDay: '2026-09-30',
  basicSalary: '15000',
  grossSalary: '25000',
  unpaidLeaveDays: '0',
  unusedLeaveDays: '12',
};

/** A getter over a plain object, matching what the form supplies. */
const from =
  (o: Record<string, string>) =>
  (name: string): string =>
    o[name] ?? '';

describe('the six read cleanly when they are all answered', () => {
  it('returns the values', () => {
    const r = readSix(from(COMPLETE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual({
      employmentStart: '2019-06-01',
      expectedLastDay: '2026-09-30',
      basicSalary: 15000,
      grossSalary: 25000,
      unpaidLeaveDays: 0,
      unusedLeaveDays: 12,
    });
  });

  it('reads a salary typed the way people write salaries', () => {
    /*
     * The defect this project keeps returning to. `Number('32,000')` is NaN,
     * and the old profile action turned that into a saved zero. Here it has to
     * survive the whole way to a value.
     */
    const r = readSix(from({ ...COMPLETE, basicSalary: 'AED 32,000', grossSalary: '45 000' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.basicSalary).toBe(32000);
    expect(r.values.grossSalary).toBe(45000);
  });
});

describe('a blank is unanswered, never zero', () => {
  it.each([
    ['basicSalary'],
    ['grossSalary'],
    ['unpaidLeaveDays'],
    ['unusedLeaveDays'],
  ] as [SixFieldName][])('refuses rather than substituting zero for %s', (field) => {
    const r = readSix(from({ ...COMPLETE, [field]: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.field)).toContain(field);
  });

  it('says blank is not zero for the leave figures', () => {
    /*
     * The distinction P2-5 turns on. "I took no unpaid leave" and "I have not
     * answered that" are different states, and only one of them is safe to
     * compute a gratuity from.
     */
    const r = readSix(from({ ...COMPLETE, unpaidLeaveDays: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const p = r.problems.find((x) => x.field === 'unpaidLeaveDays');
    expect(p?.message).toMatch(/blank is not zero/i);
  });

  it('refuses a blank start date, and says what it costs', () => {
    const r = readSix(from({ ...COMPLETE, employmentStart: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.find((p) => p.field === 'employmentStart')?.message).toMatch(
      /no gratuity — not a smaller one, none/,
    );
  });
});

describe('what it says about input it cannot use', () => {
  it('rejects a last day before the start date', () => {
    const r = readSix(from({ ...COMPLETE, expectedLastDay: '2018-09-30' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.find((p) => p.field === 'expectedLastDay')?.message).toMatch(
      /will not compute negative service/,
    );
  });

  it('rejects gross below basic, and suggests the likely cause', () => {
    const r = readSix(from({ ...COMPLETE, basicSalary: '25000', grossSalary: '15000' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.find((p) => p.field === 'grossSalary')?.message).toMatch(/wrong way round/);
  });

  it('rejects a date that does not exist', () => {
    const r = readSix(from({ ...COMPLETE, employmentStart: '2026-02-31' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.field)).toContain('employmentStart');
  });

  it('does not complain about a comparison it cannot make', () => {
    /*
     * With no start date, "your last day is before your start" is noise —
     * there is nothing to be before. One problem, not two.
     */
    const r = readSix(from({ ...COMPLETE, employmentStart: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.filter((p) => p.field === 'expectedLastDay')).toHaveLength(0);
  });

  it('reports every problem at once rather than one at a time', () => {
    const r = readSix(
      from({ ...COMPLETE, employmentStart: '', basicSalary: '', unusedLeaveDays: 'twelve' }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toHaveLength(3);
  });
});

describe('the line under a blocked submit', () => {
  it('counts what is missing separately from what is wrong', () => {
    const filled = { ...COMPLETE, employmentStart: '', basicSalary: '', grossSalary: '9' };
    const r = readSix(from(filled));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // basic 15000 vs gross 9 also trips the gross-below-basic check, but basic
    // is blank here, so the only correction is the one the reader can act on.
    expect(summariseProblems(r.problems, from(filled))).toBe('2 answers still needed.');
  });

  it('uses the singular for one', () => {
    const filled = { ...COMPLETE, unusedLeaveDays: '' };
    const r = readSix(from(filled));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(summariseProblems(r.problems, from(filled))).toBe('1 answer still needed.');
  });
});

describe('the field list itself', () => {
  it('is six, because the decision was six', () => {
    expect(SIX_FIELDS).toHaveLength(6);
  });

  it('gives every field both a help line and a cost of leaving it blank', () => {
    for (const f of SIX_FIELDS) {
      expect(f.help.trim()).not.toBe('');
      expect(f.blankCost.trim()).not.toBe('');
    }
  });
});
