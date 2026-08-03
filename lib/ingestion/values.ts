/**
 * Reading a date and an amount out of a bank statement (US-28 / FR-L2 / R-2).
 *
 * ## Why this is not an LLM
 *
 * US-29 was written assuming every statement goes to a model, and that made the
 * whole of M3 wait on an API key. For a **delimited** statement that assumption
 * is wrong, and expensively so: a CSV already has its structure: the columns are
 * named, the rows are aligned, and the only hard part is knowing what the
 * characters in a cell mean. A deterministic parser answers that exactly, for
 * free, offline, and identically on every re-run.
 *
 * "Identically on every re-run" is the part that matters here rather than the
 * cost. A model that reads `03/08/2026` as March once and August the next time
 * produces two ledgers that are each individually plausible, and this project's
 * whole thesis is that a plausible wrong number is worse than a visible failure.
 *
 * PDFs still need a model, and nothing here pretends otherwise — see
 * `parse.ts`, which refuses them by name rather than mangling them.
 *
 * ## The one that will silently ruin a ledger
 *
 * `03/08/2026` is 3 August in the UAE and 8 March in the United States. Guess
 * wrong and every transaction moves by months: the salary lands in the wrong
 * quarter, the termination projection reads from the wrong window, and every
 * figure downstream is confidently incorrect. Nothing about the output *looks*
 * broken.
 *
 * So the order is inferred from the **whole column** and not from one cell, and
 * a column that stays genuinely ambiguous is refused rather than guessed. See
 * `detectDateOrder`.
 */

/** The order of the numeric components in a delimited date. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

export type DateOrderResult =
  | { order: DateOrder; reason: string }
  /** Every value fits both readings, so no evidence exists either way. */
  | { order: null; ambiguous: true; reason: string }
  /** Some values fit one reading and some the other. The column is not one format. */
  | { order: null; ambiguous: false; reason: string };

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** `1` → `01`, for building an ISO date. */
const pad = (n: number) => String(n).padStart(2, '0');

interface NumericParts {
  a: number;
  b: number;
  year: number;
  /** True when the year came first, e.g. `2026-08-03`. */
  yearFirst: boolean;
}

/**
 * Splits `03/08/2026`, `2026-08-03`, `3.8.26` into components, or null.
 *
 * Two-digit years are windowed at 70: `69` is 2069 and `70` is 1970. A bank
 * statement is never seventy years old, so the window only has to be wrong in a
 * direction that is obviously wrong rather than subtly so.
 */
function numericParts(value: string): NumericParts | null {
  const match = value.trim().match(/^(\d{1,4})[/\-. ](\d{1,2})[/\-. ](\d{1,4})$/);
  if (!match) return null;

  const [, first, second, third] = match;
  const widen = (text: string) => {
    const n = Number(text);
    if (text.length === 4) return n;
    return n >= 70 ? 1900 + n : 2000 + n;
  };

  // A four-digit leading component can only be a year.
  if (first.length === 4) {
    return { a: Number(second), b: Number(third), year: Number(first), yearFirst: true };
  }
  return { a: Number(first), b: Number(second), year: widen(third), yearFirst: false };
}

/** `03 Aug 2026`, `Aug 3, 2026`, `3-AUG-26`. Unambiguous by construction. */
function textualParts(value: string): { day: number; month: number; year: number } | null {
  const cleaned = value.trim().replace(/,/g, ' ').replace(/\s+/g, ' ');

  const dayFirst = cleaned.match(/^(\d{1,2})[ \-]([A-Za-z]{3,9})[ \-](\d{2,4})$/);
  const monthFirst = cleaned.match(/^([A-Za-z]{3,9})[ \-](\d{1,2})[ \-](\d{2,4})$/);
  const match = dayFirst ?? monthFirst;
  if (!match) return null;

  const [dayText, monthText, yearText] = dayFirst
    ? [match[1], match[2], match[3]]
    : [match[2], match[1], match[3]];

  const month = MONTH_NAMES[monthText.toLowerCase()];
  if (!month) return null;

  const year = yearText.length === 4
    ? Number(yearText)
    : Number(yearText) >= 70 ? 1900 + Number(yearText) : 2000 + Number(yearText);

  return { day: Number(dayText), month, year };
}

