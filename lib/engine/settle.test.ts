import { describe, expect, it } from 'vitest';
import { applySettlement, effectiveStatus, isOutstanding, settledPaymentIds } from './settle';
import type { ScheduledPayment } from './types';
import type { Transaction } from '@/lib/data/seed';

/**
 * US-18 (HAD-14). The acceptance criterion that shapes this file is the third
 * one — *"un-matching reverts the status"* — because the obvious
 * implementation gets it wrong in a way nothing would surface.
 *
 * `atRisk` is stored and nothing derives it. Write `paid` over a payment's
 * status and that flag is gone; un-matching can only restore `upcoming`, and a
 * cheque the user had marked as a problem silently stops being one.
 */

const payment = (over: Partial<ScheduledPayment> = {}): ScheduledPayment => ({
  id: 'pay-rent-q4',
  dueDate: '2026-10-05',
  payee: 'Landlord',
  purpose: 'Rent — Q4 cheque',
  amount: 18_000,
  account: 'ENBD ··4821',
  type: 'cheque',
  recurrence: 'quarterly',
  includedInBudget: true,
  status: 'upcoming',
  ...over,
});

const txn = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  bankAccountId: 'acc-enbd',
  date: '2026-10-05',
  description: 'CHQ 004821',
  amount: 18_000,
  direction: 'debit',
  source: 'statement',
  isDuplicate: false,
  reviewStatus: 'confirmed',
  matchedScheduledPaymentId: 'pay-rent-q4',
  ...over,
});

describe('settledPaymentIds', () => {
  it('a confirmed match settles its payment', () => {
    expect(settledPaymentIds([txn()])).toEqual(new Set(['pay-rent-q4']));
  });

  it('an edited match settles too — the user accepted it, with corrections', () => {
    expect(settledPaymentIds([txn({ reviewStatus: 'edited' })]).size).toBe(1);
  });

  it('a PENDING match settles nothing — R-2', () => {
    /*
     * The safety net. A parser that misreads a payee would otherwise tick off a
     * cheque the user still owes, on the calendar that exists to stop a cheque
     * bouncing. Nothing counts until a human confirms it.
     */
    expect(settledPaymentIds([txn({ reviewStatus: 'pending' })]).size).toBe(0);
  });

  it('a duplicate settles nothing', () => {
    expect(settledPaymentIds([txn({ isDuplicate: true })]).size).toBe(0);
  });

  it('an unmatched transaction settles nothing', () => {
    expect(settledPaymentIds([txn({ matchedScheduledPaymentId: undefined })]).size).toBe(0);
  });
});

describe('effectiveStatus', () => {
  it('a settled payment reads as paid', () => {
    expect(effectiveStatus(payment(), new Set(['pay-rent-q4']))).toBe('paid');
  });

  it('an unsettled payment keeps its stored status', () => {
    expect(effectiveStatus(payment(), new Set())).toBe('upcoming');
  });

  it('atRisk survives — the whole reason this derives', () => {
    // Write `paid` over this and the flag is destroyed. Derive it and the
    // stored value is untouched, so removing the match restores it for free.
    const p = payment({ status: 'atRisk' });
    expect(effectiveStatus(p, new Set(['pay-rent-q4']))).toBe('paid');
    expect(effectiveStatus(p, new Set())).toBe('atRisk');
    expect(p.status).toBe('atRisk');
  });

  it('a manual mark-paid wins over the absence of a match', () => {
    /*
     * The user asserting something the transactions do not show — a cash
     * payment, or a transfer from an account this app cannot see. Letting a
     * missing match override it would delete their statement about their own
     * money.
     */
    expect(effectiveStatus(payment({ status: 'paid' }), new Set())).toBe('paid');
  });
});

describe('applySettlement', () => {
  it('un-matching reverts, because nothing was ever written', () => {
    // US-18's third acceptance criterion, and the one the obvious
    // implementation fails silently.
    const payments = [payment({ status: 'atRisk' })];

    const matched = applySettlement(payments, [txn()]);
    expect(matched[0].status).toBe('paid');

    const unmatched = applySettlement(payments, [txn({ matchedScheduledPaymentId: undefined })]);
    expect(unmatched[0].status).toBe('atRisk');
  });

  it('does not mutate its input', () => {
    // These same payments feed chequeExposure() and the projection. A mutation
    // would change what those saw depending on call order.
    const payments = [payment()];
    applySettlement(payments, [txn()]);
    expect(payments[0].status).toBe('upcoming');
  });

  it('returns the same array when nothing has settled', () => {
    const payments = [payment()];
    expect(applySettlement(payments, [])).toBe(payments);
  });

  it('leaves unrelated payments alone', () => {
    const out = applySettlement(
      [payment(), payment({ id: 'pay-balloon', status: 'atRisk' })],
      [txn()],
    );
    expect(out[0].status).toBe('paid');
    expect(out[1].status).toBe('atRisk');
  });

  it('one transaction settles only the payment it names', () => {
    const out = applySettlement(
      [payment({ id: 'a' }), payment({ id: 'b' })],
      [txn({ matchedScheduledPaymentId: 'b' })],
    );
    expect(out.map((p) => p.status)).toEqual(['upcoming', 'paid']);
  });
});

// ===========================================================================
// HAD-82 — the shared "still to fund" rule
// ===========================================================================

describe('isOutstanding', () => {
  it('excludes a cleared payment', () => {
    expect(isOutstanding(payment({ status: 'paid' }))).toBe(false);
  });

  it('counts an upcoming payment', () => {
    expect(isOutstanding(payment({ status: 'upcoming' }))).toBe(true);
  });

  it('counts an atRisk payment — it is more owed, not less', () => {
    /*
     * The whole reason this is a predicate rather than an inline
     * `=== 'upcoming'`. `atRisk` is the flag standing between the user and a
     * bounced cheque (R-5); dropping it from exposure would remove the warning
     * at precisely the moment it earns its place.
     */
    expect(isOutstanding(payment({ status: 'atRisk' }))).toBe(true);
  });

  it('agrees with the derived status, not only the stored one', () => {
    // A payment settled by a confirmed transaction is paid without anything
    // having written to it, so the predicate has to be applied downstream of
    // applySettlement — which is where store.ts calls it.
    const [settled] = applySettlement(
      [payment({ id: 'pay-rent-q4', status: 'atRisk' })],
      [txn({ matchedScheduledPaymentId: 'pay-rent-q4', reviewStatus: 'confirmed' })],
    );
    expect(settled.status).toBe('paid');
    expect(isOutstanding(settled)).toBe(false);
  });
});
