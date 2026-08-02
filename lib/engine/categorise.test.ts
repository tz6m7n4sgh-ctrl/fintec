import { describe, expect, it } from 'vitest';
import { categorise, matchRule, shadowedRules, type CategoryRule } from './categorise';

/**
 * US-32 (HAD-11).
 *
 * The property most of these defend is **determinism**. A rule set that
 * resolves differently depending on the order rows came back from the database
 * would reshuffle somebody's spending history on a re-parse, and nothing would
 * report that it had.
 */

const rule = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  id: 'r1',
  keyword: 'DEWA',
  categoryId: 'cat-util',
  priority: 100,
  ...over,
});

describe('matchRule', () => {
  it('matches a keyword anywhere in the description', () => {
    expect(categorise('SEP BILL DEWA DUBAI', [rule()])).toBe('cat-util');
  });

  it('is case-insensitive both ways', () => {
    expect(categorise('dewa bill', [rule({ keyword: 'DeWa' })])).toBe('cat-util');
  });

  it('no rule means no category, rather than a guess', () => {
    expect(categorise('SALIK TOLL', [rule()])).toBeUndefined();
  });

  it('ignores a blank keyword instead of matching everything', () => {
    // `includes('')` is true for every string. Without the guard, one empty
    // rule would silently categorise the entire ledger.
    expect(categorise('ANYTHING AT ALL', [rule({ keyword: '   ' })])).toBeUndefined();
  });

  it('lower priority wins', () => {
    const out = matchRule('DEWA SEP BILL', [
      rule({ id: 'low', keyword: 'DEWA', categoryId: 'cat-a', priority: 200 }),
      rule({ id: 'high', keyword: 'DEWA', categoryId: 'cat-b', priority: 10 }),
    ]);
    expect(out?.id).toBe('high');
  });

  it('at equal priority the more specific keyword wins', () => {
    /*
     * `ADCB CAR LOAN` is more specific than `ADCB`, and writing the longer one
     * is how the user expressed that. Picking the shorter would file a car-loan
     * instalment under whatever generic bucket `ADCB` points at.
     */
    const out = matchRule('ADCB CAR LOAN INSTALMENT', [
      rule({ id: 'broad', keyword: 'ADCB', categoryId: 'cat-other' }),
      rule({ id: 'specific', keyword: 'ADCB CAR LOAN', categoryId: 'cat-debt' }),
    ]);
    expect(out?.id).toBe('specific');
  });

  it('resolves identically regardless of input order', () => {
    // The determinism property. Row order from the database is not stable, and
    // a categorisation that depends on it would drift between parses.
    const rules = [
      rule({ id: 'a', keyword: 'BILL', categoryId: 'cat-a' }),
      rule({ id: 'b', keyword: 'DEWA', categoryId: 'cat-b' }),
      rule({ id: 'c', keyword: 'SEP', categoryId: 'cat-c' }),
    ];
    const forward = matchRule('DEWA SEP BILL', rules)?.id;
    const reversed = matchRule('DEWA SEP BILL', [...rules].reverse())?.id;
    expect(forward).toBe(reversed);
  });

  it('an empty rule set categorises nothing', () => {
    expect(categorise('DEWA', [])).toBeUndefined();
  });
});

describe('shadowedRules', () => {
  it('reports a rule a higher-precedence broader one always beats', () => {
    // ADCB at priority 10 swallows everything ADCB CAR LOAN would have caught,
    // so the second rule can never fire and the user should be told.
    const broad = rule({ id: 'broad', keyword: 'ADCB', priority: 10 });
    const dead = rule({ id: 'dead', keyword: 'ADCB CAR LOAN', priority: 20 });
    expect(shadowedRules([broad, dead]).map((r) => r.id)).toEqual(['dead']);
  });

  it('does not report a rule that wins on specificity at equal priority', () => {
    const broad = rule({ id: 'broad', keyword: 'ADCB' });
    const specific = rule({ id: 'specific', keyword: 'ADCB CAR LOAN' });
    expect(shadowedRules([broad, specific])).toEqual([]);
  });

  it('does not report rules that merely overlap', () => {
    // Two keywords that both appear in some descriptions but neither contains
    // the other. A legitimate arrangement, not a mistake.
    const a = rule({ id: 'a', keyword: 'CARREFOUR', priority: 10 });
    const b = rule({ id: 'b', keyword: 'MALL', priority: 20 });
    expect(shadowedRules([a, b])).toEqual([]);
  });

  it('reports nothing for a single rule', () => {
    expect(shadowedRules([rule()])).toEqual([]);
  });
});
