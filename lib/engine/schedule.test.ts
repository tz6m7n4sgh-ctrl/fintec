import { describe, expect, it } from 'vitest';
import {
  GENERATION_HORIZON_MONTHS,
  expandPayments,
  occurrenceCount,
  occurrenceOn,
  occurrencesWithin,
  scheduledTotalWithin,
} from './schedule';
import type { ScheduledPayment } from './types';

/**
 * These figures drive the 12-month schedule total and, through it, what the
 * user believes they owe. The calculation lived in a page component until now
 * and had never been asserted.
 */

describe('occurrencesWithin', () => {
  it('a one-off inside the window counts once', () => {
    expect(occurrencesWithin('none', '2026-12-10', '2027-09-30')).toEqual(['2026-12-10']);
  });

  it('a one-off after the window does not count', () => {
    expect(occurrencesWithin('none', '2027-12-10', '2027-09-30')).toEqual([]);
  });

  it('monthly rent over a year is twelve cheques', () => {
    expect(occurrenceCount('monthly', '2026-10-01', '2027-09-30')).toBe(12);
  });

  it('quarterly rent over a year is four cheques', () => {
    // The §11 reference profile's rent: 18,000 per quarter from 5 Oct.
    expect(occurrencesWithin('quarterly', '2026-10-05', '2027-09-30')).toEqual([
      '2026-10-05',
      '2027-01-05',
      '2027-04-05',
      '2027-07-05',
    ]);
  });

  it('termly school fees are three per year', () => {
    expect(occurrenceCount('termly', '2026-09-12', '2027-08-31')).toBe(3);
  });

  it('yearly recurs once per window', () => {
    expect(occurrenceCount('yearly', '2026-10-01', '2027-09-30')).toBe(1);
  });

  it('an occurrence landing exactly on the window end is included', () => {
    // Boundary inclusion is not cosmetic here. The projection has already
    // shipped one bug where a cheque at a window edge was silently dropped
    // while the dashboard tile counted it — two figures disagreeing, with the
    // projection the optimistic one.
    expect(occurrencesWithin('monthly', '2027-09-30', '2027-09-30')).toEqual(['2027-09-30']);
  });
});

describe('occurrenceOn — short-month clamping', () => {
  /*
   * The bug this guards against, stated precisely because the obvious version
   * of the claim is wrong.
   *
   * The previous implementation carried the day-of-month across unchanged. From
   * 2026-01-31 over a year it generated:
   *
   *   2026-01-31  2026-02-31  2026-03-31  2026-04-31  ...  2026-12-31
   *
   * Five of those twelve are not calendar dates: 02-31, 04-31, 06-31, 09-31,
   * 11-31.
   *
   * The *count* was nonetheless correct. Nothing parsed those strings — they
   * were only compared lexically against the window end, and '2026-02-31' sorts
   * below '2026-12-31' like any other February string. So the 12-month total
   * has always been right, and this is not a regression being fixed.
   *
   * What was wrong is the dates themselves, which matters the moment anything
   * *uses* one rather than counting it — as this function now does by returning
   * them, and as HAD-25 will when it expands occurrences onto the calendar.
   * `new Date('2026-02-31')` rolls forward to **3 March 2026**. A cheque due at
   * the end of February would be shown three days after it actually clears,
   * which is the R-5 failure mode: the calendar is the thing standing between
   * the user and a bounced cheque.
   */
  it('clamps the 31st to the last day of a 28-day February', () => {
    expect(occurrenceOn('2026-01-31', 1, 1)).toBe('2026-02-28');
  });

  it('clamps the 31st to 29 February in a leap year', () => {
    expect(occurrenceOn('2028-01-31', 1, 1)).toBe('2028-02-29');
  });

  it('clamps the 31st to a 30-day April', () => {
    expect(occurrenceOn('2026-03-31', 1, 1)).toBe('2026-04-30');
  });

  it('does not clamp when the day exists', () => {
    expect(occurrenceOn('2026-01-15', 1, 1)).toBe('2026-02-15');
  });

  it('rolls the year over correctly', () => {
    expect(occurrenceOn('2026-11-05', 3, 1)).toBe('2027-02-05');
  });

  it('a monthly payment on the 31st still produces twelve occurrences', () => {
    // The count was already correct before clamping; this pins it so the fix
    // cannot regress it in the other direction.
    expect(occurrenceCount('monthly', '2026-01-31', '2026-12-31')).toBe(12);
  });

  it('every generated occurrence is a real calendar date', () => {
    // The assertion that would have caught the old behaviour. Twelve months
    // from the 31st previously yielded five strings that are not dates.
    const dates = occurrencesWithin('monthly', '2026-01-31', '2026-12-31');
    expect(dates).toHaveLength(12);
    for (const iso of dates) {
      const [y, m, d] = iso.split('-').map(Number);
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCDate()).toBe(d);
    }
  });
});

