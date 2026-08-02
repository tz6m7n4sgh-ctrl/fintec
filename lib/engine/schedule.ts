import type { IsoDate, Recurrence } from './types';

/**
 * Recurrence expansion.
 *
 * Moved out of `app/schedule/page.tsx`, where it was the only non-trivial
 * calculation in this app living outside the tested engine — and it drives a
 * headline figure, the 12-month schedule total. HAD-25 named it as debt; adding
 * CRUD on top of an untested calculation would have compounded it.
 *
 * Calendar arithmetic on `(year, month, day)` rather than timestamps, for the
 * same reason `dates.ts` does: a `Date` built from an ISO string is UTC
 * midnight and formats to the previous day in a westward timezone, which would
 * move a cheque a day early.
 */

/** Months between occurrences. `none` means the payment happens once. */
const STEP_MONTHS: Record<Recurrence, number> = {
  none: 0,
  monthly: 1,
  quarterly: 3,
  termly: 4,
  yearly: 12,
};

/** Days in a given month, 1-indexed month. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The nth occurrence of a recurrence, as an ISO date.
 *
 * The day-of-month is **clamped to the end of the target month**. Without that,
 * a payment first due on the 31st produces `2026-02-31` — a string that is not
 * a date, compares as greater than every real date in February, and so silently
 * drops the occurrence rather than failing. A rent cheque vanishing from the
 * calendar is the R-5 failure mode, so this clamps rather than skips.
 */
export function occurrenceOn(firstDue: IsoDate, stepMonths: number, n: number): IsoDate {
  const [y, m, d] = firstDue.split('-').map(Number);
  const total = y * 12 + (m - 1) + n * stepMonths;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Every occurrence of a payment falling on or before `windowEnd`.
 *
 * Occurrences before `firstDue` do not exist — a payment does not retroactively
 * recur — so the window is [firstDue, windowEnd].
 */
export function occurrencesWithin(
  recurrence: Recurrence,
  firstDue: IsoDate,
  windowEnd: IsoDate,
): IsoDate[] {
  const step = STEP_MONTHS[recurrence] ?? 0;
  if (step === 0) return firstDue <= windowEnd ? [firstDue] : [];

  const out: IsoDate[] = [];
  // 24 is the ceiling for a monthly payment over the longest window this app
  // uses (18 months of projection). A bound rather than `while (true)`, so a
  // malformed date cannot spin.
  for (let n = 0; n < 24; n++) {
    const iso = occurrenceOn(firstDue, step, n);
    if (iso > windowEnd) break;
    out.push(iso);
  }
  return out;
}

/** How many times a payment falls due inside the window. */
export function occurrenceCount(
  recurrence: Recurrence,
  firstDue: IsoDate,
  windowEnd: IsoDate,
): number {
  return occurrencesWithin(recurrence, firstDue, windowEnd).length;
}
