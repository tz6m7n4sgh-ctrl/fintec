import { describe, expect, it } from 'vitest';

import {
  ASK_SCREENS,
  answerSegments,
  askFactLines,
  buildAskInput,
  buildAskPrompt,
  citedRoutes,
  NO_ANSWER,
  validateAnswer,
  type AskInput,
  type AskModel,
} from './ask';
import { UNVERIFIED_BASIS } from '@/lib/engine/citations';
import { computeReadiness, currentSpend, survivalSpend } from '@/lib/engine/uae';
import { scoreReadiness } from '@/lib/engine/readiness';
import { DEFAULT_PREFS } from '@/lib/settings/notifications';
import {
  SEED_BUDGET,
  SEED_DEBTS,
  SEED_INCOME,
  SEED_PAYMENTS,
  SEED_PROFILE,
  SEED_TRANSACTIONS,
  SEED_UPLOADS,
} from '@/lib/data/seed';

/**
 * HAD-119's warranty has two clauses where HAD-118's had one: no number the
 * fact sheet does not carry, and no claim without a screen to prove it. The
 * second is what stops the surface becoming a confident narrator of things
 * nobody computed — an answer from the model's own knowledge of UAE law has no
 * screen to cite, so the citation rule catches what a numeric check cannot.
 */

/** A hand-built input small enough that every assertion is legible. */
const INPUT: AskInput = {
  facts: [
    { label: 'End-of-service gratuity paid', value: 87479.47, unit: 'aed', route: '/entitlement' },
    { label: 'Gratuity accrual days per year in the first five years', value: 21, unit: 'count', route: '/report' },
    { label: 'Years of service', value: 7.33, unit: 'years', route: '/report' },
    { label: 'Runway in months', value: 9.2, unit: 'months', route: '/money' },
  ],
  notes: [],
};

function seedModel(): AskModel {
  const readiness = computeReadiness(SEED_PROFILE, SEED_BUDGET, SEED_PAYMENTS, SEED_INCOME);
  return {
    profile: SEED_PROFILE,
    readiness,
    score: scoreReadiness(readiness, SEED_DEBTS, SEED_BUDGET),
    payments: SEED_PAYMENTS,
    uploads: SEED_UPLOADS,
    transactions: SEED_TRANSACTIONS,
    notificationPrefs: DEFAULT_PREFS,
    currentTotal: currentSpend(SEED_BUDGET),
    survivalTotal: survivalSpend(SEED_BUDGET),
  };
}

describe('buildAskInput', () => {
  it('attaches a known route to every fact', () => {
    const input = buildAskInput(seedModel());
    expect(input.facts.length).toBeGreaterThan(30);
    for (const f of input.facts) {
      expect(ASK_SCREENS[f.route]).toBeDefined();
    }
  });

  it('produces a fact sheet whose own lines validate as an answer', () => {
    const input = buildAskInput(seedModel());
    // A faithful answer built from two real fact lines, cited as instructed.
    const gratuity = input.facts.find((f) => f.label === 'End-of-service gratuity paid');
    const text = `Your gratuity line is AED ${gratuity!.value.toFixed(2)} [/entitlement], and the working is on the report [/report].`;
    const verdict = validateAnswer(text, input);
    expect(verdict.ok).toBe(true);
  });

  it('keeps the notes digit-free so the allowed set stays exactly the figures', () => {
    const input = buildAskInput(seedModel());
    for (const note of input.notes) {
      expect(note).not.toMatch(/\d/);
    }
  });
});

describe('validateAnswer — the numbers clause', () => {
  it('accepts faithful prose with a citation', () => {
    const v = validateAnswer('Your gratuity is AED 87,479.47 [/entitlement].', INPUT);
    expect(v).toEqual({ ok: true, kind: 'answer', routes: ['/entitlement'] });
  });

  it('rejects an invented number even when a screen is cited', () => {
    const v = validateAnswer('Your gratuity is AED 91,479.47 [/entitlement].', INPUT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('numbers');
  });
});

describe('validateAnswer — the proof clause', () => {
  it('rejects an answer that cites no screen at all', () => {
    const v = validateAnswer('Your gratuity is AED 87,479.47, per UAE law.', INPUT);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('screens');
  });

  it('rejects an answer citing a screen this app does not have', () => {
    const v = validateAnswer('See your gratuity of AED 87,479.47 [/dashboard].', INPUT);
    expect(v.ok).toBe(false);
    if (!v.ok && v.reason === 'screens') expect(v.offending).toEqual(['/dashboard']);
  });

  it('accepts the fixed refusal without a citation — the one excused reply', () => {
    expect(validateAnswer(NO_ANSWER, INPUT)).toEqual({ ok: true, kind: 'no-answer' });
  });
});

describe('answerSegments', () => {
  it('splits prose around citations into text and links', () => {
    const segs = answerSegments('Gratuity AED 87,479.47 [/entitlement], worked through [/report].');
    expect(segs).toEqual([
      { type: 'text', text: 'Gratuity AED 87,479.47 ' },
      { type: 'link', route: '/entitlement' },
      { type: 'text', text: ', worked through ' },
      { type: 'link', route: '/report' },
      { type: 'text', text: '.' },
    ]);
  });
});

describe('buildAskPrompt', () => {
  it('forbids the model its own knowledge of UAE law and demands the refusal sentence', () => {
    const { system } = buildAskPrompt(INPUT, 'What is the ILOE rate?');
    expect(system).toContain('Do not use your own knowledge of UAE law');
    expect(system).toContain(NO_ANSWER);
    expect(system).toContain(UNVERIFIED_BASIS);
  });

  it('shows every fact with its route, and the question last', () => {
    const { user } = buildAskPrompt(INPUT, 'How long does my money last?');
    for (const line of askFactLines(INPUT)) expect(user).toContain(line);
    expect(user.trimEnd().endsWith('How long does my money last?')).toBe(true);
  });
});

describe('citedRoutes', () => {
  it('reads every bracketed route, in order', () => {
    expect(citedRoutes('a [/report] b [/money] c')).toEqual(['/report', '/money']);
  });
});
