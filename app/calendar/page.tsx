import { Card, PageHead } from '@/components/ui';
import { addDays, daysInMonth, daysUntil, formatDate, parseIso, toIso } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { RULES } from '@/lib/engine/uae';
import { money } from '@/lib/format/money';
import type { ScheduledPayment } from '@/lib/engine/types';

/** Which visual class a payment gets on the grid. Cheques must stand out (BR-4). */
function eventClass(p: ScheduledPayment): string {
  if (p.type === 'cheque') return 'cheque';
  if (p.purpose.toLowerCase().includes('debt')) return 'emi';
  if (p.purpose.toLowerCase().includes('school')) return 'school';
  return 'bill';
}

interface DayEvent {
  cls: string;
  title: string;
  detail?: string;
}

export default async function CalendarPage() {
  const m = await getReadModel();
  const d = m.readiness.deadlines;

  // The calendar opens on the month containing the last working day — that is
  // where the deadlines cluster and where attention is needed.
  const { y: year, m: month } = parseIso(m.profile.expectedLastDay);
  const monthStart = toIso({ y: year, m: month, d: 1 });
  const monthLen = daysInMonth(year, month);
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-AE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // Build a Monday-first grid.
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells: Array<{ iso: string | null; dayNum: number; outside: boolean }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ iso: null, dayNum: 0, outside: true });
  for (let day = 1; day <= monthLen; day++) {
    cells.push({ iso: toIso({ y: year, m: month, d: day }), dayNum: day, outside: false });
  }
  while (cells.length % 7 !== 0) cells.push({ iso: null, dayNum: 0, outside: true });

  // Index events by date.
  const events = new Map<string, DayEvent[]>();
  const push = (iso: string, e: DayEvent) => {
    events.set(iso, [...(events.get(iso) ?? []), e]);
  };

  for (const p of m.obligations) {
    push(p.dueDate, {
      cls: eventClass(p),
      title: p.type === 'cheque' ? `◆ ${p.payee.split('—')[0].trim()}` : p.payee,
      detail: money(p.amount),
    });
    // Funding reminders at 7 and 2 days before each cheque and school fee.
    if (p.type === 'cheque') {
      for (const lead of [7, 2]) {
        const remind = addDays(p.dueDate, -lead);
        push(remind, { cls: 'cheque', title: `Fund account`, detail: `${lead} days` });
      }
    }
  }

  push(m.profile.expectedLastDay, { cls: 'legal', title: 'Last working day' });
  push(d.settlementDue, { cls: 'legal', title: '▲ Settlement due', detail: money(m.readiness.settlement.finalSettlement) });
  push(d.iloeDeadline, { cls: 'legal', title: '✕ ILOE deadline', detail: 'hard' });
  push(d.visaGraceEnd, { cls: 'legal', title: '▲ Visa grace ends' });

  const deadlineRows = [
    {
      icon: '▲',
      tone: 'warning' as const,
      name: 'Final settlement due from employer',
      detail: `${formatDate(d.settlementDue)} · ${RULES.SETTLEMENT_DUE_DAYS} days after last day · compare against AED ${money(m.readiness.settlement.finalSettlement)} · MOHRE 600 590 000`,
      days: daysUntil(d.settlementDue),
    },
    {
      icon: '✕',
      tone: 'critical' as const,
      name: 'ILOE claim deadline — hard',
      detail: `${formatDate(d.iloeDeadline)} · ${RULES.ILOE_CLAIM_DAYS} days after last day · iloe.ae · Emirates ID + termination letter + permit cancellation`,
      days: daysUntil(d.iloeDeadline),
    },
    {
      icon: '▲',
      tone: 'serious' as const,
      name: 'Visa grace period ends',
      detail: `${formatDate(d.visaGraceEnd)} · ${m.profile.visaGraceDays} days after last day · AED ${RULES.OVERSTAY_AED_PER_DAY}/day overstay after this date`,
      days: daysUntil(d.visaGraceEnd),
    },
  ];

  const agenda = [...m.obligations]
    .filter((p) => p.dueDate >= m.profile.expectedLastDay)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 12);

  return (
    <>
      <PageHead
        title="Payment calendar"
        sub="All scheduled outflows, cheques and legal deadlines · Asia/Dubai"
      />

      <Card
        title="Legal deadlines — pinned"
        sub={`Counted from your last working day, ${formatDate(m.profile.expectedLastDay)}`}
      >
        <div>
          {deadlineRows.map((row) => (
            <div className="dl-row" key={row.name}>
              <span className="ic" style={{ color: `var(--${row.tone})` }} aria-hidden>{row.icon}</span>
              <div className="t">
                <div className="n">{row.name}</div>
                <div className="d">{row.detail}</div>
              </div>
              <span
                className="count"
                style={{
                  borderColor: `color-mix(in oklab, var(--${row.tone}) 55%, transparent)`,
                  color: row.tone === 'critical' ? 'var(--critical-ink)' : 'var(--ink-1)',
                  background: `color-mix(in oklab, var(--${row.tone}) 14%, transparent)`,
                }}
              >
                {row.days >= 0 ? `${row.days} days` : `${Math.abs(row.days)} days ago`}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="cal-top">
          <div style={{ fontWeight: 650, fontSize: 15 }}>{monthName}</div>
          <div className="card-sub">Reminders fire 7 and 2 days before each cheque, by email and web push</div>
        </div>

        <div className="dow">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => (
            <div key={x}>{x}</div>
          ))}
        </div>
        <div className="weeks">
          {cells.map((c, i) => {
            const evs = c.iso ? events.get(c.iso) ?? [] : [];
            const isLastDay = c.iso === m.profile.expectedLastDay;
            return (
              <div
                key={i}
                className={`day${c.outside ? ' out' : ''}${isLastDay ? ' today' : ''}`}
              >
                <div className="dnum">{c.outside ? '' : c.dayNum}</div>
                {evs.map((e, j) => (
                  <div className={`ev ${e.cls}`} key={j}>
                    <b>{e.title}</b>
                    {e.detail ? <span className="amt-s">{e.detail}</span> : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div className="cal-hint">
          On a phone each day shows coloured dots — use the agenda below for amounts.
        </div>
        <div className="legend">
          <span className="key"><span className="sw" style={{ background: 'var(--critical)' }} /> ◆ Cheque — cannot bounce</span>
          <span className="key"><span className="sw" style={{ background: 'var(--s1)' }} /> Loan / EMI</span>
          <span className="key"><span className="sw" style={{ background: 'var(--s2)' }} /> School fees</span>
          <span className="key"><span className="sw" style={{ background: 'var(--s3)' }} /> Bill / auto-debit</span>
          <span className="key"><span className="sw" style={{ background: 'var(--warning)' }} /> Legal deadline</span>
        </div>
      </Card>

      <Card title="Agenda" sub="Every obligation from your last working day onwards">
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr>
                <th>Date</th><th>Payee / item</th><th>Type</th><th>Account</th>
                <th className="r">Amount</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {agenda.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{formatDate(p.dueDate)}</td>
                  <td className="payee">
                    {p.payee}
                    <span className="sub">{p.purpose}</span>
                  </td>
                  <td>
                    {p.type === 'cheque' ? (
                      <span className="pill cheque"><span aria-hidden>◆</span> Cheque</span>
                    ) : (
                      <span className="pill">{p.type === 'autoDebit' ? 'Auto-debit' : 'Transfer'}</span>
                    )}
                  </td>
                  <td>{p.account}</td>
                  <td className="r amt mono">{money(p.amount)}</td>
                  <td>
                    {p.status === 'atRisk' ? (
                      <span className="pill risk"><span aria-hidden>▲</span> Fund by {formatDate(addDays(p.dueDate, -2)).slice(0, 6)}</span>
                    ) : p.status === 'paid' ? (
                      <span className="pill ok"><span aria-hidden>✓</span> Paid</span>
                    ) : (
                      <span className="pill">Upcoming</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
