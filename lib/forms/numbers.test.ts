import { describe, expect, it } from 'vitest';
import { isBlank, numberError, parseFormNumber } from './numbers';

/**
 * The defect these tests exist for.
 *
 * `app/profile/actions.ts` read every numeric field with
 * `Number.isFinite(v) ? v : 0`. `Number('32,000')` is `NaN`, so a basic salary
 * typed the way people write salaries was saved as **zero**, and the form said
 * it had worked.
 *
 * Gratuity, leave encashment, ILOE eligibility and the whole runway are all
 * computed from basic salary. Every one of them would have rendered a confident
 * figure derived from nothing. The `gross >= basic` constraint could not catch
 * it either, because zero satisfies it.
 *
 * So the first test below is the input that caused it.
 */

describe('parseFormNumber — the input that caused this', () => {
  it('reads a salary written with a thousands separator', () => {
    // The whole reason this module exists.
    expect(parseFormNumber('32,000')).toEqual({ ok: true, value: 32000 });
  });

  it('never substitutes a value for an unreadable one', () => {
    /*
     * The property that matters more than any particular format. Returning 0
     * for "thirty two thousand" is not leniency, it is fabricating a figure
     * the user never typed — and then computing a termination settlement from
     * it.
     */
    const result = parseFormNumber('thirty two thousand');
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('value');
  });
});

describe('parseFormNumber — what people actually type', () => {
  it('accepts plain digits', () => {
    expect(parseFormNumber('32000')).toEqual({ ok: true, value: 32000 });
  });

  it('accepts decimals', () => {
    expect(parseFormNumber('1234.56')).toEqual({ ok: true, value: 1234.56 });
    expect(parseFormNumber('.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('accepts spaces, including the ones a spreadsheet paste carries', () => {
    expect(parseFormNumber('32 000')).toEqual({ ok: true, value: 32000 });
    // Non-breaking and narrow no-break space — what Excel and many bank
    // statements use as a thousands separator.
    expect(parseFormNumber('32 000')).toEqual({ ok: true, value: 32000 });
    expect(parseFormNumber('32 000')).toEqual({ ok: true, value: 32000 });
  });

  it('accepts a currency the user left on', () => {
    expect(parseFormNumber('AED 32,000')).toEqual({ ok: true, value: 32000 });
    expect(parseFormNumber('32,000 AED')).toEqual({ ok: true, value: 32000 });
    expect(parseFormNumber('$1,500')).toEqual({ ok: true, value: 1500 });
  });
});

describe('parseFormNumber — what Number() is too generous about', () => {
  /*
   * `Number` is built for parsing program text, not form input. Each of these
   * is a value it happily returns, and none of them is something a person
   * meant to type into a salary box. The old code accepted all of them.
   */

  it('refuses hexadecimal', () => {
    expect(Number('0x1f')).toBe(31); // what Number does
    expect(parseFormNumber('0x1f').ok).toBe(false);
  });

  it('refuses exponent notation', () => {
    expect(Number('1e5')).toBe(100000);
    expect(parseFormNumber('1e5').ok).toBe(false);
  });

  it('refuses Infinity', () => {
    expect(Number('Infinity')).toBe(Infinity);
    expect(parseFormNumber('Infinity').ok).toBe(false);
  });

  it('refuses an empty string, which Number reads as zero', () => {
    expect(Number('')).toBe(0);
    expect(parseFormNumber('').ok).toBe(false);
  });

  it('refuses two decimal points', () => {
    expect(parseFormNumber('32.0.00').ok).toBe(false);
  });

  it('refuses letters mixed into digits', () => {
    expect(parseFormNumber('32000x').ok).toBe(false);
    expect(parseFormNumber('abc').ok).toBe(false);
  });
});

describe('parseFormNumber — signs', () => {
  it('refuses a negative by default, and says which problem it is', () => {
    // Distinguished from "not a number" because the user's next action
    // differs: one is a typo, the other is a misunderstanding of the field.
    expect(parseFormNumber('-500')).toEqual({ ok: false, reason: 'negative' });
  });

  it('allows a negative where the caller says one is meaningful', () => {
    expect(parseFormNumber('-500', { allowNegative: true })).toEqual({ ok: true, value: -500 });
  });
});

describe('isBlank', () => {
  it('separates "left alone" from "unreadable"', () => {
    /*
     * Blank still means zero — most of these fields are genuinely zero for
     * most people, and forcing a 0 into every box would be worse than
     * useless. What changed is that *unreadable* no longer also means zero.
     */
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank('0')).toBe(false);
    expect(isBlank('abc')).toBe(false);
  });
});

describe('numberError', () => {
  it('names the field, because a form has sixteen boxes', () => {
    expect(numberError('Basic salary', 'not-a-number')).toMatch(/^Basic salary is not a number/);
    expect(numberError('Basic salary', 'negative')).toBe('Basic salary cannot be negative.');
  });

  it('says commas are fine, because the user probably just used one', () => {
    // The message has to not repeat the mistake the old code made — telling
    // somebody "digits only" after they typed 32,000 would be wrong advice.
    expect(numberError('Cash savings', 'not-a-number')).toMatch(/commas and spaces are fine/);
  });
});
