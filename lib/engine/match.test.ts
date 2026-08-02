import { describe, expect, it } from 'vitest';
import {
  amountTolerance,
  amountsAgree,
  keywords,
  payeeAgrees,
  propose,
  proposeIncome,
  proposePayment,
  type Matchable,
} from './match';
import type { IncomeStream, ScheduledPayment } from './types';
import { SEED_INCOME, SEED_PAYMENTS } from '@/lib/data/seed';

/**
 * US-33 (HAD-12).
 *
 * The bias these tests defend: **precision over recall.** No proposal costs the
 * user a dropdown. A wrong proposal invites a mistaken confirmation, and a
 * confirmed wrong match marks an outstanding cheque paid — R-5 with an extra
 * step. So several tests below assert that something is *not* matched.
 */

const txn = (over: Partial<Matchable> = {}): Matchable => ({
  date: '2026-09-29',
  description: 'DEWA SEP BILL',
  amount: 690,
  direction: 'debit',
  ...over,
});

describe('amountTolerance', () => {
  it('is a percentage on small amounts', () => {
    // A utility bill varies month to month; 700 scheduled against 690 billed is
    // the same obligation.
    expect(amountTolerance(700)).toBe(35);
    expect(amountsAgree(700, 690)).toBe(true);
  });

  it('is capped in absolute terms on large ones', () => {
    /*
     * 5% of the 45,000 balloon cheque would be 2,250 — loose enough to match a
     * different obligation entirely, and large amounts are where a wrong match
     * costs the most.
     */
    expect(amountTolerance(45_000)).toBe(50);
    expect(amountsAgree(45_000, 44_000)).toBe(false);
    expect(amountsAgree(45_000, 44_960)).toBe(true);
  });
});

describe('keywords', () => {
  it('drops words too common to be evidence', () => {
    // Without stopwords, "PAYMENT" matches half the scheduled purposes and the
    // payee signal stops being a signal.
    expect(keywords('MONTHLY PAYMENT TRANSFER')).toEqual(new Set());
  });

  it('drops two-character tokens, which collide too easily', () => {
    expect(keywords('Q4 GO TO')).toEqual(new Set());
  });

  it('keeps digits — a card suffix is often the strongest signal there is', () => {
    expect(keywords('POS 4821 CARREFOUR')).toEqual(new Set(['4821', 'CARREFOUR']));
  });
});

describe('payeeAgrees', () => {
  it('matches on a shared significant word', () => {
    expect(payeeAgrees('DEWA SEP BILL', 'DEWA', 'Utilities')).toBe(true);
  });

  it('does not match on stopwords alone', () => {
    expect(payeeAgrees('MONTHLY BILL PAYMENT', 'Landlord', 'Monthly payment')).toBe(false);
  });

  it('an empty description matches nothing', () => {
    expect(payeeAgrees('', 'DEWA')).toBe(false);
  });
});

describe('proposePayment — against the §11 reference data', () => {
  it('DEWA SEP BILL proposes the DEWA payment', () => {
    // 690 vs 700 scheduled, 29 Sep vs 1 Oct due, payee DEWA. All three agree.
    expect(proposePayment(txn(), SEED_PAYMENTS).paymentId).toBe('pay-dewa');
  });

  it('the car-loan debit proposes the car loan', () => {
    /*
     * The seed hand-matched this one. The matcher reaching the same answer
     * independently is the check that matters — the hand-written value was
     * never derived from anything.
     */
    const out = proposePayment(
      txn({ date: '2026-09-28', description: 'ADCB CAR LOAN INSTALMENT', amount: 2_400 }),
      SEED_PAYMENTS,
    );
    expect(out.paymentId).toBe('pay-car');
  });

  it('SALIK TOLL RECHARGE proposes nothing', () => {
    // No scheduled payment covers it. Proposing one would be a wrong answer
    // offered for confirmation.
    const out = proposePayment(
      txn({ description: 'SALIK TOLL RECHARGE', amount: 100 }),
      SEED_PAYMENTS,
    );
    expect(out.paymentId).toBeUndefined();
  });

  it('the right amount and date but the wrong payee proposes nothing', () => {
    // The signal that stops a coincidence becoming a claim.
    const out = proposePayment(
      txn({ description: 'SOMETHING ELSE ENTIRELY', amount: 700, date: '2026-10-01' }),
      SEED_PAYMENTS,
    );
    expect(out.paymentId).toBeUndefined();
  });

  it('the right payee but a date months away proposes nothing', () => {
    const out = proposePayment(txn({ date: '2026-06-01' }), SEED_PAYMENTS);
    expect(out.paymentId).toBeUndefined();
  });

  it('the right payee and date but a wildly wrong amount proposes nothing', () => {
    const out = proposePayment(txn({ amount: 7_000 }), SEED_PAYMENTS);
    expect(out.paymentId).toBeUndefined();
  });

  it('a credit never proposes a payment', () => {
    expect(proposePayment(txn({ direction: 'credit' }), SEED_PAYMENTS).paymentId).toBeUndefined();
  });

  it('a payment already marked paid is not proposed', () => {
    const paid: ScheduledPayment[] = SEED_PAYMENTS.map((p) =>
      p.id === 'pay-dewa' ? { ...p, status: 'paid' as const } : p,
    );
    expect(proposePayment(txn(), paid).paymentId).toBeUndefined();
  });

  it('a derived school-fee row is never proposed', () => {
    /*
     * It has a `fee:<uuid>` id and no scheduled_payments row behind it, so the
     * match could not be stored even if it were right (HAD-81).
     */
    const derived: ScheduledPayment = {
      id: 'fee:f2', dueDate: '2026-09-29', payee: 'GEMS school',
      purpose: 'School fees — Term 2', amount: 690, account: '', type: 'cheque',
      recurrence: 'none', includedInBudget: true, derivedFrom: 'schoolFees',
      status: 'upcoming',
    };
    const out = proposePayment(
      txn({ description: 'GEMS SCHOOL FEE' }),
      [derived],
    );
    expect(out.paymentId).toBeUndefined();
  });

  it('matches a later occurrence of a recurring payment, not just the first', () => {
    /*
     * The claim the occurrence expansion exists for, so it is asserted rather
     * than described. `pay-dewa` is monthly from 2026-10-01 and its stored
     * dueDate never moves. A December statement line must still match it —
     * otherwise the matcher works on the first month of data and quietly stops,
     * which is worse than not working, because the first month looks fine.
     */
    const december = txn({ date: '2026-12-02', description: 'DEWA DEC BILL', amount: 700 });
    expect(proposePayment(december, SEED_PAYMENTS).paymentId).toBe('pay-dewa');

    const march = txn({ date: '2027-03-01', description: 'DEWA BILL', amount: 700 });
    expect(proposePayment(march, SEED_PAYMENTS).paymentId).toBe('pay-dewa');
  });

  it('a date between two occurrences of the same series is not ambiguous', () => {
    // The window is 10 days and monthly occurrences are ~30 apart, so a
    // transaction can never sit equally close to two of them.
    const midway = txn({ date: '2026-11-16', description: 'DEWA BILL', amount: 700 });
    expect(proposePayment(midway, SEED_PAYMENTS).paymentId).toBeUndefined();
  });

  it('picks the nearer date when two candidates agree', () => {
    const near: ScheduledPayment = { ...SEED_PAYMENTS[0], id: 'near', dueDate: '2026-09-29' };
    const far: ScheduledPayment = { ...SEED_PAYMENTS[0], id: 'far', dueDate: '2026-10-03' };
    expect(proposePayment(txn(), [far, near]).paymentId).toBe('near');
  });
});

