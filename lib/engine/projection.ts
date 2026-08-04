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
 *
 * Since HAD-83 this module also models WHEN the final settlement arrives
 * (`projectCashWithSettlementArrival`) and derives per-payment `atRisk` from
 * that timing (`deriveAtRisk`) — see those functions for the reasoning.
 */

import { addMonths, formatMonthShort, parseIso } from './dates';
import { isOutstanding } from './settle';
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
  /**
   * The balance at `startDate`, i.e. before month 1. Under the
   * settlement-arrival model this EXCLUDES a settlement that has not yet
   * landed — it is what the user actually holds on their last working day,
   * not what they are owed.
   */
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
 * When the final settlement actually joins the balance (HAD-83).
 *
 * `runway.totalResources` includes the final settlement, but the employer has
 * `SETTLEMENT_DUE_DAYS` (14) after the last working day to pay it. Until this
 * type existed the projection could not say so — it counted the settlement
 * from day zero, and any rule that depends on *when* money lands ("is this
 * cheque due before the settlement arrives?") was underivable. That gap is
 * exactly why `atRisk` had to be a hand-set flag.
 *
 * Passed in rather than computed here so the engine stays layered: the 14-day
 * rule lives in `uae.ts` (`RULES.SETTLEMENT_DUE_DAYS`, surfaced as
 * `deadlines.settlementDue`), and this module stays a pure function of its
 * arguments.
 */
export interface SettlementArrival {
  /**
   * The final settlement figure, exactly as it is included in
   * `runway.totalResources`. It is *subtracted* from the opening balance and
   * credited back on arrival — pass a different number than the runway carries
   * and the two models stop describing the same money.
   */
  amount: number;
  /** `deadlines.settlementDue`, i.e. last working day + SETTLEMENT_DUE_DAYS. */
  arrivesOn: IsoDate;
}

/**
 * Projects the balance forward from `startDate`, subtracting the monthly burn
 * and any out-of-budget cheque lump sums in the month they fall due.
 *
 * This is the DAY-ZERO model: the whole of `totalResources`, settlement
 * included, is treated as present from the start. Kept because its output is
 * pinned by the projection tests and it is the correct degenerate case — it is
 * now a thin wrapper over `projectCashWithSettlementArrival` with a settlement
 * that has already arrived, so the two cannot drift.
 */
export function projectCash(
  runway: Runway,
  payments: ScheduledPayment[],
  startDate: IsoDate,
  horizonMonths: number = DEFAULT_HORIZON_MONTHS,
): Projection {
  // amount: 0 arriving on the start date — nothing is withheld, nothing is
  // credited later. Byte-for-byte the old behaviour.
  return projectCashWithSettlementArrival(
    runway,
    payments,
    startDate,
    { amount: 0, arrivesOn: startDate },
    horizonMonths,
  );
}

/**
 * The settlement-arrival-aware projection (HAD-83 / HAD-110).
 *
 * Identical to `projectCash` except that the final settlement is excluded from
 * the opening balance and credited in the month `settlement.arrivesOn` falls
 * in. Because months are ≥ 28 days and `SETTLEMENT_DUE_DAYS` is 14, the
 * arrival always precedes the first month-end for real profiles — so every
 * month-end point, and therefore the zero-crossing, matches the day-zero
 * model. What changes is `start` (the user's actual position on their last
 * working day) and, through `projectedBalanceBefore`, everything that needs
 * day-scale timing. The general case (an arrival months out — an employer who
 * simply does not pay on time) is still handled: the early months dip by the
 * settlement amount and the zero-crossing moves accordingly.
 *
 * What this still does NOT model, knowingly: ILOE is paid monthly after a
 * claim, not on day zero, and the monthly burn lands in month-end steps rather
 * than accruing daily. Both simplifications are in the safe direction *between*
 * month ends only for the settlement — they are recorded in
 * docs/spec/02-domain-rules.md rather than silently assumed.
 */
export function projectCashWithSettlementArrival(
  runway: Runway,
  payments: ScheduledPayment[],
  startDate: IsoDate,
  settlement: SettlementArrival,
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
    /*
     * A cleared payment is not a future outflow (HAD-82). It had to be said
     * here as well as in `chequeExposure()` — the same assumption lived in
     * both, and fixing only the exposure tile would have traded one silent
     * disagreement for another: the headline dropping while the projected
     * balance kept deducting money that had already left.
     *
     * `isOutstanding` is the shared rule, so there is one thing to change if
     * "still owed" ever means something else.
     */
    if (!isOutstanding(p)) continue;
    if (p.dueDate < startDate) continue; // already past
    const key = monthKey(p.dueDate) < firstKey ? firstKey : monthKey(p.dueDate);
    const entry = lumps.get(key) ?? { total: 0, payees: [] };
    entry.total += p.amount;
    entry.payees.push(p.payee);
    lumps.set(key, entry);
  }

  /*
   * The settlement is "pending" when it arrives strictly after the start date.
   * Pending money is withheld from the opening balance and credited in its
   * arrival month — folded into month 1 by the same rule as a lump sum in the
   * gap, because an arrival between startDate and the first month-end would
   * otherwise land on a key the loop never looks up and the money would simply
   * vanish (the mirror image of the dropped-cheque defect above).
   */
  const pending = settlement.amount !== 0 && settlement.arrivesOn > startDate;
  const creditKey = pending
    ? monthKey(settlement.arrivesOn) < firstKey
      ? firstKey
      : monthKey(settlement.arrivesOn)
    : null;

  const points: ProjectionPoint[] = [];
  let balance = runway.totalResources - (pending ? settlement.amount : 0);
  const start = balance;
  let zeroCrossingMonth: number | null = null;
  let totalLumpSums = 0;

  for (let i = 1; i <= horizonMonths; i++) {
    const month = addMonths(startDate, i);
    const { y, m } = parseIso(month);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const lump = lumps.get(key);
    const lumpSum = lump?.total ?? 0;
    // Credited before the zero test: the point is a month-END balance, and by
    // month end the arrival day has passed.
    const credit = key === creditKey ? settlement.amount : 0;

    balance = balance + credit - runway.netMonthlyBurn - lumpSum;
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
    start,
    points,
    zeroCrossingMonth,
    zeroCrossingLabel:
      zeroCrossingMonth === null ? null : points[zeroCrossingMonth - 1].label,
    totalLumpSums,
  };
}

