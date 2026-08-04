import { describe, expect, it } from 'vitest';

import {
  allowedNumbers,
  buildPrompt,
  buildWordingInput,
  extractNumbers,
  factLines,
  validateWording,
  wordingDigest,
  type WordingInput,
} from './wording';
import { UNVERIFIED_BASIS } from '@/lib/engine/citations';
import { computeReadiness } from '@/lib/engine/uae';
import { scoreReadiness } from '@/lib/engine/readiness';
import { moneyPrecise } from '@/lib/format/money';
import {
  SEED_BUDGET,
  SEED_DEBTS,
  SEED_INCOME,
  SEED_PAYMENTS,
  SEED_PROFILE,
} from '@/lib/data/seed';

/**
 * The validator is the whole warranty of HAD-118: the AI words the figures, it
 * never makes them, and these tests are what make that a property rather than
 * a hope. The failure being guarded against is the project's signature one — a
 * plausible wrong answer — in its most persuasive form, fluent prose around a
 * number nobody computed.
 *
 * Both directions are tested on purpose. A validator that only rejects would
 * quietly kill the feature (every generation "invalid"); one that only accepts
 * is not a validator.
 */

/** A hand-built input small enough that every assertion is legible. */
const INPUT: WordingInput = {
  facts: [
    { label: 'End-of-service gratuity paid', value: 87479.47, unit: 'aed' },
    { label: 'Gratuity accrual days per year in the first five years', value: 21, unit: 'count' },
    { label: 'Years of service', value: 4.687, unit: 'years' },
    { label: 'ILOE benefit rate', value: 0.6, unit: 'rate' },
    { label: 'Resources left after 6 months', value: 12000, unit: 'aed' },
  ],
  notes: [],
};

describe('extractNumbers', () => {
  it('reads thousands separators and decimals as single tokens', () => {
    const tokens = extractNumbers('AED 87,479.47, then 12,000 and 3.5 more');
    expect(tokens.map((t) => t.value)).toEqual([87479.47, 12000, 3.5]);
    // The raw spelling is preserved for the rejection log.
    expect(tokens[0].raw).toBe('87,479.47');
  });

  it('keeps a grouped number whole rather than splitting at the comma', () => {
    expect(extractNumbers('1,234,567.89')).toEqual([{ raw: '1,234,567.89', value: 1234567.89 }]);
  });
});

describe('validateWording — accepts faithful prose', () => {
  it('accepts prose that only restates input figures', () => {
    const verdict = validateWording(
      'Your gratuity comes to AED 87,479.47 after 4.687 years of service.',
      INPUT,
    );
    expect(verdict).toEqual({ ok: true, offending: [] });
  });

  it('accepts formatting variants: separators dropped, whole-dirham rounding', () => {
    // The report itself prints the same figure both precise and rounded, so
    // 87479.47, 87,479.47 and 87,479 are all the same number to the validator.
    expect(validateWording('87479.47 exactly', INPUT).ok).toBe(true);
    expect(validateWording('roughly AED 87,479', INPUT).ok).toBe(true);
  });

  it('accepts small integers that appear in the input, like day and month counts', () => {
    // 21 is a fact value; 6 only appears inside a scenario label — both are
    // input, and both are numbers the wording may say.
    expect(validateWording('21 days per year for the first years', INPUT).ok).toBe(true);
    expect(validateWording('after 6 months you would still have AED 12,000', INPUT).ok).toBe(true);
  });

  it('accepts a fraction restated as the percentage the report prints', () => {
    expect(validateWording('ILOE pays 60% of your average basic salary', INPUT).ok).toBe(true);
  });
});

describe('validateWording — rejects invented numbers', () => {
  it('rejects prose containing a number not in the input', () => {
    const verdict = validateWording('Your gratuity comes to AED 91,479.47.', INPUT);
    expect(verdict.ok).toBe(false);
    expect(verdict.offending).toEqual(['91,479.47']);
  });

  it('rejects the whole generation for a single bad number among faithful ones', () => {
    // No salvage: one invented figure forfeits the trust the rest trades on.
    const verdict = validateWording(
      'Gratuity is AED 87,479.47, which is about 87,500 over 4.687 years.',
      INPUT,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.offending).toEqual(['87,500']);
  });

  it('rejects a calendar year smuggled in as a number', () => {
    // The prompt forbids dates; the validator is what makes that stick.
    expect(validateWording('by early 2026 you should have been paid', INPUT).ok).toBe(false);
  });
});

describe('buildPrompt', () => {
  const { system, user } = buildPrompt(INPUT);

  it('instructs the model to state the unverified basis, unsoftened', () => {
    // The exact sentence the app shows is the one the model is told to carry —
    // one caveat, not two competing paraphrases of it.
    expect(system).toContain(UNVERIFIED_BASIS);
  });

  it('forbids computing and confines the model to the fact sheet', () => {
    expect(system).toContain('Do not calculate anything');
    expect(system).toContain('must not derive, add, subtract, multiply, divide, estimate');
  });

  it('shows the model the same renderings the report prints', () => {
    expect(user).toContain('End-of-service gratuity paid: AED 87,479.47');
    expect(user).toContain('ILOE benefit rate: 60%');
  });
});

describe('buildWordingInput, on the seed figures', () => {
  const r = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
  const s = scoreReadiness(r, SEED_DEBTS, SEED_BUDGET);
  const input = buildWordingInput(SEED_PROFILE, r, s);

  it('produces a fact sheet that validates against itself', () => {
    // The strongest accept-direction test there is: everything the model was
    // shown must be sayable, or the feature rejects its own input.
    expect(validateWording(factLines(input).join(' '), input)).toEqual({ ok: true, offending: [] });
  });

  it('accepts a faithful sentence about the seed settlement and rejects an invented one', () => {
    const faithful = `Your final settlement comes to AED ${moneyPrecise(r.settlement.finalSettlement)}.`;
    expect(validateWording(faithful, input).ok).toBe(true);
    expect(validateWording('Your final settlement comes to AED 123,456.78.', input).ok).toBe(false);
  });

  it('keeps digits out of the notes, so the allowed set is exactly the figures', () => {
    for (const note of input.notes) expect(note).not.toMatch(/\d/);
  });

  it('changes its digest when any figure changes', () => {
    const p2 = { ...SEED_PROFILE, basicSalary: SEED_PROFILE.basicSalary + 1 };
    const r2 = computeReadiness(p2, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
    const s2 = scoreReadiness(r2, SEED_DEBTS, SEED_BUDGET);
    expect(wordingDigest(buildWordingInput(p2, r2, s2))).not.toBe(wordingDigest(input));
  });

  it('derives the allowed set from the rendered lines, not a parallel list', () => {
    // The month counts live only inside scenario labels; if this fails, the
    // allowed set has drifted from what the model is actually shown.
    const allowed = allowedNumbers(input);
    for (const sc of r.scenarios) expect(allowed).toContain(sc.months);
  });
});