/** Whether a y/m/d triple is a date that exists. Rejects 31 February. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

/**
 * Works out which order a whole column of dates is written in.
 *
 * The rule is evidence, not preference. A value whose first component is above
 * twelve can only be a day, which settles the column as day-first; one whose
 * second component is above twelve settles it as month-first. A column
 * containing both kinds of evidence is not one format and is refused.
 *
 * A column where *no* value exceeds twelve in either position — a statement
 * covering only the first twelve days of a month, which is an ordinary thing
 * for a monthly statement to be — is genuinely ambiguous. There is no
 * defensible guess there, and picking the local convention would be a
 * coin-flip that shifts every row by months when it loses. The caller either
 * has a saved `parser_config` from a previous upload of the same bank's format,
 * or the file is refused with a message asking which it is.
 */
export function detectDateOrder(values: readonly string[]): DateOrderResult {
  let sawDayFirstEvidence = false;
  let sawMonthFirstEvidence = false;
  let sawNumeric = false;
  let sawIso = false;
  let sawTextual = false;
  let sawUnparseable = false;

  for (const value of values) {
    if (!value?.trim()) continue;

    if (textualParts(value)) {
      sawTextual = true;
      continue;
    }

    const parts = numericParts(value);
    if (!parts) {
      sawUnparseable = true;
      continue;
    }

    if (parts.yearFirst) {
      sawIso = true;
      continue;
    }

    sawNumeric = true;
    if (parts.a > 12) sawDayFirstEvidence = true;
    if (parts.b > 12) sawMonthFirstEvidence = true;
  }

  if (sawDayFirstEvidence && sawMonthFirstEvidence) {
    return {
      order: null,
      ambiguous: false,
      reason:
        'This date column contains values that cannot all be the same format — some have a day above 12 first, others have one second.',
    };
  }

  if (sawDayFirstEvidence) {
    return { order: 'dmy', reason: 'a value above 12 in the first position can only be a day' };
  }
  if (sawMonthFirstEvidence) {
    return { order: 'mdy', reason: 'a value above 12 in the second position can only be a day' };
  }

  /*
   * ISO and textual dates carry their own order, so a column made only of those
   * needs no inference. `ymd` is returned for both because `parseDate` reads
   * either shape regardless of the order it is handed — the order only ever
   * disambiguates the numeric day/month case.
   */
  if ((sawIso || sawTextual) && !sawNumeric) {
    return { order: 'ymd', reason: 'the dates name their own order' };
  }

  if (sawNumeric) {
    return {
      order: null,
      ambiguous: true,
      reason:
        'Every date in this file has a day of 12 or lower, so 03/08 could be 3 August or 8 March. Nothing in the file says which.',
    };
  }

  return {
    order: null,
    ambiguous: false,
    reason: sawUnparseable
      ? 'No value in this column looks like a date.'
      : 'This column is empty.',
  };
}

/**
 * One cell to an ISO `YYYY-MM-DD`, or null.
 *
 * `order` only ever decides between day-first and month-first. An ISO or
 * textual date names its own order and ignores the argument, which is why
 * `detectDateOrder` can return `ymd` for a textual column without that being a
 * claim about the digits.
 */
