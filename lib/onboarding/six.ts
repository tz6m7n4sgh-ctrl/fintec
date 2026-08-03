/**
 * The six answers, and what it costs to leave one out.
 *
 * ## Why this does not reuse the profile form's reader
 *
 * `app/profile/actions.ts` reads a blank number as zero, and for that form it is
 * right to: most of its sixteen boxes are genuinely zero for most people, and
 * forcing a 0 into every one would be worse than useless.
 *
 * The first run is the opposite case. Decision P2-5 is **six fields, then an
 * answer, with no invented defaults** — because these six are the only inputs
 * to the headline figure, and a substituted zero here does not produce a
 * slightly-off number, it produces a confident wrong one. A blank basic salary
 * read as zero gives a gratuity of exactly AED 0, rendered in 38px, to somebody
 * who has just been dismissed.
 *
 * So blank means *unanswered* here, and every field states what leaving it
 * blank does rather than quietly filling it in.
 *
 * ## Every problem at once
 *
 * Problems accumulate rather than short-circuit. A form that reveals its
 * objections one at a time makes a person submit six times to learn six things,
 * and this one is being filled in by somebody holding a termination letter.
 */

import { isBlank, numberError, parseFormNumber } from '../forms/numbers';

export type SixFieldName =
  | 'employmentStart'
  | 'expectedLastDay'
  | 'basicSalary'
  | 'grossSalary'
  | 'unpaidLeaveDays'
  | 'unusedLeaveDays';

export interface SixField {
  name: SixFieldName;
  label: string;
  kind: 'date' | 'money' | 'days';
  /** What this field decides — shown under the input, always. */
  help: string;
  /** What leaving it blank costs — shown only when it is blank. */
  blankCost: string;
}

/**
 * The six, in the order they are asked.
 *
 * Dates first because service length is the spine, then the salary pair, then
 * the two leave figures. Basic and gross sit adjacent on purpose: the
 * difference between them is the single most consequential thing a person can
 * get wrong, and separating them would hide that.
 */
export const SIX_FIELDS: SixField[] = [
  {
    name: 'employmentStart',
    label: 'Employment start',
    kind: 'date',
    help: 'Service length is counted from here.',
    blankCost:
      'Without a start date there is no service length, so there is no gratuity — not a smaller one, none. This is the one field with no way round it.',
  },
  {
    name: 'expectedLastDay',
    label: 'Expected last day',
    kind: 'date',
    help: 'Every deadline is counted from this date.',
    blankCost:
      'Without a last day there is no figure and no deadline. If nothing is fixed yet, put the date you are planning around — you can move it afterwards.',
  },
  {
    name: 'basicSalary',
    label: 'Basic salary',
    kind: 'money',
    help: 'Gratuity is calculated on this alone. Take it from your MOHRE contract.',
    blankCost:
      'Gratuity and leave encashment are both calculated from basic salary. We will not guess it — a guessed salary produces a figure that looks right and is not.',
  },
  {
    name: 'grossSalary',
    label: 'Gross salary',
    kind: 'money',
    help: 'Basic plus allowances. Used only for notice paid in lieu.',
    blankCost:
      'Notice paid in lieu is calculated on gross. If it is the same as your basic — no allowances — enter the same figure.',
  },
  {
    name: 'unpaidLeaveDays',
    label: 'Unpaid leave taken',
    kind: 'days',
    help: 'Deducted from service before gratuity is worked out.',
    blankCost: 'Blank is not zero. If you took none, enter 0 — we will not assume it for you.',
  },
  {
    name: 'unusedLeaveDays',
    label: 'Unused leave owed to you',
    kind: 'days',
    help: 'Encashed at basic salary ÷ 30 per day.',
    blankCost: 'Blank is not zero. If none is owed, enter 0 — we will not assume it for you.',
  },
];

export interface SixValues {
  employmentStart: string;
  expectedLastDay: string;
  basicSalary: number;
  grossSalary: number;
  unpaidLeaveDays: number;
  unusedLeaveDays: number;
}