/**
 * The projected balance at the moment `date`'s outflows are presented — i.e.
 * after everything strictly before `date`, and nothing on `date` itself.
 *
 * This is the day-scale query the monthly points cannot answer, and the whole
 * reason the arrival model exists: "can the balance cover this cheque on the
 * morning it is presented?" needs to know whether the settlement has landed
 * *by then*, not by month end.
 *
 * Three deliberate choices, each in the conservative direction or matching the
 * chart the user can see:
 *
 * - **The settlement counts only when `arrivesOn` is strictly before `date`.**
 *   A cheque presented the very day the settlement is due cannot count on it
 *   having cleared first — same-day is treated as not-yet-there. False alarm
 *   beats missed flag on a bounced-cheque screen (R-5).
 * - **Burn lands at month anniversaries**, exactly as the projection's points
 *   do — so a flag raised here is explainable from the chart on /money rather
 *   than from a second, smoother model that would quietly disagree with it.
 * - **Only outflows strictly before `date` are subtracted.** Two cheques due
 *   the same day have no knowable presentation order; assuming the other one
 *   clears first would flag both whenever either fits alone. Each is judged
 *   against the same morning balance.
 */
export function projectedBalanceBefore(
  runway: Runway,
  payments: ScheduledPayment[],
  startDate: IsoDate,
  settlement: SettlementArrival,
  date: IsoDate,
): number {
  let balance = runway.totalResources;

  // Withhold a settlement that has not landed by the day before `date`.
  // ISO dates compare correctly as strings; the codebase already relies on it.
  if (settlement.arrivesOn > startDate && settlement.arrivesOn >= date) {
    balance -= settlement.amount;
  }

  // Month-anniversary burn: one netMonthlyBurn per anniversary strictly
  // before `date`, mirroring the point-i balances of the monthly loop.
  let elapsed = 0;
  while (addMonths(startDate, elapsed + 1) < date) elapsed += 1;
  balance -= elapsed * runway.netMonthlyBurn;

  // Lump sums already presented: same filters as the monthly loop (G-1,
  // HAD-82), restricted to strictly-before.
  for (const p of payments) {
    if (p.includedInBudget) continue; // inside netMonthlyBurn already
    if (!isOutstanding(p)) continue; // cleared money is history
    if (p.dueDate < startDate) continue; // the past is not a future outflow
    if (p.dueDate < date) balance -= p.amount;
  }

  return balance;
}