/**
 * US-22 / OQ-4 — single-occurrence overrides.
 *
 * The decided model: editing one occurrence detaches it into a standalone
 * payment and the series carries on. The two failure modes this guards are
 * opposites and both are R-5: an occurrence rendered twice inflates what the
 * user believes they owe, and one rendered zero times is a cheque nobody funds.
 */

const series: ScheduledPayment = {
  id: 'ser-rent',
  dueDate: '2026-10-05',
  payee: 'Landlord',
  purpose: 'Rent',
  amount: 18_000,
  account: 'ENBD ··4821',
  type: 'cheque',
  recurrence: 'monthly',
  includedInBudget: false,
  status: 'upcoming',
};

const override = (over: Partial<ScheduledPayment>): ScheduledPayment => ({
  ...series,
  id: 'ovr-1',
  recurrence: 'none',
  seriesId: 'ser-rent',
  detachedDate: '2026-12-05',
  dueDate: '2026-12-05',
  ...over,
});

describe('expandPayments — overrides', () => {
  it('a series with no overrides expands normally', () => {
    const out = expandPayments([series], '2027-01-05');
    expect(out.map((o) => o.date)).toEqual([
      '2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05',
    ]);
    expect(out.every((o) => !o.isOverride)).toBe(true);
  });

  it('an override replaces its occurrence rather than adding to it', () => {
    // The double-count guard. Four dates before, four after — not five.
    const out = expandPayments([series, override({ amount: 19_000 })], '2027-01-05');
    expect(out).toHaveLength(4);
    expect(out.filter((o) => o.date === '2026-12-05')).toHaveLength(1);
    expect(out.find((o) => o.date === '2026-12-05')!.payment.amount).toBe(19_000);
    expect(out.find((o) => o.date === '2026-12-05')!.isOverride).toBe(true);
  });

  it('a moved override leaves its original date empty and appears on the new one', () => {
    // "The December cheque, but on the 20th." detachedDate stays 05 so the
    // series knows to skip it; dueDate moves so the calendar shows the truth.
    const out = expandPayments(
      [series, override({ dueDate: '2026-12-20' })],
      '2027-01-05',
    );
    const dates = out.map((o) => o.date);
    expect(dates).not.toContain('2026-12-05');
    expect(dates).toContain('2026-12-20');
    expect(out).toHaveLength(4);
  });

  it('the series is untouched by the override — later occurrences still generate', () => {
    const out = expandPayments([series, override({})], '2027-03-05');
    expect(out.map((o) => o.date)).toContain('2027-01-05');
    expect(out.map((o) => o.date)).toContain('2027-03-05');
  });

  it('deleting one occurrence is an override with a zero amount, not a gap in the series', () => {
    const out = expandPayments([series, override({ amount: 0 })], '2027-01-05');
    expect(out).toHaveLength(4);
    expect(scheduledTotalWithin([series, override({ amount: 0 })], '2027-01-05')).toBe(54_000);
  });

  it('two different occurrences can both be overridden', () => {
    const out = expandPayments(
      [
        series,
        override({ id: 'o1', detachedDate: '2026-11-05', dueDate: '2026-11-05', amount: 1 }),
        override({ id: 'o2', detachedDate: '2026-12-05', dueDate: '2026-12-05', amount: 2 }),
      ],
      '2027-01-05',
    );
    expect(out).toHaveLength(4);
    expect(out.find((o) => o.date === '2026-11-05')!.payment.amount).toBe(1);
    expect(out.find((o) => o.date === '2026-12-05')!.payment.amount).toBe(2);
  });

  it('an override outside the window does not resurrect its skipped occurrence', () => {
    // If the user pushes the December cheque into next year, December is empty
    // and the payment shows up when it is actually due — not silently dropped
    // from both, which is the shape that loses a cheque.
    const out = expandPayments([series, override({ dueDate: '2027-06-20' })], '2027-01-05');
    expect(out.map((o) => o.date)).not.toContain('2026-12-05');
    expect(out).toHaveLength(3);
    const wide = expandPayments([series, override({ dueDate: '2027-06-20' })], '2027-07-05');
    expect(wide.map((o) => o.date)).toContain('2027-06-20');
  });

  it('an ordinary one-off is unaffected', () => {
    const oneOff: ScheduledPayment = { ...series, id: 'p1', recurrence: 'none', dueDate: '2026-12-10' };
    expect(expandPayments([oneOff], '2027-01-05').map((o) => o.date)).toEqual(['2026-12-10']);
  });

  it('occurrences come back in date order regardless of input order', () => {
    const out = expandPayments([override({ dueDate: '2026-12-20' }), series], '2027-01-05');
    expect(out.map((o) => o.date)).toEqual([...out.map((o) => o.date)].sort());
  });

  it('the generation horizon matches the projection', () => {
    // OQ-4: 18 months, to match DEFAULT_HORIZON_MONTHS. A payment the
    // projection subtracts but the calendar never shows would be two screens
    // disagreeing about one obligation.
    expect(GENERATION_HORIZON_MONTHS).toBe(18);
  });
});
