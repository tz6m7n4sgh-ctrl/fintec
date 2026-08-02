import { addDays, addMonths, formatDate, toEpochDay } from './dates';
import { expandPayments, type Occurrence } from './schedule';
import { isOutstanding } from './settle';
import type { IsoDate, ScheduledPayment } from './types';

/**
 * Funding reminders (US-16 / FR-B2 / BR-4 / R-5).
 *
 * "Fund the account before the cheque lands." This is the highest-consequence
 * message in the app — a bounced cheque in the UAE carries civil and potential
 * criminal consequences — so the schedule of *what should be sent and when* is
 * computed here, pure and tested, rather than inside whatever eventually does
 * the sending.
 *
 * That separation is not tidiness. The transport needs an email provider key
 * and VAPID keys, neither of which this project has; the logic does not need
 * either, and it is the half that can be wrong in a way nobody notices. So it
 * is built, tested and shown on screen first, and the sender is a later, much
 * smaller piece of work that consumes this.
 */

/**
 * Lead times, matching `notification_prefs.lead_days`'s own default.
 *
 * Stated once. The calendar previously hardcoded `[7, 2]` inline, which made
 * three copies of one fact across the schema, the calendar and the settings
 * copy — and a user who changed their lead days would have seen the calendar
 * keep drawing markers on the old ones.
 */
export const DEFAULT_LEAD_DAYS = [7, 2] as const;

export type ReminderChannel = 'email' | 'push';

export interface Reminder {
  /** The payment this is about. Sentinel ids (`fee:…`) included. */
  paymentId: string;
  leadDays: number;
  /** The Asia/Dubai calendar day this should go out. */
  sendOn: IsoDate;
  dueDate: IsoDate;
  payee: string;
  account: string;
  amount: number;
  /** Exactly the copy US-16 asks for. */
  message: string;
}

/**
 * Which payments earn a funding reminder.
 *
 * Cheques and school fees, per US-16, and only while they are outstanding —
 * `isOutstanding` again, the same predicate the exposure tile and the
 * projection use (HAD-82). Reminding someone to fund a cheque that has already
 * cleared is the kind of message that teaches people to ignore the ones that
 * matter.
 *
 * Auto-debits are deliberately excluded even though a failed one is also bad.
 * R-5 is specifically about cheques: the consequence of a bounced cheque is not
 * comparable to a declined direct debit, and a reminder stream diluted with
 * every monthly utility bill stops being read. School fees are in because they
 * are usually paid by cheque and carry the same exposure — after HAD-81 they
 * arrive here as derived payments, so they need no special case beyond this.
 */
export function needsReminder(p: ScheduledPayment): boolean {
  return isOutstanding(p) && (p.type === 'cheque' || p.derivedFrom === 'schoolFees');
}

/**
 * "Fund ENBD ··4821 with AED 18,000 before 5 Oct 2026 — Landlord".
 *
 * `dueDate` is passed rather than read off the payment, because a recurring
 * series carries only its *first* due date. Reading `p.dueDate` here would have
 * printed October's date on January's reminder — a message that is wrong about
 * the one fact it exists to convey, and wrong plausibly.
 */
export function reminderMessage(p: ScheduledPayment, dueDate: IsoDate): string {
  const amount = `AED ${Math.round(p.amount).toLocaleString('en-AE')}`;
  /*
   * A payment with no account named still gets a message. The alternative —
   * skipping it — would silently drop the reminder for exactly the rows most
   * likely to be half-filled in, and "fund your account" without naming one is
   * still a warning the user can act on. Derived school-fee rows have no
   * account at all, and those are R-5 cases.
   */
  const where = p.account ? p.account : 'your account';
  return `Fund ${where} with ${amount} before ${formatDate(dueDate)} — ${p.payee}`;
}

/**
 * Every reminder these **occurrences** imply, earliest first.
 *
 * Occurrences, not payments, and that distinction is the whole feature. A
 * quarterly rent cheque is one row with one `dueDate` and `recurrence:
 * 'quarterly'`; reminding off the row would fire once, in October, and never
 * again — for the largest cheque most people write, on the app whose central
 * promise is that it will not be missed. `expandPayments` already knows how a
 * series unfolds and how a detached override replaces one date, so this reads
 * its output rather than half-reimplementing it.
 *
 * Includes reminders whose send date has already passed. Filtering them out
 * here would make it impossible to tell "no reminder is due" from "the reminder
 * window opened before you were looking" — see `missed()`, which is the whole
 * reason that distinction is kept.
 */
