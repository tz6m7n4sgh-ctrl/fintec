/**
 * Cash projection (§6.1 FR-A3).
 *
 * The flat-burn `runwayMonths` from §5.5 answers "how many months of average
 * spending do my resources cover". It cannot see lump sums, so when large
 * cheques fall due the balance can reach zero materially earlier than the
 * headline runway suggests. This module computes the month-by-month balance
 * INCLUDING those lump sums and reports the real zero-crossing month, so the UI
 * can show both numbers instead of letting them silently disagree.
 *
 * Double-count rule (G-1): a cheque is only subtracted as a lump sum when
 * `includedInBudget === false`. Anything already inside a monthly budget line is
 * part of `netMonthlyBurn` and must not be deducted twice.
 */

import { addMonths, formatMonthShort, parseIso } from './dates';
import type { IsoDate, Runway, ScheduledPayment } from './types';

export interface ProjectionPoint {
  /** First day of the projected month. */
  month: IsoDate;
  label: string;
  /** Balance at the END of this month. */
  balance: number;
  /** Lump sums deducted in this month (cheques outside the budget). */
  lumpSum: number;
  /** What produced the lump sum, for tooltips and labels. */
  lumpSumPayees: string[];
  belowZero: boolean;
}

export interface Projection {
  /** Starting resources, i.e. the balance before month 1. */
  start: number;
  points: ProjectionPoint[];
  /** Label of the first month the balance goes negative, or null if it never does. */
  zeroCrossingLabel: string | null;
  /** Month index (1-based) of the first negative balance, or null. */
  zeroCrossingMonth: number | null;
  /** Total lump sums applied across the horizon. */
  totalLumpSums: number;
}

export const DEFAULT_HORIZON_MONTHS = 18;

/**
 * Projects the balance forward from `startDate`, subtracting the monthly burn
 * and any out-of-budget cheque lump sums in the month they fall due.
 */
export function projectCash(
  runway: Runway,
  payments: ScheduledPayment[],
  startDate: IsoDate,
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
): Projection {
  // The first projected month is startDate + 1 month, so a payment falling
  // between startDate and the end of startDate's own month has a key no
  // iteration below would ever look up. That gap silently dropped it.
  //
  // It mattered: chequeExposure() counts from lastDay INCLUSIVE, so a cheque due
  // on the last working day was counted by the dashboard's exposure tile while
  // the projection never deducted it — two figures shown side by side, quietly
  // disagreeing, with the projection understating the shortfall. On an app whose
  // central promise is "you will not bounce a cheque", that is the wrong
  // direction to be wrong in.
  //
  // Anything due in that gap is folded into month 1. Anything genuinely before
  // startDate is in the past and is not a future outflow.
  const firstMonth = addMonths(startDate, 1);
  const monthKey = (iso: IsoDate) => {
    const { y, m } = parseIso(iso);
    return `${y}-${String(m).padStart(2, '0')}`;
  };
  const firstKey = monthKey(firstMonth);

  // Only out-of-budget payments are lump sums — everything else is already in
  // netMonthlyBurn. Grouped by calendar month so several cheques in one month
  // combine into a single hit.
  const lumps = new Map<string, { total: number; payees: string[] }>();
  for (const p of payments) {
    if (p.includedInBudget) continue;
    if (p.dueDate < startDate) continue; // already past
    const key = monthKey(p.dueDate) < firstKey ? firstKey : monthKey(p.dueDate);
    const entry = lumps.get(key) ?? { total: 0, payees: [] };
    entry.total += p.amount;
    entry.payees.push(p.payee);
    lumps.set(key, entry);
  }

  const points: ProjectionPoint[] = [];
  let balance = runway.totalResources;
  let zeroCrossingMonth: number | null = null;
  let totalLumpSums = 0;

  for (let i = 1; i <= horizonMonths; i++) {
    const month = addMonths(startDate, i);
    const { y, m } = parseIso(month);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const lump = lumps.get(key);
    const lumpSum = lump?.total ?? 0;

    balance = balance - runway.netMonthlyBurn - lumpSum;
    totalLumpSums += lumpSum;

    if (zeroCrossingMonth === null && balance < 0) zeroCrossingMonth = i;

    points.push({
      month,
      label: formatMonthShort(month),
      balance,
      lumpSum,
      lumpSumPayees: lump?.payees ?? [],
      belowZero: balance < 0,
    });
  }

  return {
    start: runway.totalResources,
    points,
    zeroCrossingMonth,
    zeroCrossingLabel:
      zeroCrossingMonth === null ? null : points[zeroCrossingMonth - 1].label,
    totalLumpSums,
  };
}

/**
 * Aggregates confirmed transactions into a month-by-month spend series
 * (FR-A4 / US-12). Only confirmed rows count — pending review rows must never
 * move a dashboard figure.
 */
export interface MonthlyActual {
  month: string;
  label: string;
  spend: number;
  income: number;
}

export interface ActualTransaction {
  date: IsoDate;
  amount: number;
  direction: 'credit' | 'debit';
  reviewStatus: 'pending' | 'confirmed' | 'edited';
  isDuplicate: boolean;
}

export function monthlyActuals(transactions: ActualTransaction[]): MonthlyActual[] {
  const byMonth = new Map<string, { spend: number; income: number }>();

  for (const t of transactions) {
    if (t.isDuplicate) continue;
    if (t.reviewStatus === 'pending') continue; // not "actual" until confirmed
    const { y, m } = parseIso(t.date);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const e = byMonth.get(key) ?? { spend: 0, income: 0 };
    if (t.direction === 'debit') e.spend += t.amount;
    else e.income += t.amount;
    byMonth.set(key, e);
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      label: formatMonthShort(`${month}-01`),
      spend: v.spend,
      income: v.income,
    }));
}
