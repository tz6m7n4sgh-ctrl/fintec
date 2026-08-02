import type { ScheduledPayment } from './types';
import type { Transaction } from '@/lib/data/seed';

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
