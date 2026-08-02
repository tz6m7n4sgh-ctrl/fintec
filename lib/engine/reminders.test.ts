import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAD_DAYS,
  dueOn,
  missed,
  needsReminder,
  pending,
  reminderKey,
  reminderMessage,
  remindersFor,
  remindersWithin,
} from './reminders';
import { expandPayments } from './schedule';
import type { ScheduledPayment } from './types';

/**
 * US-16. A bounced cheque in the UAE carries civil and potential criminal
 * consequences, so this is the highest-consequence message the app sends and
 * the one most worth being wrong about loudly rather than quietly.
 *
 * The two properties doing the work here:
 *
 *   - a **recurring** cheque is reminded every time it comes round, not once
 *   - a funding window that opened before anyone could be told is *named*,
 *     rather than being indistinguishable from "nothing due"
 */

const pay = (over: Partial<ScheduledPayment> = {}): ScheduledPayment => ({
  id: 'pay-rent',
  dueDate: '2026-10-05',
  payee: 'Landlord',
  purpose: 'Rent — Q4 cheque',
  amount: 18_000,
  account: 'ENBD ··4821',
  type: 'cheque',
  recurrence: 'none',
  includedInBudget: true,
  status: 'upcoming',
  ...over,
});

const one = (p: ScheduledPayment) => expandPayments([p], '2028-01-01', '2026-01-01');

describe('needsReminder', () => {
  it('covers cheques', () => {
    expect(needsReminder(pay())).toBe(true);
  });

  it('covers derived school-fee terms whatever they are paid by', () => {
    // After HAD-81 a term arrives as a derived payment; one paid by transfer
    // still carries the fee exposure US-16 names.
    expect(needsReminder(pay({ type: 'transfer', derivedFrom: 'schoolFees' }))).toBe(true);
  });

  it('skips auto-debits', () => {
    /*
     * Deliberate, not an oversight. R-5 is about cheques specifically, and a
     * reminder stream diluted with every monthly utility bill stops being read
     * — which would cost exactly the messages this feature exists to deliver.
     */
    expect(needsReminder(pay({ type: 'autoDebit' }))).toBe(false);
  });

  it('skips a cheque that has already cleared', () => {
    // The same `isOutstanding` the exposure tile and the projection use
    // (HAD-82). Telling someone to fund a cheque that cleared is how people
    // learn to ignore the ones that matter.
    expect(needsReminder(pay({ status: 'paid' }))).toBe(false);
  });

  it('keeps an atRisk cheque — it is the one most worth reminding about', () => {
    expect(needsReminder(pay({ status: 'atRisk' }))).toBe(true);
  });
});

describe('reminderMessage', () => {
  it('is exactly the copy US-16 asks for', () => {
    expect(reminderMessage(pay(), '2026-10-05')).toBe(
      'Fund ENBD ··4821 with AED 18,000 before 05 Oct 2026 — Landlord',
    );
  });

  it('uses the occurrence date, not the series start', () => {
    /*
     * The trap. A quarterly series carries only its first due date, so reading
     * `p.dueDate` here would print October on January's reminder — wrong about
     * the single fact the message exists to convey, and wrong plausibly.
     */
    expect(reminderMessage(pay({ recurrence: 'quarterly' }), '2027-01-05')).toContain(
      'before 05 Jan 2027',
    );
  });

  it('still names a target when no account is set', () => {
    // Derived school-fee rows have no account at all, and those are R-5 cases.
    expect(reminderMessage(pay({ account: '' }), '2026-10-05')).toContain('Fund your account');
  });
});

describe('remindersFor', () => {
  it('produces one reminder per lead time, earliest first', () => {
    const r = remindersFor(one(pay()));
    expect(r.map((x) => [x.sendOn, x.leadDays])).toEqual([
      ['2026-09-28', 7],
      ['2026-10-03', 2],
    ]);
  });

  it('reminds a recurring cheque every time it comes round', () => {
    /*
     * The defect this module exists to avoid. Reminding off the payment row
     * rather than its occurrences fires once, in October, and never again —
     * on rent, which is the largest cheque most people write.
     */
    const r = remindersFor(one(pay({ recurrence: 'quarterly' })));
    const sevens = r.filter((x) => x.leadDays === 7).map((x) => x.dueDate);
    expect(sevens.length).toBeGreaterThan(4);
    expect(sevens.slice(0, 3)).toEqual(['2026-10-05', '2027-01-05', '2027-04-05']);
  });

  it('honours custom lead days', () => {
    const r = remindersFor(one(pay()), [1]);
    expect(r).toHaveLength(1);
    expect(r[0].sendOn).toBe('2026-10-04');
  });

  it('produces nothing when lead days are empty', () => {
    // A user who clears every lead time has asked for no reminders. That must
    // be an empty list, not a crash and not a silent fallback to the default.
    expect(remindersFor(one(pay()), [])).toEqual([]);
  });

  it('matches the schema default', () => {
    expect([...DEFAULT_LEAD_DAYS]).toEqual([7, 2]);
  });
});

