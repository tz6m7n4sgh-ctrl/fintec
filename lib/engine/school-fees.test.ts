import { describe, expect, it } from 'vitest';
import { chequeExposure } from './uae';
import { withSchoolFeeObligations } from './school-fees';
import type { SchoolFee } from './types';

const fee: SchoolFee = {
  id: 'fee-1', child: 'Layla', school: 'GEMS', term: 'Term 1',
  dueDate: '2026-10-01', amount: 12_000, paidByCheque: true, paid: false,
};

describe('school fee obligations', () => {
  it('puts a cheque-paid fee on the calendar and in boundary-inclusive exposure', () => {
    const obligations = withSchoolFeeObligations([], [fee]);
    expect(obligations[0]).toMatchObject({ type: 'cheque', includedInBudget: true });
    expect(chequeExposure(obligations, fee.dueDate, 0)).toBe(12_000);
  });

  it('does not duplicate an existing school payment', () => {
    const existing = withSchoolFeeObligations([], [fee])[0];
    expect(withSchoolFeeObligations([existing], [fee])).toHaveLength(1);
  });

  it('carries paid state through to the linked obligation', () => {
    const obligations = withSchoolFeeObligations([], [{ ...fee, paid: true }]);
    expect(obligations[0].status).toBe('paid');
    expect(chequeExposure(obligations, fee.dueDate, 0)).toBe(0);
  });
});
