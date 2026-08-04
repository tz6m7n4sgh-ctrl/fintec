/**
 * Plain-language wording of the settlement explanation (HAD-118, workstream D1).
 *
 * The AI layer WORDS the deterministic breakdown; it never computes it. This
 * module is the part of that promise that can be tested: it builds the fact
 * sheet the model is shown, the prompt around it, and the validator that
 * decides whether a generation is allowed anywhere near the screen.
 *
 * ## Why the validator exists
 *
 * This project's signature failure is a plausible wrong answer. A language
 * model produces exactly those: a settlement total off by one digit reads as
 * confidently as the right one, and prose is where nobody re-checks arithmetic.
 * So the rule is structural rather than hoped for: **every number in the
 * generated text must already be present in the input.** A generation that
 * mentions any figure not derivable-by-formatting from the fact sheet is
 * discarded whole — not trimmed, not corrected — and the deterministic working
 * stands alone, with an honest note saying why.
 *
 * Deliberately pure (no `server-only`, no fetch, no env): the API call lives in
 * `anthropic.ts`, so everything that decides *what the model may say* is unit
 * testable without a key.
 */

import { UNVERIFIED_BASIS } from '@/lib/engine/citations';
import { RULES } from '@/lib/engine/uae';
import { moneyPrecise, months } from '@/lib/format/money';
import type { ReadinessScore } from '@/lib/engine/readiness';
import type { Profile, Readiness } from '@/lib/engine/types';

// --- The fact sheet ---------------------------------------------------------

/**
 * How a fact renders in the prompt, and which formatting variants of its value
 * the validator will accept back. One unit per way the report itself prints a
 * number, so the model sees the same renderings the screen shows.
 */
export type FactUnit = 'aed' | 'days' | 'years' | 'months' | 'rate' | 'count';

export interface WordingFact {
  label: string;
  value: number;
  unit: FactUnit;
}

export interface WordingInput {
  facts: WordingFact[];
  /**
   * Non-numeric context — eligibility, caps, the unlimited-runway case. Kept
   * separate from `facts` and written without digits, so the allowed-number
   * set stays exactly the set of figures.
   */
  notes: string[];
}

/**
 * The same data the deterministic working renders, flattened to labelled
 * figures. Everything here is already computed by the engine or copied from
 * the profile — the two `Math.min`/`Math.max` below reproduce the split the
 * report page itself draws, not new arithmetic the model is asked to do.
 *
 * Calendar dates are deliberately absent. A date in prose smuggles in numbers
 * ("14 March 2026") the validator would have to whitelist wholesale, so the
 * prompt forbids dates and the input carries only the day-count windows.
 */
