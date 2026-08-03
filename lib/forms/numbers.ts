/**
 * Reading a number a person typed into a form.
 *
 * ## The defect this replaces
 *
 * `app/profile/actions.ts` used to do this:
 *
 * ```ts
 * const v = Number(raw);
 * return Number.isFinite(v) ? v : 0;
 * ```
 *
 * `Number('32,000')` is `NaN`, so a basic salary typed the way people write
 * salaries was **silently saved as zero**. The form reported success. Gratuity,
 * leave encashment, ILOE eligibility and the whole runway were then computed
 * from a basic salary of nothing — and every one of those figures rendered
 * confidently.
 *
 * The database could not catch it either: `profiles_gross_gte_basic` is
 * satisfied by a basic of zero, because gross is still the larger figure.
 *
 * Nothing about that failure was visible. It is this project's signature defect
 * — a plausible wrong number rather than a loud one — sitting in the first
 * field a user ever fills in.
 *
 * ## The rule
 *
 * **Accept what people actually type. Refuse what is genuinely not a number.**
 * Never substitute a value.
 *
 * Those are two separate obligations and the old code failed both: it rejected
 * `32,000`, which is fine input, and it accepted the rejection by inventing a
 * zero rather than saying so.
 */

/** What the browser sends when a field was left alone. */
const EMPTY = '';

export type ParsedNumber =
  | { ok: true; value: number }
  | { ok: false; reason: 'not-a-number' | 'negative' };

/**
 * Strips the punctuation people put in numbers, then parses.
 *
 * Thousands separators, spaces (including the non-breaking and narrow ones a
 * paste from Excel or a bank statement carries), and a currency code or symbol.
 * `32,000`, `32 000`, `AED 32,000` and `32000` are the same figure and all four
 * are things a real person types.
 *
 * A trailing or leading minus is kept, because `allowNegative` decides what to
 * do about it rather than this function silently dropping the sign.
 */
export function parseFormNumber(
  raw: string,
  { allowNegative = false }: { allowNegative?: boolean } = {},
): ParsedNumber {
  const cleaned = raw
    .trim()
    // Non-breaking and narrow no-break spaces arrive from spreadsheet pastes.
    .replace(/[  \s]/g, '')
    .replace(/aed|dhs?|usd|[$£€]/gi, '')
    .replace(/,/g, '');

  if (cleaned === EMPTY) return { ok: false, reason: 'not-a-number' };

  /*
   * Checked with a pattern before `Number`, because `Number` is far too
   * generous for a form: it reads `''` as 0, `'0x1f'` as 31, `'1e5'` as
   * 100000 and `'Infinity'` as Infinity. A salary field should accept none of
   * those, and the old code accepted all of them.
   */
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return { ok: false, reason: 'not-a-number' };

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { ok: false, reason: 'not-a-number' };
  if (!allowNegative && value < 0) return { ok: false, reason: 'negative' };

  return { ok: true, value };
}

/**
 * A blank field, which is different from an unreadable one.
 *
 * Leaving a number blank is a legitimate thing to do — most of these fields are
 * genuinely zero for most people — so blank keeps meaning zero. What changes is
 * that *unreadable* no longer also means zero.
 */
export function isBlank(raw: string): boolean {
  return raw.trim() === EMPTY;
}

/** The message a user sees. Names the field, because a form has many. */
export function numberError(label: string, reason: 'not-a-number' | 'negative'): string {
  return reason === 'negative'
    ? `${label} cannot be negative.`
    : `${label} is not a number. Digits, and a decimal point if you need one — commas and spaces are fine, but letters are not.`;
}
