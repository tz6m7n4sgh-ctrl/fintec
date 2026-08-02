import type { IncomeStream, IsoDate, ScheduledPayment } from './types';
import { addDays, daysBetween } from './dates';
import { occurrencesWithin } from './schedule';

/**
 * Proposing which obligation a transaction paid (US-33 / FR-L6).
 *
 * ## This proposes. It never acts.
 *
 * A match lands on a **pending** transaction, and `settledPaymentIds()` only
 * counts confirmed ones — so a proposal marks nothing paid until a human says
 * so. That is structural rather than a promise, and it is what makes the
 * tolerances below safe to tune at all.
 *
 * ## Precision over recall, deliberately
 *
 * The two ways to be wrong are not equal.
 *
 * **No proposal** costs the user a dropdown. They match it themselves; the
 * inbox shows "No match" and nothing is claimed.
 *
 * **A wrong proposal** is worse than none, because it invites a mistaken
 * confirmation. Someone clearing an inbox of thirty rows is not re-deriving
 * each one — a plausible wrong match gets confirmed, and a cheque that is still
 * outstanding is marked paid. On the screen that exists to stop a cheque
 * bouncing, that is the R-5 failure with an extra step.
 *
 * So all three signals must agree — amount, date and payee — rather than
 * scoring them and taking the best. A score lets two weak signals outvote a
 * contradicted third, which is exactly how a confident wrong answer is built.
 */

/**
 * How far apart a transaction and a payment occurrence may fall and still be
 * the same event.
 *
 * Ten days, calibrated against the §11 reference rather than guessed. The car
 * loan is scheduled for the 6th and its instalment debits on the 28th of the
 * month before — eight days apart — because an auto-debit posts when the bank
 * runs it, not when the app thinks it is due. A five-day window looked
 * reasonable and silently missed a real match.
 *
 * The ceiling is half the shortest recurrence. Monthly occurrences are ~30 days
 * apart, so anything at or above 15 could leave a transaction equidistant
 * between two of them and the choice arbitrary. Ten keeps clear margin.
 */
export const DATE_WINDOW_DAYS = 10;

/**
 * Amount tolerance: the tighter of 5% or AED 50.
 *
 * A utility bill varies month to month — the §11 reference has DEWA scheduled
 * at 700 and a statement line of 690 — so exact matching is too strict. But 5%
 * of a 45,000 balloon cheque is 2,250, which is loose enough to match a
 * different obligation entirely. The absolute cap is what stops the percentage
 * growing teeth on large amounts, and large amounts are where a wrong match
 * costs the most.
 */
export function amountTolerance(expected: number): number {
  return Math.min(expected * 0.05, 50);
}

export function amountsAgree(expected: number, actual: number): boolean {
  return Math.abs(expected - actual) <= amountTolerance(expected);
}

/**
 * Words too common to be evidence of anything.
 *
 * Without these, "PAYMENT" in a description matches "payment" in half the
 * scheduled purposes and the payee signal stops being a signal.
 */
const STOPWORDS = new Set([
  'THE', 'AND', 'FOR', 'LLC', 'FZE', 'LTD', 'INC', 'UAE', 'AED', 'DUBAI',
  'PAYMENT', 'PAYMENTS', 'TRANSFER', 'DEBIT', 'CREDIT', 'CARD', 'BANK',
  'MONTHLY', 'ANNUAL', 'BILL', 'INSTALMENT', 'INSTALLMENT', 'CHQ', 'CHEQUE',
  'REF', 'TXN', 'POS', 'ATM', 'PURCHASE', 'ONLINE', 'SEP', 'OCT', 'NOV',
  'DEC', 'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG',
]);

/**
 * Significant words in a label.
 *
 * Three characters or more, so "Q4" and "MOE" behave differently — a two-letter
 * token collides far too easily to be evidence. Digits are kept: a card suffix
 * or an account fragment is often the strongest signal there is.
 */