export function remindersFor(
  occurrences: Occurrence[],
  leadDays: readonly number[] = DEFAULT_LEAD_DAYS,
): Reminder[] {
  const out: Reminder[] = [];

  for (const o of occurrences) {
    if (!needsReminder(o.payment)) continue;
    for (const lead of leadDays) {
      out.push({
        paymentId: o.payment.id,
        leadDays: lead,
        sendOn: addDays(o.date, -lead),
        dueDate: o.date,
        payee: o.payment.payee,
        account: o.payment.account,
        amount: o.payment.amount,
        message: reminderMessage(o.payment, o.date),
      });
    }
  }

  return out.sort(
    (a, b) =>
      toEpochDay(a.sendOn) - toEpochDay(b.sendOn) ||
      a.paymentId.localeCompare(b.paymentId) ||
      b.leadDays - a.leadDays,
  );
}

/** How far ahead the reminder view looks. Long enough to cover a term's fees. */
export const REMINDER_HORIZON_MONTHS = 12;

/**
 * The reminders implied by a payment list, expanding recurrences for you.
 *
 * The convenience most callers want, and the one that makes it hard to
 * accidentally remind off un-expanded rows.
 */
export function remindersWithin(
  payments: ScheduledPayment[],
  today: IsoDate,
  leadDays: readonly number[] = DEFAULT_LEAD_DAYS,
  horizonMonths: number = REMINDER_HORIZON_MONTHS,
): Reminder[] {
  /*
   * The window starts before today by the longest lead time, not at today. A
   * cheque due in three days had its 7-day reminder fall due four days ago, and
   * `missed()` cannot report what expansion never produced.
   */
  const longestLead = leadDays.length ? Math.max(...leadDays) : 0;
  const start = addDays(today, -longestLead);
  return remindersFor(
    expandPayments(payments, addMonths(today, horizonMonths), start),
    leadDays,
  );
}

/** The reminders a job running on `day` should send. */
export function dueOn(reminders: Reminder[], day: IsoDate): Reminder[] {
  return reminders.filter((r) => r.sendOn === day);
}

/** Reminders still to come, soonest first. */
export function pending(reminders: Reminder[], today: IsoDate): Reminder[] {
  return reminders.filter((r) => toEpochDay(r.sendOn) >= toEpochDay(today));
}

/**
 * Funding windows that opened before anyone could be told.
 *
 * A payment due in four days has already passed its 7-day reminder. If the user
 * signed up yesterday, or the sender was down, or they simply changed their
 * lead days, nothing will ever fire for it — and the failure is invisible,
 * because "no reminder due today" and "the reminder was due last Tuesday and
 * nobody sent it" look identical from the outside.
 *
 * So they are named. A cheque inside its funding window with no reminder left
 * to send is the exact situation R-5 exists to prevent, and the app can show it
 * on screen today without any provider at all — which is a real channel, not a
 * placeholder for one.
 *
 * Deduplicated to one entry per payment: three missed lead times on the same
 * cheque is one thing to do, not three.
 */
export function missed(reminders: Reminder[], today: IsoDate): Reminder[] {
  const now = toEpochDay(today);
  const seen = new Set<string>();
  const out: Reminder[] = [];

  for (const r of reminders) {
    if (toEpochDay(r.sendOn) >= now) continue; // not missed, still to come
    if (toEpochDay(r.dueDate) < now) continue; // the payment itself is past
    if (seen.has(r.paymentId)) continue;
    seen.add(r.paymentId);
    out.push(r);
  }

  return out.sort((a, b) => toEpochDay(a.dueDate) - toEpochDay(b.dueDate));
}

/**
 * The key that makes sending idempotent, matching `notification_log`'s unique
 * index.
 *
 * `due_date` is in it, and that is a **change** to the original index rather
 * than a restatement of it — see migration 0011. The index shipped as
 * `(user_id, scheduled_payment_id, channel, lead_days)`, with no date, so a
 * quarterly rent cheque reminded in October could never be reminded again in
 * January: one row, one reminder, forever. For recurring cheques — which is
 * what rent is, and rent is the largest cheque most people write — that is the
 * failure this whole feature exists to prevent.
 */
export function reminderKey(r: Reminder, channel: ReminderChannel): string {
  return `${r.paymentId}:${r.dueDate}:${channel}:${r.leadDays}`;
}
