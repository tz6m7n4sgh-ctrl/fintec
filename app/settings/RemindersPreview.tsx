import { Card } from '@/components/ui';
import { formatDate } from '@/lib/engine/dates';
import { missed, pending, type Reminder } from '@/lib/engine/reminders';
import type { IsoDate } from '@/lib/engine/types';

/**
 * What US-16 would send (HAD-13).
 *
 * A server component and a plain table, because the schedule is the deliverable
 * here. The sender needs an email provider key, VAPID keys and a daily job;
 * none of those exist, and none of them are needed to answer the question the
 * user actually has — *"will I be told before the rent cheque lands?"*
 *
 * Showing the answer on screen is a real channel, not a mock of one. It cannot
 * reach someone who is not looking, which is exactly what the email is for and
 * exactly what the card above says.
 */

/** Enough to see the next couple of cheques without becoming a wall of rows. */
const SHOWN = 8;

export function RemindersPreview({
  reminders,
  today,
}: {
  reminders: Reminder[];
  today: IsoDate;
}) {
  const overdue = missed(reminders, today);
  const upcoming = pending(reminders, today).slice(0, SHOWN);
  const hidden = Math.max(0, pending(reminders, today).length - SHOWN);

  return (
    <Card title="Your reminder schedule" sub="Computed from your cheques and school fees">
      {overdue.length > 0 ? (
        /*
          The reason `missed()` exists. A cheque already inside its funding
          window has no reminder left to send — the 7-day one fell due before
          anybody could act on it — and "no reminder due today" looks exactly
          like "the reminder was due last Tuesday and nobody sent it".

          This is the one place that tells them apart, and it needs no provider
          at all.
        */
        <div role="alert" style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--critical-ink)', marginTop: 0 }}>
            <b>▲ {overdue.length} payment{overdue.length === 1 ? ' is' : 's are'} already inside the
            funding window.</b> No reminder is left to send for {overdue.length === 1 ? 'it' : 'them'}
            {' '}— the lead time passed. Fund now rather than waiting to be told.
          </p>
          <ul className="insights">
            {overdue.map((r) => (
              <li key={`${r.paymentId}-${r.dueDate}`}>
                <span className="ic" style={{ color: 'var(--critical-ink)' }} aria-hidden>▲</span>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {upcoming.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4, marginBottom: 0 }}>
          No funding reminders are scheduled. That means no cheque or school-fee term is
          outstanding within the next year — not that reminders are off.
        </p>
      ) : (
        <>
          <div className="tbl-wrap" tabIndex={0}>
            <table className="wide">
              <thead>
                <tr>
                  <th>Send on</th>
                  <th>Lead</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((r) => (
                  <tr key={`${r.paymentId}-${r.dueDate}-${r.leadDays}`}>
                    <td className="tnum">{formatDate(r.sendOn)}</td>
                    <td className="tnum">{r.leadDays}d</td>
                    <td>{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hidden > 0 ? (
            <div className="legend">
              <span className="key">
                {hidden} more scheduled beyond these. Said rather than silently truncated — a
                list that stops without saying so reads as a complete one.
              </span>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
