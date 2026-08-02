// GENERATED FILE — do not edit.
//
// Copied from lib/engine/ by scripts/vendor-engine.mjs so the reminder job
// computes exactly what the app shows. Edit the source and re-run the script;
// vendor-engine.test.ts fails if this copy is out of date.
import type { ScheduledPayment } from './types.ts';
// Vendored: the alias '@/lib/data/seed' does not exist outside Next, and
// only this row's shape is used. Kept structural so a change to the real type
// that this module depends on still fails the typecheck at source.
type Transaction = { reviewStatus: 'pending' | 'confirmed' | 'edited' };

/**
 * Marking a scheduled payment paid from a confirmed transaction (US-18 / FR-B4).
 *
 * ## Why this derives rather than writes
 *
 * The obvious implementation is to `update scheduled_payments set status =
 * 'paid'` when a matched transaction is confirmed. It fails the third
 * acceptance criterion — *"un-matching reverts the status"* — and fails it
 * silently.
 *
 * `PaymentStatus` is `'upcoming' | 'paid' | 'atRisk'`, and `atRisk` is
 * **stored, not derived**: nothing in the engine computes it, it exists only
 * where the seed set it by hand. So overwriting a payment's status with `paid`
 * destroys the only record that it was at risk. Un-matching later can revert to
 * `upcoming` — and a cheque the user had flagged as a problem quietly stops
 * being flagged. On the screen that stands between them and a bounced cheque.
 *
 * Deriving instead means there is nothing to revert. Remove the match and the
 * derivation stops finding one; the stored status was never touched, so
 * whatever it was is still there. The same "one source per fact" rule the
 * budget's auto rows and the school-fee obligations already follow.
 *
 * A **manual** mark-paid is different: that is the user asserting something the
 * data does not show, so it is stored, and stored `paid` wins.
 */

/** A transaction that has been confirmed and points at a scheduled payment. */
interface Settling {
  /** Optional, as on `Transaction` — most rows match nothing. */
  matchedScheduledPaymentId?: string;
  reviewStatus: Transaction['reviewStatus'];
  isDuplicate: boolean;
}

/**
 * Which scheduled payments a confirmed transaction settles.
 *
 * Only confirmed, non-duplicate rows count. A *pending* match must not mark
 * anything paid — that is the whole of US-31's safety net (R-2), and a parser
 * that misreads a payee would otherwise tick off a cheque the user still owes.
 */
export function settledPaymentIds(transactions: Settling[]): Set<string> {
  const ids = new Set<string>();
  for (const t of transactions) {
    if (t.isDuplicate) continue;
    if (t.reviewStatus === 'pending') continue;
    if (t.matchedScheduledPaymentId) ids.add(t.matchedScheduledPaymentId);
  }
  return ids;
}

/**
 * The status to render, given what is stored and what has settled.
 *
 * Precedence, and each step earns its place:
 *
 * 1. **Stored `paid` wins.** A manual mark-paid is the user asserting something
 *    the transactions do not show — a cash payment, a transfer from an account
 *    the app cannot see. Letting a missing match override it would delete their
 *    statement.
 * 2. **A settled match reads as paid.** This is the auto-mark.
 * 3. **Otherwise the stored status stands**, `atRisk` included, unchanged and
 *    unlost.
 */
export function effectiveStatus(
  payment: ScheduledPayment,
  settled: Set<string>,
): ScheduledPayment['status'] {
  if (payment.status === 'paid') return 'paid';
  if (settled.has(payment.id)) return 'paid';
  return payment.status;
}

/**
 * Does this payment still need funding? (HAD-82)
 *
 * The one place that decides, because two figures read it and they must not
 * disagree: `chequeExposure()` on the dashboard and the report, and the lump
 * sums `projectCash()` subtracts from the forward balance. Written twice, they
 * would drift the first time one of them was edited — and the symptom would be
 * two numbers on adjacent screens quietly contradicting each other, which is
 * this project's most-repeated defect.
 *
 * **Only `paid` is excluded, and that is deliberate.** `atRisk` is still
 * exposure — more so, not less. A cheque the user has flagged as a problem is
 * the single thing this app exists to keep in view (R-5), and a predicate that
 * quietly dropped it would remove the warning at exactly the moment it matters.
 * So this tests for `paid` rather than testing for `upcoming`: a status added
 * later defaults to *counted*, which is the safe direction.
 *
 * ## Why cleared money must stop being projected
 *
 * A cleared cheque is history, not exposure. Continuing to count it overstates
 * what is still owed, and — worse in the projection — subtracts an outflow that
 * has already happened from a balance that already reflects it. The app's bias
 * is toward caution, and overstating an obligation is the safe direction of the
 * two, which is why this was worth doing deliberately rather than quickly. But
 * "cautious" is not the same as "correct", and a figure the user cannot
 * reconcile against their own bank balance is one they stop trusting.
 *
 * ## Why school fees are not filtered here
 *
 * `schoolFeeObligations()` drops a paid term before deriving anything, so a paid
 * fee never becomes a payment and this predicate never sees one. That is not a
 * second copy of this rule: it answers a different question. This one asks
 * *"does this payment still need funding?"*; that one asks *"does this fee
 * still produce an obligation at all?"* — and a term already paid produces
 * nothing to put on a calendar.
 *
 * The alternative — deriving every term with a real status and letting this
 * predicate filter — would put paid fee terms on the calendar and the schedule.
 * That may well be an improvement, since a term you have paid currently
 * disappears from the schedule entirely. It is a separate decision about what
 * those screens show, not a correctness fix, so it is not made here.
 */
export function isOutstanding(payment: Pick<ScheduledPayment, 'status'>): boolean {
  return payment.status !== 'paid';
}

/**
 * Applies the derivation across a list.
 *
 * Returns new objects rather than mutating: these payments are also the input
 * to `chequeExposure()` and the projection, and a mutation here would change
 * what those saw depending on call order.
 */
export function applySettlement(
  payments: ScheduledPayment[],
  transactions: Settling[],
): ScheduledPayment[] {
  const settled = settledPaymentIds(transactions);
  if (settled.size === 0) return payments;

  return payments.map((p) => {
    const status = effectiveStatus(p, settled);
    return status === p.status ? p : { ...p, status };
  });
}