/**
 * Is this payment at risk? (HAD-83 / HAD-110, FR-B4, R-5)
 *
 * One rule, chosen where two hand-set seed flags used to imply two: **a
 * payment is at risk when the projected balance immediately before its due
 * date cannot cover its amount** — with the settlement counted only from its
 * arrival. Both of the risks the seed rows gestured at fall out of it:
 *
 * - *Timing risk*: a cheque due in the settlement-due window is judged against
 *   cash on hand, not against money the employer still owes.
 * - *Magnitude risk*: a large cheque near the zero-crossing fails the same
 *   test because the projected balance has thinned out by then.
 *
 * In-budget and out-of-budget payments take the same test — the balance
 * already accounts for them differently (burn vs lump), but "can the account
 * cover it that morning" is the same question either way.
 *
 * Scope, stated rather than implied: the check runs on payment ROWS, judging
 * each row's own `dueDate` — which for a recurring series is its next
 * occurrence, the one the schedule table and the status pill describe.
 */
export function isPaymentAtRisk(
  payment: ScheduledPayment,
  payments: ScheduledPayment[],
  runway: Runway,
  startDate: IsoDate,
  settlement: SettlementArrival,
): boolean {
  if (!isOutstanding(payment)) return false; // paid money cannot bounce
  if (payment.dueDate < startDate) return false; // already presented — history
  return (
    projectedBalanceBefore(runway, payments, startDate, settlement, payment.dueDate) <
    payment.amount
  );
}

/**
 * Applies the derivation across a list, replacing every stored non-`paid`
 * status with the computed one.
 *
 * This is option A from HAD-83: `atRisk` stops being a source of truth
 * anywhere. A stored `atRisk` (the seed's hand-set rows, or anything an older
 * build wrote) is deliberately IGNORED in both directions — overridden to
 * `upcoming` when the money is there, and `upcoming` is overridden to `atRisk`
 * when it is not. Only `paid` survives, because a manual mark-paid is the user
 * asserting a fact the data cannot see (see `settle.ts`).
 *
 * Because nothing is written, the HAD-83 round trip holds by construction:
 * mark a payment paid, un-mark it, and the next read re-derives the same flag
 * from the same projection. `projection.test.ts` pins that anyway, so it stays
 * true when someone edits this.
 *
 * New objects rather than mutation, for the same reason as `applySettlement`:
 * these rows also feed `chequeExposure()` and the projection, and call order
 * must not change what they see. Note the derivation itself is
 * order-independent — `projectedBalanceBefore` reads only `paid`/not-paid off
 * the other rows, which this function never changes.
 */
export function deriveAtRisk(
  payments: ScheduledPayment[],
  runway: Runway,
  startDate: IsoDate,
  settlement: SettlementArrival,
): ScheduledPayment[] {
  return payments.map((p) => {
    if (p.status === 'paid') return p;
    const status: ScheduledPayment['status'] = isPaymentAtRisk(
      p,
      payments,
      runway,
      startDate,
      settlement,
    )
      ? 'atRisk'
      : 'upcoming';
    return status === p.status ? p : { ...p, status };
  });
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
