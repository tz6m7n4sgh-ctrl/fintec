// GENERATED FILE — do not edit.
//
// Copied from lib/engine/ by scripts/vendor-engine.mjs so the reminder job
// computes exactly what the app shows. Edit the source and re-run the script;
// vendor-engine.test.ts fails if this copy is out of date.
import type { IsoDate, Recurrence, ScheduledPayment } from './types.ts';

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

// ---------------------------------------------------------------------------
// Single-occurrence overrides (US-22 / OQ-4)
// ---------------------------------------------------------------------------

/**
 * How far ahead recurring payments are generated.
 *
 * Matches `DEFAULT_HORIZON_MONTHS` in `projection.ts` deliberately — OQ-4 was
 * decided as "18 months, to match the projection". A payment the projection
 * subtracts but the calendar never shows would be the worst kind of
 * disagreement between two screens about the same obligation.
 *
 * The Schedule screen's 12-month total is a separate reporting window and
 * answers a different question; it is not this.
 */
export const GENERATION_HORIZON_MONTHS = 18;

/** One dated instance of a payment, after overrides are applied. */
export interface Occurrence {
  /** The payment this instance renders from — the series, or a detached row. */
  payment: ScheduledPayment;
  date: IsoDate;
  /** True when this instance replaces an occurrence of a recurring series. */
  isOverride: boolean;
}

/**
 * Expands every payment into dated occurrences across a window.
 *
 * The rule OQ-4 settled on: editing one occurrence **detaches** it into a
 * standalone payment, and the series carries on unchanged. So expansion has to
 * do two things that a naive `occurrencesWithin` per row does not:
 *
 * 1. **Skip** a series date that a detached row has taken over. Without this
 *    the occurrence renders twice — once from the series, once from the
 *    override — and a cheque counted twice is a wrong runway.
 * 2. **Emit** the detached row at its own `dueDate`, which may differ from the
 *    occurrence it replaced. "The March cheque, but on the 20th" is the case
 *    this whole model exists for.
 *
 * A detached row is never itself expanded: the database refuses to let one
 * recur, so it contributes exactly one occurrence.
 */
export function expandPayments(
  payments: ScheduledPayment[],
  windowEnd: IsoDate,
  windowStart?: IsoDate,
): Occurrence[] {
  const overrides = payments.filter((p) => p.seriesId && p.detachedDate);

  // Which dates each series no longer generates, because something replaced them.
  const replaced = new Map<string, Set<string>>();
  for (const o of overrides) {
    const set = replaced.get(o.seriesId!) ?? new Set<string>();
    set.add(o.detachedDate!);
    replaced.set(o.seriesId!, set);
  }

  const out: Occurrence[] = [];

  for (const p of payments) {
    if (p.seriesId) {
      // A detached row stands alone at its own date.
      if (p.dueDate <= windowEnd && (!windowStart || p.dueDate >= windowStart)) {
        out.push({ payment: p, date: p.dueDate, isOverride: true });
      }
      continue;
    }

    const skip = replaced.get(p.id);
    for (const date of occurrencesWithin(p.recurrence, p.dueDate, windowEnd)) {
      if (skip?.has(date)) continue;
      if (windowStart && date < windowStart) continue;
      out.push({ payment: p, date, isOverride: false });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Total value of everything falling due in the window, overrides applied. */
export function scheduledTotalWithin(
  payments: ScheduledPayment[],
  windowEnd: IsoDate,
  windowStart?: IsoDate,
): number {
  return expandPayments(payments, windowEnd, windowStart).reduce(
    (sum, o) => sum + o.payment.amount,
    0,
  );
}
