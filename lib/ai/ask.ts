/**
 * "Ask anything, grounded in the user's own figures" (HAD-119, workstream D2).
 *
 * The ask surface answers a free-text question from exactly two sources: the
 * read model's figures and the engine's outputs — never the model's own
 * knowledge of UAE law. This module is the testable half of that promise: the
 * fact sheet the model is shown (each fact carrying the route of the screen
 * that proves it), the prompt around it, and the validator that decides
 * whether an answer is allowed anywhere near the screen.
 *
 * ## The two grounding rules, both structural
 *
 * 1. **Numbers**: every figure in the answer must already be on the fact sheet.
 *    This reuses the HAD-118 validator wholesale — an invented number discards
 *    the whole answer, exactly as it does for the report wording.
 * 2. **Proof**: every answer must cite at least one screen of this app, as a
 *    bracketed route copied off the fact sheet (`[/report]`). An answer that
 *    cites no known screen is not an answer this app can stand behind — the
 *    page falls back to "I do not have that" rather than render it.
 *
 * A question the fact sheet cannot answer gets the fixed sentence `NO_ANSWER`,
 * never an inference. The prompt asks for that; the citation rule is what
 * enforces it, because a from-general-knowledge answer has no screen to point
 * at.
 *
 * Deliberately pure (no `server-only`, no fetch, no env), like `wording.ts`:
 * the API call lives in `anthropic.ts`, so everything that decides *what the
 * model may say* is unit testable without a key.
 */

import { UNVERIFIED_BASIS } from '@/lib/engine/citations';
import { RULES } from '@/lib/engine/uae';
import {
  factLine,
  validateWording,
  type FactUnit,
  type WordingInput,
} from './wording';
import type { NotificationPrefs } from '@/lib/settings/notifications';
import type { ReadinessScore } from '@/lib/engine/readiness';
import type { Profile, Readiness, ScheduledPayment } from '@/lib/engine/types';

// --- The screens ------------------------------------------------------------

/**
 * Every screen an answer may cite, with the words the prompt and the rendered
 * link both use. One table on purpose: the routes the model is shown, the
 * routes the validator accepts, and the links the page renders cannot drift
 * apart because they are the same object.
 */
export const ASK_SCREENS = {
  '/entitlement': {
    name: 'Your entitlement',
    shows: 'the settlement total, its line items, and the deadlines counted from your last day',
  },
  '/report': {
    name: 'Explain your numbers',
    shows: 'the full working behind every figure — gratuity, ILOE, runway, scenarios and readiness',
  },
  '/money': {
    name: 'Money',
    shows: 'the runway, total resources and net monthly burn',
  },
  '/budget': {
    name: 'Budget',
    shows: 'current spending against the survival plan',
  },
  '/calendar': {
    name: 'Payment calendar',
    shows: 'scheduled outflows, cheques and legal deadlines',
  },
  '/documents': {
    name: 'Documents',
    shows: 'uploaded statements and the transactions read from them',
  },
  '/you': {
    name: 'You',
    shows: 'the answers you saved — salaries, savings, leave and notice',
  },
  '/settings': {
    name: 'Settings',
    shows: 'sign-in devices, reminder settings and your data',
  },
} as const;

export type AskRoute = keyof typeof ASK_SCREENS;

export function isAskRoute(route: string): route is AskRoute {
  return route in ASK_SCREENS;
}

// --- The fact sheet ---------------------------------------------------------

/** A wording fact plus the screen that proves it. */
export interface AskFact {
  label: string;
  value: number;
  unit: FactUnit;
  route: AskRoute;
}

/**
 * Structurally a `WordingInput` whose facts also carry routes, so the HAD-118
 * numeric validator and digest apply to it unchanged.
 */
export interface AskInput {
  facts: AskFact[];
  notes: string[];
}

/**
 * The slice of the read model the ask surface needs. Narrower than `ReadModel`
 * on purpose: the tests can assemble this from the seed and the engine without
 * touching the store, exactly as `wording.test.ts` does.
 */