describe('proposeIncome', () => {
  const salary = txn({
    direction: 'credit',
    description: 'SALARY CREDIT — EMPLOYER LLC',
    amount: 25_000,
    date: '2026-09-25',
  });

  it('a salary credit proposes the salary stream', () => {
    expect(proposeIncome(salary, SEED_INCOME).incomeStreamId).toBe('inc-salary');
  });

  it('a debit never proposes an income stream', () => {
    expect(
      proposeIncome({ ...salary, direction: 'debit' }, SEED_INCOME).incomeStreamId,
    ).toBeUndefined();
  });

  it('an inactive stream is not proposed', () => {
    const inactive: IncomeStream[] = SEED_INCOME.map((s) => ({ ...s, active: false }));
    expect(proposeIncome(salary, inactive).incomeStreamId).toBeUndefined();
  });

  it('a refund is not mistaken for salary', () => {
    // Same direction, wrong amount and payer. Both must disagree for this to be
    // a meaningful test of either.
    const refund = txn({ direction: 'credit', description: 'CARREFOUR REFUND', amount: 120 });
    expect(proposeIncome(refund, SEED_INCOME).incomeStreamId).toBeUndefined();
  });
});

describe('US-33 acceptance — a 50-row statement proposes exactly the right matches', () => {
  it('three matching debits among fifty rows propose exactly three', () => {
    /*
     * The acceptance criterion, stated as a precision test rather than a recall
     * one. Forty-seven rows of ordinary spending must propose nothing at all:
     * a matcher that fires on half of them would be technically finding the
     * three and practically useless, because every proposal it makes would need
     * checking.
     */
    const noise: Matchable[] = Array.from({ length: 47 }, (_, i) => ({
      date: '2026-09-20',
      description: `CARREFOUR MALL OF EMIRATES ${i}`,
      amount: 120 + i,
      direction: 'debit' as const,
    }));

    const real: Matchable[] = [
      { date: '2026-09-29', description: 'DEWA SEP BILL', amount: 690, direction: 'debit' },
      { date: '2026-09-28', description: 'ADCB CAR LOAN INSTALMENT', amount: 2_400, direction: 'debit' },
      { date: '2026-10-09', description: 'ETISALAT HOME BILL', amount: 300, direction: 'debit' },
    ];

    const proposals = [...noise, ...real]
      .map((t) => propose(t, SEED_PAYMENTS, SEED_INCOME))
      .filter((p) => p.paymentId !== undefined);

    expect(proposals).toHaveLength(3);
    expect(proposals.map((p) => p.paymentId).sort()).toEqual(
      ['pay-car', 'pay-dewa', 'pay-etisalat'].sort(),
    );
  });

  it('every proposal carries a reason the inbox can show', () => {
    // A proposal a user cannot evaluate is a proposal they will rubber-stamp.
    const out = propose(txn(), SEED_PAYMENTS, SEED_INCOME);
    expect(out.reason).toContain('DEWA');
  });
});