export interface Problem {
  /** `null` when the problem is between two fields rather than in one. */
  field: SixFieldName | null;
  message: string;
}

export type SixReading = { ok: true; values: SixValues } | { ok: false; problems: Problem[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely a well-shaped string.
 *
 * `new Date('2026-02-31')` rolls forward to 3 March rather than failing, so the
 * round trip through `toISOString` is the check: if the date the browser gives
 * back is not the date we put in, the date does not exist.
 */
function isRealDate(iso: string): boolean {
  if (!ISO.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const FIELD = Object.fromEntries(SIX_FIELDS.map((f) => [f.name, f])) as Record<
  SixFieldName,
  SixField
>;

/**
 * Reads all six, reporting everything wrong with them.
 *
 * Takes a getter rather than `FormData` so the rules can be tested without
 * building a form, and so the same reading runs on the server action and in the
 * client preview without two copies drifting apart.
 */
export function readSix(get: (name: string) => string): SixReading {
  const problems: Problem[] = [];

  const dates: Partial<Record<'employmentStart' | 'expectedLastDay', string>> = {};
  for (const name of ['employmentStart', 'expectedLastDay'] as const) {
    const raw = get(name).trim();
    if (isBlank(raw)) {
      problems.push({ field: name, message: FIELD[name].blankCost });
      continue;
    }
    if (!isRealDate(raw)) {
      problems.push({
        field: name,
        message: `${FIELD[name].label} is not a date we can read. Use the date picker, or type it as YYYY-MM-DD.`,
      });
      continue;
    }
    dates[name] = raw;
  }

  const numbers: Partial<Record<SixFieldName, number>> = {};
  for (const name of [
    'basicSalary',
    'grossSalary',
    'unpaidLeaveDays',
    'unusedLeaveDays',
  ] as const) {
    const raw = get(name);
    if (isBlank(raw)) {
      problems.push({ field: name, message: FIELD[name].blankCost });
      continue;
    }
    const parsed = parseFormNumber(raw);
    if (!parsed.ok) {
      problems.push({ field: name, message: numberError(FIELD[name].label, parsed.reason) });
      continue;
    }
    numbers[name] = parsed.value;
  }

  /*
   * Cross-field checks, only where both halves were readable. Telling somebody
   * their last day precedes a start date they never entered is noise.
   */
  if (dates.employmentStart && dates.expectedLastDay) {
    if (dates.expectedLastDay < dates.employmentStart) {
      problems.push({
        field: 'expectedLastDay',
        message:
          'Your last day is before your employment start. One of the two dates is wrong — we will not compute negative service.',
      });
    }
  }

  if (numbers.basicSalary !== undefined && numbers.grossSalary !== undefined) {
    if (numbers.grossSalary < numbers.basicSalary) {
      problems.push({
        field: 'grossSalary',
        message:
          'Gross is below basic. Gross includes allowances, so it is always the larger figure — these two may be the wrong way round.',
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    values: {
      employmentStart: dates.employmentStart!,
      expectedLastDay: dates.expectedLastDay!,
      basicSalary: numbers.basicSalary!,
      grossSalary: numbers.grossSalary!,
      unpaidLeaveDays: numbers.unpaidLeaveDays!,
      unusedLeaveDays: numbers.unusedLeaveDays!,
    },
  };
}

/**
 * The line under a blocked submit.
 *
 * Counts what is missing separately from what is wrong, because they are
 * different jobs for the person reading: one is typing, the other is checking.
 */
export function summariseProblems(problems: Problem[], get: (name: string) => string): string {
  const missing = problems.filter((p) => p.field !== null && isBlank(get(p.field))).length;
  const wrong = problems.length - missing;

  const parts: string[] = [];
  if (missing > 0) parts.push(`${missing} ${missing === 1 ? 'answer' : 'answers'} still needed`);
  if (wrong > 0) parts.push(`${wrong} to correct`);
  return parts.join(', ') + '.';
}