export interface AskModel {
  profile: Profile;
  readiness: Readiness;
  score: ReadinessScore;
  payments: ScheduledPayment[];
  uploads: readonly unknown[];
  transactions: readonly unknown[];
  notificationPrefs: NotificationPrefs;
  currentTotal: number;
  survivalTotal: number;
}

/**
 * The figures the app can answer questions about, each tagged with the screen
 * that proves it. Everything here is already computed by the engine or copied
 * from the stored answers — the two `Math.min`/`Math.max` reproduce the split
 * the report page itself draws, not new arithmetic the model is asked to do.
 *
 * Calendar dates are deliberately absent, for the same reason as HAD-118: a
 * date in prose smuggles in numbers the validator would have to whitelist
 * wholesale, so the sheet carries only day-count windows.
 */
export function buildAskInput(m: AskModel): AskInput {
  const r = m.readiness;
  const p = m.profile;
  const firstFiveYears = Math.min(r.service.serviceYears, 5);
  const laterYears = Math.max(r.service.serviceYears - 5, 0);

  const facts: AskFact[] = [
    // The saved answers — proven where they were entered and are shown.
    { label: 'Monthly basic salary', value: p.basicSalary, unit: 'aed', route: '/you' },
    { label: 'Monthly gross salary', value: p.grossSalary, unit: 'aed', route: '/you' },
    { label: 'Cash savings', value: p.cashSavings, unit: 'aed', route: '/you' },
    { label: 'Other liquid assets', value: p.otherLiquidAssets, unit: 'aed', route: '/you' },
    { label: 'Unused leave days', value: p.unusedLeaveDays, unit: 'count', route: '/you' },
    { label: 'Notice days paid in lieu', value: p.noticeDaysPaidInLieu, unit: 'count', route: '/you' },
    { label: 'Visa grace period in days', value: p.visaGraceDays, unit: 'count', route: '/you' },

    // The settlement, line by line, as the entitlement answer prints it.
    { label: 'End-of-service gratuity paid', value: r.settlement.gratuity, unit: 'aed', route: '/entitlement' },
    { label: 'Unused leave encashment', value: r.settlement.leaveEncashment, unit: 'aed', route: '/entitlement' },
    { label: 'Notice paid in lieu', value: r.settlement.noticePayInLieu, unit: 'aed', route: '/entitlement' },
    { label: 'Other amounts owed to you', value: r.settlement.otherOwedToEmployee, unit: 'aed', route: '/entitlement' },
    { label: 'Amounts you owe the employer, deducted', value: r.settlement.owedToEmployer, unit: 'aed', route: '/entitlement' },
    { label: 'Total final settlement', value: r.settlement.finalSettlement, unit: 'aed', route: '/entitlement' },
    { label: 'Days the employer has to pay the settlement', value: RULES.SETTLEMENT_DUE_DAYS.value, unit: 'count', route: '/entitlement' },
    { label: 'Days to claim ILOE after the last working day', value: RULES.ILOE_CLAIM_DAYS.value, unit: 'count', route: '/entitlement' },

    // The working behind those lines — the report shows every equation.
    { label: 'Service days counted, after unpaid leave', value: r.service.serviceDays, unit: 'count', route: '/report' },
    { label: 'Days per year used to convert service days to years', value: RULES.DAYS_PER_YEAR.value, unit: 'count', route: '/report' },
    { label: 'Years of service', value: r.service.serviceYears, unit: 'years', route: '/report' },
    { label: 'Days per month used to convert salary to a daily rate', value: RULES.DAYS_PER_MONTH.value, unit: 'count', route: '/report' },
    { label: 'Daily basic rate', value: r.gratuity.dailyBasic, unit: 'aed', route: '/report' },
    { label: 'Years counted at the first-five-years accrual rate', value: firstFiveYears, unit: 'years', route: '/report' },
    { label: 'Years counted at the after-five-years accrual rate', value: laterYears, unit: 'years', route: '/report' },
    { label: 'Gratuity accrual days per year in the first five years', value: RULES.GRATUITY_DAYS_FIRST_5Y.value, unit: 'count', route: '/report' },
    { label: 'Gratuity accrual days per year after five years', value: RULES.GRATUITY_DAYS_AFTER_5Y.value, unit: 'count', route: '/report' },
    { label: 'Total gratuity days accrued', value: r.gratuity.gratuityDays, unit: 'days', route: '/report' },
    { label: 'Gratuity accrued before the cap', value: r.gratuity.gratuityRaw, unit: 'aed', route: '/report' },
    { label: 'Gratuity cap in months of basic salary', value: RULES.GRATUITY_CAP_MONTHS.value, unit: 'count', route: '/report' },
    { label: 'Legal cap on total gratuity', value: r.gratuity.gratuityCap, unit: 'aed', route: '/report' },
    { label: 'Average basic salary over the last six months, for ILOE', value: p.iloeAvgBasic6m, unit: 'aed', route: '/report' },
    { label: 'ILOE benefit rate', value: RULES.ILOE_RATE.value, unit: 'rate', route: '/report' },
    { label: 'ILOE monthly cap', value: r.iloe.monthlyCap, unit: 'aed', route: '/report' },
    { label: 'ILOE monthly benefit', value: r.iloe.monthlyBenefit, unit: 'aed', route: '/report' },
    { label: 'ILOE months paid', value: RULES.ILOE_MAX_MONTHS.value, unit: 'count', route: '/report' },
    { label: 'ILOE total', value: r.iloe.iloeTotal, unit: 'aed', route: '/report' },
    { label: 'Readiness score', value: m.score.total, unit: 'count', route: '/report' },
    { label: 'Readiness score maximum', value: m.score.max, unit: 'count', route: '/report' },

    // How long the money lasts — the Money page's hero.
    { label: 'Total resources', value: r.runway.totalResources, unit: 'aed', route: '/money' },
    { label: 'Monthly side income', value: r.runway.monthlySideIncome, unit: 'aed', route: '/money' },
    { label: 'Net monthly burn', value: r.runway.netMonthlyBurn, unit: 'aed', route: '/money' },

    // Spending — the budget's two totals.
    { label: 'Current monthly spending', value: m.currentTotal, unit: 'aed', route: '/budget' },
    { label: 'Survival monthly spending', value: m.survivalTotal, unit: 'aed', route: '/budget' },

    // What is scheduled and what has been read in.
    { label: 'Scheduled payments and obligations on the calendar', value: m.payments.length, unit: 'count', route: '/calendar' },
    { label: 'Bank statements uploaded', value: m.uploads.length, unit: 'count', route: '/documents' },
    { label: 'Transactions read from statements', value: m.transactions.length, unit: 'count', route: '/documents' },
  ];

  // Reminder lead times live in Settings; one fact per configured lead day.
  for (const d of m.notificationPrefs.leadDays) {
    facts.push({ label: 'Reminder lead time in days before a due date', value: d, unit: 'count', route: '/settings' });
  }

  // Same Infinity rule as the wording: "Unlimited" is a word, not a number.
  if (Number.isFinite(r.runway.runwayMonths)) {
    facts.push({ label: 'Runway in months', value: r.runway.runwayMonths, unit: 'months', route: '/money' });
  }

  for (const sc of r.scenarios) {
    facts.push({ label: `Resources left after ${sc.months} months`, value: sc.remaining, unit: 'aed', route: '/report' });
  }

  // Digit-free by the same test discipline as the wording notes, so the
  // allowed-number set stays exactly the set of figures.
  const notes: string[] = [`Readiness band: ${m.score.band}.`];
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

/** One fact as the prompt shows it: the report's rendering, plus its proof. */
export function askFactLine(f: AskFact): string {
  return `${factLine(f)} [${f.route}]`;
}

export function askFactLines(input: AskInput): string[] {
  return input.facts.map(askFactLine);
}

// --- The validator ----------------------------------------------------------

/**
 * The one sentence a question outside the fact sheet gets. Fixed and digit-free
 * so the validator can recognise it exactly; anything else the model says about
 * missing data has to survive the citation rule like any other answer.
 */
export const NO_ANSWER = 'I do not have that.';

export function isNoAnswer(text: string): boolean {
  return text.trim() === NO_ANSWER;
}

/** Bracketed route citations as the prompt requests them: `[/report]`. */
const CITATION = /\[(\/[a-z-]+)\]/g;

export function citedRoutes(text: string): string[] {
  return [...text.matchAll(CITATION)].map((m) => m[1]);
}

export type AskVerdict =
  | { ok: true; kind: 'no-answer' }
  | { ok: true; kind: 'answer'; routes: AskRoute[] }
  /** A number not on the fact sheet — the HAD-118 failure, same handling. */
  | { ok: false; reason: 'numbers'; offending: string[] }
  /** No known screen cited, or an unknown one — nothing on screen proves it. */
  | { ok: false; reason: 'screens'; offending: string[] };

/**
 * Accepts an answer only if every number in it is on the fact sheet AND it
 * cites at least one known screen (and no unknown ones — a link the app cannot
 * render is a claim the app cannot prove). Checked in that order so an answer
 * that fails both is reported as the numbers failure, the graver of the two.
 */
export function validateAnswer(text: string, input: AskInput): AskVerdict {
  if (isNoAnswer(text)) return { ok: true, kind: 'no-answer' };

  const numeric = validateWording(text, input);
  if (!numeric.ok) return { ok: false, reason: 'numbers', offending: numeric.offending };

  const cited = citedRoutes(text);
  const unknown = cited.filter((route) => !isAskRoute(route));
  const known = cited.filter(isAskRoute);
  if (known.length === 0 || unknown.length > 0) {
    return { ok: false, reason: 'screens', offending: [...new Set(unknown)] };
  }

  return { ok: true, kind: 'answer', routes: [...new Set(known)] };
}

// --- Rendering --------------------------------------------------------------

export type AnswerSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; route: AskRoute };

