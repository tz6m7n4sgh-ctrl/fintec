import type { ScheduledPayment, SchoolFee } from './types';

/**
 * Makes every fee a dated obligation without creating a second persisted copy.
 * Existing scheduled-payment rows win, which keeps legacy data from appearing
 * twice while newly-created fees immediately reach the calendar and exposure.
 */
export function withSchoolFeeObligations(
  payments: ScheduledPayment[],
  fees: SchoolFee[],
): ScheduledPayment[] {
  const alreadyScheduled = (fee: SchoolFee) => payments.some((payment) =>
    payment.dueDate === fee.dueDate
    && payment.amount === fee.amount
    && payment.purpose.toLowerCase().includes('school'),
  );

  const derived: ScheduledPayment[] = fees
    .filter((fee) => !alreadyScheduled(fee))
    .map((fee) => ({
      id: `school-fee:${fee.id}`,
      dueDate: fee.dueDate,
      payee: fee.school || fee.child,
      purpose: `School fees — ${fee.child}, ${fee.term}`,
      amount: fee.amount,
      account: fee.paidByCheque ? 'Cheque record' : '',
      type: fee.paidByCheque ? 'cheque' : 'transfer',
      recurrence: 'none',
      // monthlySchoolFees already places the annual total in monthly burn.
      includedInBudget: true,
      status: fee.paid ? 'paid' : 'upcoming',
    }));

  return [...payments, ...derived];
}