export function parseDate(value: string, order: DateOrder): string | null {
  const textual = textualParts(value);
  if (textual) {
    const { year, month, day } = textual;
    return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
  }

  const parts = numericParts(value);
  if (!parts) return null;

  const { a, b, year, yearFirst } = parts;
  const [month, day] = yearFirst || order === 'ymd' || order === 'mdy' ? [a, b] : [b, a];

  return isRealDate(year, month, day) ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/* ------------------------------------------------------------------ *
 * Amounts
 * ------------------------------------------------------------------ */

/** Which separator a column uses for the decimal point. */
export type DecimalStyle = 'point' | 'comma';

/**
 * Strips everything that is not part of the number, keeping the sign.
 *
 * Bank statements decorate amounts in ways that all mean "this is money":
 * a currency code (`AED 1,234.56`), a trailing indicator (`1,234.56 CR`),
 * accounting parentheses for negatives, and a trailing minus. All of it is
 * removed here; `parseAmount` reads the sign back out of what was removed.
 */
function stripDecoration(value: string): { digits: string; negative: boolean } | null {
  let text = value.trim();
  if (!text) return null;

  let negative = false;

  // Accounting negatives, before anything else eats the brackets.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  // A `DR`/`CR` suffix or prefix is a direction, not part of the number. `DR`
  // is only treated as a sign here; a dedicated indicator column, when there is
  // one, is authoritative and handled by the caller.
  const dr = /(^|\s)dr\.?($|\s)/i.test(text);
  text = text.replace(/(^|\s)(dr|cr)\.?($|\s)/gi, ' ');
  if (dr) negative = true;

  // Currency codes and symbols.
  text = text.replace(/aed|dhs?|usd|eur|gbp|inr|[$£€₹]/gi, '');

  text = text.replace(/\s/g, '');

  if (text.startsWith('-') || text.endsWith('-')) {
    negative = true;
    text = text.replace(/-/g, '');
  }
  text = text.replace(/^\+/, '');

  if (!/^[\d.,]*$/.test(text) || !/\d/.test(text)) return null;

  return { digits: text, negative };
}

/**
 * Which of `.` and `,` this column uses as its decimal point.
 *
 * `1.234,56` and `1,234.56` are the same money written two ways, and reading
 * one as the other is out by a factor of a thousand — the kind of error that
 * makes a monthly grocery bill look like a mortgage payment.
 *
 * A value containing both separators settles it outright: the rightmost one is
 * the decimal point, because thousands separators never come last. Only when no
 * value in the column contains both does the shape of a lone separator matter,
 * and there the rule is that exactly three trailing digits is a thousands
 * group — `1,234` is one thousand two hundred and thirty-four — while one or
 * two is a decimal. `1,23` therefore means comma-decimal, and `1.234` in a
 * column that never shows `.` with two decimals means point-thousands.
 */
export function detectDecimalStyle(values: readonly string[]): DecimalStyle {
  let commaEvidence = 0;
  let pointEvidence = 0;

  for (const raw of values) {
    const stripped = stripDecoration(raw ?? '');
    if (!stripped) continue;
    const { digits } = stripped;

    const lastComma = digits.lastIndexOf(',');
    const lastPoint = digits.lastIndexOf('.');

    if (lastComma >= 0 && lastPoint >= 0) {
      // Both present: the rightmost is the decimal point. Definitive, so it is
      // weighted heavily enough that one such value settles the column.
      if (lastComma > lastPoint) commaEvidence += 100;
      else pointEvidence += 100;
      continue;
    }

    const only = lastComma >= 0 ? ',' : lastPoint >= 0 ? '.' : null;
    if (!only) continue;

    const trailing = digits.length - digits.lastIndexOf(only) - 1;
    // Two separators of the same kind can only be thousands groups: 1.234.567.
    const repeated = digits.split(only).length > 2;

    if (repeated || trailing === 3) {
      if (only === ',') pointEvidence += 1;
      else commaEvidence += 1;
    } else if (trailing === 1 || trailing === 2) {
      if (only === ',') commaEvidence += 1;
      else pointEvidence += 1;
    }
  }

  // Point wins ties, including the no-evidence case: it is the convention in
  // every UAE bank export seen so far, and a tie means no value in the column
  // had a fractional part to get wrong.
  return commaEvidence > pointEvidence ? 'comma' : 'point';
}

/**
 * One cell to a number, or null.
 *
 * The sign is preserved rather than made absolute. `ParsedRow` wants a positive
 * amount and a separate direction, and the caller decides that — a negative in
 * a column headed "Credit" means something different from a negative in a
 * column headed "Amount".
 */
export function parseAmount(value: string, style: DecimalStyle = 'point'): number | null {
  const stripped = stripDecoration(value ?? '');
  if (!stripped) return null;

  const { digits, negative } = stripped;
  const thousands = style === 'point' ? ',' : '.';
  const decimal = style === 'point' ? '.' : ',';

  const withoutGroups = digits.split(thousands).join('');
  const normalised = withoutGroups.replace(decimal, '.');

  // A second decimal point means the value was never a single number.
  if (normalised.split('.').length > 2) return null;

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) return null;

  return negative ? -parsed : parsed;
}