export function keywords(label: string): Set<string> {
  const out = new Set<string>();
  for (const raw of label.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/** Whether two labels share at least one significant word. */
export function payeeAgrees(description: string, payee: string, purpose = ''): boolean {
  const from = keywords(description);
  if (from.size === 0) return false;
  for (const word of keywords(`${payee} ${purpose}`)) {
    if (from.has(word)) return true;
  }
  return false;
}

/** A transaction as far as matching is concerned. */
export interface Matchable {
  date: IsoDate;
  description: string;
  amount: number;
  direction: 'credit' | 'debit';
}

export interface Proposal {
  /** The scheduled payment this debit appears to have settled. */
  paymentId?: string;
  /** The income stream this credit appears to have come from. */
  incomeStreamId?: string;
  /** Why, in a sentence the review inbox can show. */
  reason?: string;
}

/**
 * Proposes a scheduled payment for a debit.
 *
 * Candidates must agree on all three signals. Among those that do, the closest
 * by date wins, then the closest by amount — deterministic, so the same
 * statement parsed twice proposes the same thing.
 *
 * A payment already marked `paid` is skipped. Proposing one is not harmful,
 * but it is noise on a screen whose value depends on being worth reading.
 *
 * **Derived rows are skipped too.** A school-fee obligation carries a
 * `fee:<uuid>` id and no `scheduled_payments` row, so a match against one could
 * never be stored (HAD-81, HAD-76 — the same sentinel-id rule).
 */
export function proposePayment(
  txn: Matchable,
  payments: ScheduledPayment[],
): Proposal {
  if (txn.direction !== 'debit') return {};

  /*
   * Matched against expanded *occurrences*, not the stored `dueDate`.
   *
   * `dueDate` on a recurring payment is only the first one. A statement
   * covering December would otherwise match nothing at all for a monthly rent
   * cheque first due in October — the matcher would work on the first month of
   * data and quietly stop, which is a worse failure than not working at all.
   *
   * The proposal still names the **series** id, because that is what
   * `matched_scheduled_payment_id` stores. Two months' debits therefore both
   * point at the same payment; confirming both marks it paid once. That is a
   * modelling limit of the column rather than of this function, and it is
   * recorded on HAD-12 rather than worked around here.
   */
  const candidates = payments
    .filter((p) => p.status !== 'paid' && !p.derivedFrom)
    .map((p) => {
      const near = occurrencesWithin(p.recurrence, p.dueDate, addDays(txn.date, DATE_WINDOW_DAYS))
        .filter((d) => Math.abs(daysBetween(d, txn.date)) <= DATE_WINDOW_DAYS)
        .sort((a, b) => Math.abs(daysBetween(a, txn.date)) - Math.abs(daysBetween(b, txn.date)));
      return { payment: p, occurrence: near[0] };
    })
    .filter(
      (c): c is { payment: ScheduledPayment; occurrence: string } =>
        c.occurrence !== undefined &&
        amountsAgree(c.payment.amount, txn.amount) &&
        payeeAgrees(txn.description, c.payment.payee, c.payment.purpose),
    );

  if (candidates.length === 0) return {};

  const best = [...candidates].sort((a, b) => {
    const byDate =
      Math.abs(daysBetween(a.occurrence, txn.date)) - Math.abs(daysBetween(b.occurrence, txn.date));
    if (byDate !== 0) return byDate;
    return Math.abs(a.payment.amount - txn.amount) - Math.abs(b.payment.amount - txn.amount);
  })[0].payment;

  return {
    paymentId: best.id,
    reason: `${best.payee} — same payee, within ${DATE_WINDOW_DAYS} days and AED ${amountTolerance(best.amount).toFixed(0)}`,
  };
}

/**
 * Proposes an income stream for a credit.
 *
 * Salary is the case that matters: it arrives monthly, for a known amount, from
 * a payer whose name appears in the description. No date window, because a
 * stream has no due date — a salary landing on the 25th one month and the 27th
 * the next is the same stream.
 */
export function proposeIncome(txn: Matchable, streams: IncomeStream[]): Proposal {
  if (txn.direction !== 'credit') return {};

  const candidates = streams.filter(
    (s) =>
      s.active &&
      s.frequency === 'monthly' &&
      amountsAgree(s.amount, txn.amount) &&
      payeeAgrees(txn.description, s.name),
  );

  if (candidates.length === 0) return {};

  const best = [...candidates].sort(
    (a, b) => Math.abs(a.amount - txn.amount) - Math.abs(b.amount - txn.amount),
  )[0];

  return { incomeStreamId: best.id, reason: `${best.name} — same payer and amount` };
}

/** Both halves, for one transaction. */
export function propose(
  txn: Matchable,
  payments: ScheduledPayment[],
  streams: IncomeStream[],
): Proposal {
  return txn.direction === 'debit'
    ? proposePayment(txn, payments)
    : proposeIncome(txn, streams);
}
