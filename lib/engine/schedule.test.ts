import { describe, expect, it } from 'vitest';
import { occurrenceCount, occurrenceOn, occurrencesWithin } from './schedule';

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
