// GENERATED FILE — do not edit.
//
// Copied from lib/engine/ by scripts/vendor-engine.mjs so the reminder job
// computes exactly what the app shows. Edit the source and re-run the script;
// vendor-engine.test.ts fails if this copy is out of date.
/**
 * Calendar-date helpers.
 *
 * All date maths in this app is CALENDAR maths in Asia/Dubai (NFR-2, R-7).
 * We deliberately avoid `Date` arithmetic on local timestamps: constructing a
 * `Date` from `yyyy-mm-dd` yields UTC midnight, and formatting it in a
 * westward timezone silently shifts the day back by one. Instead we treat a
 * date as (y, m, d) and do the arithmetic on the calendar itself, so a
 * deadline computed here is the same day whatever the server's timezone.
 */

import type { IsoDate } from './types.ts';

export const DUBAI_TZ = 'Asia/Dubai';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function parseIso(iso: IsoDate): CalendarDate {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Invalid ISO date: ${iso}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error(`Invalid ISO date: ${iso}`);
  return { y, m: mo, d };
}

export function toIso({ y, m, d }: CalendarDate): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since the Unix epoch for a calendar date — the basis for day counts. */
export function toEpochDay(iso: IsoDate): number {
  const { y, m, d } = parseIso(iso);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromEpochDay(day: number): IsoDate {
  const dt = new Date(day * 86_400_000);
  return toIso({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

/** Calendar days between two dates, `to − from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** Adds calendar months, clamping the day to the target month's length. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const { y, m, d } = parseIso(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return toIso({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** True when `iso` falls in [start, end] inclusive. */
export function isWithin(iso: IsoDate, start: IsoDate, end: IsoDate): boolean {
  const t = toEpochDay(iso);
  return t >= toEpochDay(start) && t <= toEpochDay(end);
}

/** Today in Asia/Dubai, as a calendar date — never the server's local day. */
export function todayInDubai(now: Date = new Date()): IsoDate {
  // en-CA formats as yyyy-mm-dd, which is already our ISO shape.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Whole days from today (Asia/Dubai) until `iso`. Negative once past. */
export function daysUntil(iso: IsoDate, now?: Date): number {
  return daysBetween(todayInDubai(now), iso);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `dd MMM yyyy` per NFR-2. */
export function formatDate(iso: IsoDate): string {
  const { y, m, d } = parseIso(iso);
  return `${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** `MMM yy`, for chart axes. */
export function formatMonthShort(iso: IsoDate): string {
  const { y, m } = parseIso(iso);
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
}