/**
 * Splits a validated answer into prose and screen links, so the page renders
 * `[/report]` as a link to the screen that proves the claim before it.
 * Defensive about unknown routes anyway — they stay as literal text rather
 * than become links to nowhere — but the validator never lets one through.
 */
export function answerSegments(text: string): AnswerSegment[] {
  const out: AnswerSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const route = m[1];
    if (!isAskRoute(route)) continue;
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    out.push({ type: 'link', route });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

// --- The prompt -------------------------------------------------------------

/**
 * Same belt-and-braces stance as the wording prompt: the prompt is the polite
 * request, the validator is the law. The one addition is the citation rule —
 * and the instruction that a question the sheet cannot answer gets `NO_ANSWER`
 * verbatim, which is also the only reply excused from citing a screen.
 */
export function buildAskPrompt(input: AskInput, question: string): { system: string; user: string } {
  const system = [
    "You answer one question about a person's own saved figures in a UAE end-of-service planning app.",
    'The fact sheet below is your entire knowledge. Do not use your own knowledge of UAE law, rates, or procedure: a legal question is answered only from the rule values on the sheet, on the app\'s own stated basis.',
    '',
    'Hard rules:',
    '- Use only figures that appear on the fact sheet, copied as given. You may drop thousands separators or round to whole dirhams, but you must not derive, add, subtract, multiply, divide, estimate, or introduce any other number.',
    '- Every claim must cite the screen that proves it, by copying the bracketed route from its fact line — for example [/report]. Cite only routes that appear on the fact sheet.',
    `- If the fact sheet does not contain what the question asks for, reply with exactly "${NO_ANSWER}" and nothing else. Never guess, infer, or answer from general knowledge.`,
    '- Do not mention calendar dates or year numbers, and do not count down to anything.',
    `- These figures are calculated from rules nobody has verified. Say so plainly and without softening — the app's own wording is: "${UNVERIFIED_BASIS}" Carry that meaning; do not present any figure as checked or official.`,
    '- Write at most two short paragraphs of plain prose in the second person. No headings, no bullet points, no markdown.',
  ].join('\n');

  const user = [
    'Screens in this app, by route:',
    ...Object.entries(ASK_SCREENS).map(([route, s]) => `${route} — ${s.name}: shows ${s.shows}`),
    '',
    'Fact sheet — every figure below is final and already computed; each line ends with the route of the screen that proves it:',
    ...askFactLines(input),
    '',
    'Context:',
    ...input.notes,
    '',
    'Question from the person these figures belong to:',
    question,
  ].join('\n');

  return { system, user };
}
