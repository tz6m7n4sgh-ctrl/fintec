import type { IncomeStream, IsoDate } from './types';

/**
 * What income is actually arriving on a given date.
 *
 * The acceptance criterion for US-27 is that the salary stream "auto-ends at
 * `expectedLastDay` in the termination scenario, **enforced in code rather than
 * seeded**". Today that behaviour is a property of the seed: `SEED_INCOME` sets
 * the salary stream's `endDate` to the same date as `expectedLastDay`, and
 * nothing checks it. Change one and the other silently disagrees.
 *
 * The rule here is more general and does not special-case salary at all: a
 * stream contributes on a date only while its own window covers that date. The
 * salary ending on the last working day then falls out of the model rather than
 * being asserted about it — which also means it stays correct if the user has
 * two salaries, a contract that ends earlier, or none at all.
 *
 * Dates compare as `yyyy-mm-dd` strings, which is chronological as well as
 * lexicographic. Building a `Date` here would reintroduce the timezone bug
 * `dates.ts` exists to avoid — UTC midnight formatting to the previous day in a
 * westward timezone.
 */

/** True when `asOf` falls inside the stream's own start/end window. */
export function isStreamActiveOn(stream: IncomeStream, asOf: IsoDate): boolean {
  if (!stream.active) return false;
  if (stream.startDate && asOf < stream.startDate) return false;
  // An end date is the last day the stream pays, not the first day it does not.
  if (stream.endDate && asOf > stream.endDate) return false;
  return true;
}

/**
 * Total monthly income arriving on `asOf`.
 *
 * One-off streams are excluded: they are a single amount on a date, not a
 * monthly figure, and adding them to a per-month total would overstate every
 * month after the one they land in.
 */
export function monthlyIncomeOn(streams: IncomeStream[], asOf: IsoDate): number {
  return streams
    .filter((s) => s.frequency === 'monthly' && isStreamActiveOn(s, asOf))
    .reduce((sum, s) => sum + s.amount, 0);
}

/**
 * Income still arriving the day after employment ends.
 *
 * This is the figure that matters for runway: salary has stopped, and whatever
 * is left is what offsets the monthly burn. Taking the day *after* the last
 * working day rather than the last day itself is deliberate — on the last day
 * the salary is still active, and counting it would make the first month of
 * unemployment look funded.
 */
export function incomeAfterLastDay(streams: IncomeStream[], lastDay: IsoDate): number {
  const [y, m, d] = lastDay.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const iso = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
  return monthlyIncomeOn(streams, iso);
}

/**
 * Streams whose window ends on or before the last working day.
 *
 * Used to show the user *which* income stops when the job does, rather than
 * leaving them to compare dates by eye.
 */
export function streamsEndingBy(streams: IncomeStream[], lastDay: IsoDate): IncomeStream[] {
  return streams.filter((s) => s.active && s.endDate !== undefined && s.endDate <= lastDay);
}