export function buildWordingInput(
  profile: Profile,
  r: Readiness,
  s: ReadinessScore,
): WordingInput {
  const firstFiveYears = Math.min(r.service.serviceYears, 5);
  const laterYears = Math.max(r.service.serviceYears - 5, 0);

  const facts: WordingFact[] = [
    // Service
    { label: 'Service days counted, after unpaid leave', value: r.service.serviceDays, unit: 'count' },
    { label: 'Days per year used to convert service days to years', value: RULES.DAYS_PER_YEAR.value, unit: 'count' },
    { label: 'Years of service', value: r.service.serviceYears, unit: 'years' },
    // Gratuity
    { label: 'Monthly basic salary', value: profile.basicSalary, unit: 'aed' },
    { label: 'Monthly gross salary', value: profile.grossSalary, unit: 'aed' },
    { label: 'Days per month used to convert salary to a daily rate', value: RULES.DAYS_PER_MONTH.value, unit: 'count' },
    { label: 'Daily basic rate', value: r.gratuity.dailyBasic, unit: 'aed' },
    { label: 'Years counted at the first-five-years accrual rate', value: firstFiveYears, unit: 'years' },
    { label: 'Years counted at the after-five-years accrual rate', value: laterYears, unit: 'years' },
    { label: 'Gratuity accrual days per year in the first five years', value: RULES.GRATUITY_DAYS_FIRST_5Y.value, unit: 'count' },
    { label: 'Gratuity accrual days per year after five years', value: RULES.GRATUITY_DAYS_AFTER_5Y.value, unit: 'count' },
    { label: 'Total gratuity days accrued', value: r.gratuity.gratuityDays, unit: 'days' },
    { label: 'Gratuity accrued before the cap', value: r.gratuity.gratuityRaw, unit: 'aed' },
    { label: 'Gratuity cap in months of basic salary', value: RULES.GRATUITY_CAP_MONTHS.value, unit: 'count' },
    { label: 'Legal cap on total gratuity', value: r.gratuity.gratuityCap, unit: 'aed' },
    { label: 'End-of-service gratuity paid', value: r.settlement.gratuity, unit: 'aed' },
    // The rest of the settlement
    { label: 'Unused leave days', value: profile.unusedLeaveDays, unit: 'count' },
    { label: 'Unused leave encashment', value: r.settlement.leaveEncashment, unit: 'aed' },
    { label: 'Notice days paid in lieu', value: profile.noticeDaysPaidInLieu, unit: 'count' },
    { label: 'Notice paid in lieu', value: r.settlement.noticePayInLieu, unit: 'aed' },
    { label: 'Other amounts owed to you', value: r.settlement.otherOwedToEmployee, unit: 'aed' },
    { label: 'Amounts you owe the employer, deducted', value: r.settlement.owedToEmployer, unit: 'aed' },
    { label: 'Total final settlement', value: r.settlement.finalSettlement, unit: 'aed' },
    // ILOE
    { label: 'Average basic salary over the last six months, for ILOE', value: profile.iloeAvgBasic6m, unit: 'aed' },
    { label: 'ILOE benefit rate', value: RULES.ILOE_RATE.value, unit: 'rate' },
    { label: 'ILOE monthly cap', value: r.iloe.monthlyCap, unit: 'aed' },
    { label: 'ILOE monthly benefit', value: r.iloe.monthlyBenefit, unit: 'aed' },
    { label: 'ILOE months paid', value: RULES.ILOE_MAX_MONTHS.value, unit: 'count' },
    { label: 'ILOE total', value: r.iloe.iloeTotal, unit: 'aed' },
    // Runway
    { label: 'Cash savings', value: profile.cashSavings, unit: 'aed' },
    { label: 'Other liquid assets', value: profile.otherLiquidAssets, unit: 'aed' },
    { label: 'Total resources', value: r.runway.totalResources, unit: 'aed' },
    { label: 'Survival monthly spending', value: r.runway.survivalSpend, unit: 'aed' },
    { label: 'Monthly side income', value: r.runway.monthlySideIncome, unit: 'aed' },
    { label: 'Net monthly burn', value: r.runway.netMonthlyBurn, unit: 'aed' },
    // Deadlines, as windows rather than dates
    { label: 'Days the employer has to pay the settlement', value: RULES.SETTLEMENT_DUE_DAYS.value, unit: 'count' },
    { label: 'Days to claim ILOE after the last working day', value: RULES.ILOE_CLAIM_DAYS.value, unit: 'count' },
    { label: 'Visa grace period in days', value: profile.visaGraceDays, unit: 'count' },
    // Readiness
    { label: 'Readiness score', value: s.total, unit: 'count' },
    { label: 'Readiness score maximum', value: s.max, unit: 'count' },
  ];

  // Runway is the one figure that can be Infinity (side income covers the
  // spending). `months()` would render "Unlimited", which is a word, not a
  // number — say it as a note and keep the fact list finite.
  if (Number.isFinite(r.runway.runwayMonths)) {
    facts.push({ label: 'Runway in months', value: r.runway.runwayMonths, unit: 'months' });
  }

  // Scenario rows carry their month count in the label; `allowedNumbers` reads
  // the rendered lines, so "after 6 months" is admitted without a second fact.
  for (const sc of r.scenarios) {
    facts.push({ label: `Resources left after ${sc.months} months`, value: sc.remaining, unit: 'aed' });
  }

  const notes: string[] = [`Readiness band: ${s.band}.`];
  if (r.gratuity.ineligible) {
    notes.push('Gratuity accrued but is not payable: service is below the one-year minimum, so the paid gratuity is zero.');
  }
  if (r.gratuity.capApplied) {
    notes.push('The accrued gratuity exceeds the legal cap, so the capped figure is what is paid.');
  }
  if (!r.iloe.eligible) {
    notes.push('ILOE: not eligible on the current answers, so the benefit is zero.');
  }
  if (r.iloe.capApplied) {
    notes.push('ILOE: the monthly cap applies.');
  }
  if (!Number.isFinite(r.runway.runwayMonths)) {
    notes.push('Runway: unlimited — side income covers survival spending, so the money does not run out.');
  }

  return { facts, notes };
}

/** One fact, rendered the way the report itself would print it. */
export function factLine(f: WordingFact): string {
  switch (f.unit) {
    case 'aed':
      return `${f.label}: AED ${moneyPrecise(f.value)}`;
    case 'years':
      return `${f.label}: ${f.value.toFixed(3)} years`;
    case 'days':
      return `${f.label}: ${Number(f.value.toFixed(2))} days`;
    case 'months':
      return `${f.label}: ${months(f.value)} months`;
    case 'rate':
      return `${f.label}: ${Number((f.value * 100).toFixed(2))}%`;
    case 'count':
      return `${f.label}: ${f.value}`;
  }
}

export function factLines(input: WordingInput): string[] {
  return input.facts.map(factLine);
}

// --- The validator ----------------------------------------------------------

/**
 * Numeric tokens as a reader would see them: `87,479.47`, `87479.47`, `12,000`,
 * `3.5`, `21`. The grouped alternative comes first so `87,479.47` is one token
 * rather than `87` + `479.47`.
 */