describe('dueOn / pending', () => {
  const r = remindersFor(one(pay()));

  it('picks exactly the day a job runs', () => {
    expect(dueOn(r, '2026-09-28').map((x) => x.leadDays)).toEqual([7]);
    expect(dueOn(r, '2026-09-29')).toEqual([]);
  });

  it('pending includes today, so a job that runs late still sends', () => {
    expect(pending(r, '2026-09-28')).toHaveLength(2);
    expect(pending(r, '2026-10-04')).toHaveLength(0);
  });
});

describe('missed — the failure that otherwise looks like silence', () => {
  it('names a cheque already inside its funding window', () => {
    /*
     * "No reminder due today" and "the reminder was due last Tuesday and
     * nobody sent it" are identical from the outside. This is the only thing
     * that tells them apart — and it is a channel that needs no email provider
     * at all, which is why it ships before the sender does.
     */
    const r = remindersWithin([pay()], '2026-10-01');
    // The 7-day reminder fell due on 28 Sep; today is 1 Oct.
    expect(missed(r, '2026-10-01').map((x) => x.dueDate)).toEqual(['2026-10-05']);
  });

  it('reports one entry per payment, not one per missed lead time', () => {
    // Three missed lead times on one cheque is one thing to do.
    const r = remindersWithin([pay()], '2026-10-04', [7, 5, 3]);
    expect(missed(r, '2026-10-04')).toHaveLength(1);
  });

  it('says nothing before the window opens', () => {
    expect(missed(remindersWithin([pay()], '2026-09-20'), '2026-09-20')).toEqual([]);
  });

  it('drops a payment whose due date has passed', () => {
    // Past due is a different problem, and telling someone to fund a cheque
    // that has already landed is worse than saying nothing.
    expect(missed(remindersWithin([pay()], '2026-10-10'), '2026-10-10')).toEqual([]);
  });

  it('says nothing about a cheque that cleared inside its window', () => {
    const r = remindersWithin([pay({ status: 'paid' })], '2026-10-01');
    expect(missed(r, '2026-10-01')).toEqual([]);
  });
});

describe('remindersWithin', () => {
  it('looks back far enough to see a window that already opened', () => {
    /*
     * Expansion starting at today would never produce the 28 Sep reminder for
     * a 5 Oct cheque, and `missed()` cannot report what was never generated.
     * The window starts one longest-lead before today for exactly this.
     */
    const r = remindersWithin([pay()], '2026-10-01');
    expect(r.some((x) => x.sendOn === '2026-09-28')).toBe(true);
  });

  it('ignores payment types that earn no reminder', () => {
    expect(remindersWithin([pay({ type: 'autoDebit' })], '2026-09-01')).toEqual([]);
  });
});

describe('reminderKey', () => {
  it('includes the due date, so a recurring cheque is not sent once forever', () => {
    /*
     * `notification_log`'s original unique index was
     * (user_id, scheduled_payment_id, channel, lead_days) — no date. One row,
     * one reminder, forever. Migration 0011 adds the date; this key is the
     * application-side half of that fix, and this assertion is what would fail
     * if either half were reverted.
     */
    const r = remindersFor(one(pay({ recurrence: 'quarterly' })));
    const sevens = r.filter((x) => x.leadDays === 7);
    const keys = new Set(sevens.map((x) => reminderKey(x, 'email')));
    expect(keys.size).toBe(sevens.length);
  });

  it('separates the channels', () => {
    const [first] = remindersFor(one(pay()));
    expect(reminderKey(first, 'email')).not.toBe(reminderKey(first, 'push'));
  });

  it('separates the lead times', () => {
    const [seven, two] = remindersFor(one(pay()));
    expect(reminderKey(seven, 'email')).not.toBe(reminderKey(two, 'email'));
  });
});