const NUMBER_TOKEN = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): { raw: string; value: number }[] {
  return [...text.matchAll(NUMBER_TOKEN)].map((m) => ({
    raw: m[0],
    value: Number(m[0].replace(/,/g, '')),
  }));
}

/**
 * The formatting variants of one value the validator accepts.
 *
 * The report legitimately prints the same figure at different precisions —
 * `moneyPrecise` gives 87,479.47 where the runway card rounds it to 87,479 —
 * so roundings at 0–3 decimal places count as the same number. A fraction
 * additionally admits its percentage form (0.6 renders as 60%). Absolute
 * values, because deductions print with a minus sign the token regex does not
 * capture.
 *
 * What is deliberately NOT here: any tolerance band. "About 87,500" is a
 * number the input does not contain, and the whole point is that it fails.
 */
function variantsOf(v: number): number[] {
  if (!Number.isFinite(v)) return [];
  const a = Math.abs(v);
  const out = [a, Number(a.toFixed(0)), Number(a.toFixed(1)), Number(a.toFixed(2)), Number(a.toFixed(3))];
  if (a > 0 && a < 1) {
    const p = a * 100;
    out.push(p, Number(p.toFixed(0)), Number(p.toFixed(1)), Number(p.toFixed(2)));
  }
  return out;
}

/**
 * Every number the generation is allowed to contain.
 *
 * Two sources: the raw fact values, and the numbers as they appear in the
 * rendered fact lines. The second covers what rendering itself introduces —
 * the month counts embedded in scenario labels, the percentage form of a rate
 * — so the allowed set is exactly "what the model was shown", not a hand-kept
 * parallel list that could drift from it.
 */
export function allowedNumbers(input: WordingInput): number[] {
  const out = new Set<number>();
  for (const f of input.facts) {
    for (const v of variantsOf(f.value)) out.add(v);
  }
  for (const line of factLines(input)) {
    for (const t of extractNumbers(line)) {
      for (const v of variantsOf(t.value)) out.add(v);
    }
  }
  return [...out];
}

export interface WordingVerdict {
  ok: boolean;
  /** The offending tokens as written, for the log — never shown as prose. */
  offending: string[];
}

/**
 * Accepts the generation only if every numeric token in it is an allowed
 * formatting variant of an input figure. One invented number rejects the whole
 * text: a generation that gets one figure wrong has forfeited the trust the
 * rest of it would trade on.
 */
export function validateWording(text: string, input: WordingInput): WordingVerdict {
  const allowed = allowedNumbers(input);
  const offending = extractNumbers(text)
    .filter((t) => !allowed.some((a) => Math.abs(a - t.value) < 1e-6))
    .map((t) => t.raw);
  return { ok: offending.length === 0, offending: [...new Set(offending)] };
}

// --- The prompt -------------------------------------------------------------

/**
 * The prompt states the two constraints the validator and the page then
 * enforce anyway: no numbers beyond the fact sheet, and no smoothing over the
 * unverified basis. Belt and braces on purpose — the prompt is the polite
 * request, the validator is the law, and the always-rendered basis panel on
 * the page does not depend on the model complying at all.
 */
export function buildPrompt(input: WordingInput): { system: string; user: string } {
  const system = [
    'You word an already-computed UAE end-of-service breakdown in plain language.',
    'You are a wording layer only: every figure was computed deterministically before you were called, and nothing you write changes it. Do not calculate anything.',
    '',
    'Hard rules:',
    '- Use only figures that appear on the fact sheet, copied as given. You may drop thousands separators or round to whole dirhams, but you must not derive, add, subtract, multiply, divide, estimate, or introduce any other number.',
    '- Do not mention calendar dates or year numbers, and do not count down to anything.',
    `- These figures are calculated from rules nobody has verified. Say so plainly and without softening — the app's own wording is: "${UNVERIFIED_BASIS}" Carry that meaning; do not present any figure as checked or official.`,
    '- Write at most four short paragraphs of plain prose in the second person. No headings, no bullet points, no markdown.',
  ].join('\n');

  const user = [
    'Fact sheet — every figure below is final and already computed:',
    ...factLines(input),
    '',
    'Context:',
    ...input.notes,
    '',
    'Word this breakdown for the person it belongs to.',
  ].join('\n');

  return { system, user };
}

// --- Freshness --------------------------------------------------------------

/**
 * FNV-1a over the rendered input, so the page can tell whether a stored
 * wording still describes the figures on screen. Not cryptographic and not
 * meant to be — it guards against staleness, not tampering; the wording rides
 * in the user's own cookie about the user's own figures.
 */
export function wordingDigest(input: WordingInput): string {
  let h = 0x811c9dc5;
  for (const line of [...factLines(input), ...input.notes]) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    // Line separator, so ["ab","c"] and ["a","bc"] differ.
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
