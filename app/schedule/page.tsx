import { Card, PageHead } from '@/components/ui';
import { addDays, formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { occurrenceCount } from '@/lib/engine/schedule';
import { PaymentsEditor } from './PaymentsEditor';
import { RULES, chequesInWindow } from '@/lib/engine/uae';
import { aed, money } from '@/lib/format/money';

const RECURRENCE_LABEL: Record<string, string> = {
  none: 'One-off',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  termly: 'Termly',
  yearly: 'Yearly',
};

export default async function SchedulePage() {
  const m = await getReadModel();
  const last = m.profile.expectedLastDay;
  const end6 = addDays(last, RULES.CHEQUE_WINDOW_6M);
  const end12 = addDays(last, RULES.CHEQUE_WINDOW_12M);

  const rows = [...m.payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const monthlyCommitted = m.payments
    .filter((p) => p.recurrence === 'monthly')
    .reduce((s, p) => s + p.amount, 0);

  // From the engine, not rebuilt here: these counts render directly beside
  // `deadlines.cheques6m` and `cheques12m`, so a filter that disagreed by one
  // cheque would put "113,000" next to a count that does not produce it
  // (HAD-82).
  const cheques6 = chequesInWindow(m.payments, last, RULES.CHEQUE_WINDOW_6M);
  const cheques12 = chequesInWindow(m.payments, last, RULES.CHEQUE_WINDOW_12M);
  const outOfBudget = m.payments.filter((p) => !p.includedInBudget);

  // 12-month total expands recurrences, so a monthly bill counts 12 times.
  const total12 = m.payments.reduce(
    (s, p) => s + p.amount * occurrenceCount(p.recurrence, p.dueDate, end12),
    0,
  );

  const inBudgetChequeExposure = cheques12
    .filter((p) => p.includedInBudget)
    .reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <PageHead
        title="Schedule"
        sub="Every recurring and one-off obligation · this is the source the calendar and projection are built from"
      />

      <div className="grid g4">
        <div className="card tile">
          <div className="lbl">Monthly committed</div>
          <div className="val tnum">{money(monthlyCommitted)}</div>
          <div className="foot">EMIs + bills, recurring</div>
        </div>
        <div className="card tile">
          <div className="lbl">Cheques — next 6 months</div>
          <div className="val tnum">{money(m.readiness.deadlines.cheques6m)}</div>
          <div className="foot">{cheques6.length} cheques</div>
        </div>
        <div className="card tile">
          <div className="lbl">Cheques — next 12 months</div>
          <div className="val tnum">{money(m.readiness.deadlines.cheques12m)}</div>
          <div className="foot">{cheques12.length} cheques</div>
        </div>
        <div className="card tile">
          <div className="lbl">Not in monthly budget</div>
          <div className="val tnum">{money(outOfBudget.reduce((s, p) => s + p.amount, 0))}</div>
          <div className="foot">Hits the projection as lump sums</div>
        </div>
      </div>

      <Card
        title="Scheduled payments"
        sub={
          m.isSeedData
            ? '"In budget" means the amount is already inside a monthly budget line, so the projection must not subtract it twice'
            : 'Add every cheque and standing obligation. "In budget" decides whether the projection counts it once or twice'
        }
      >
        {m.isSeedData ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
              These are the §11 reference figures. <b>Sign in to record your own</b> — editing is
              disabled here because there is no account to save them against.
            </p>
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr>
                <th>Next due</th><th>Payee</th><th>Purpose</th><th>Type</th>
                <th>Recurrence</th><th>Account</th><th className="r">Amount</th>
                <th>In budget</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="tnum">{formatDate(p.dueDate)}</td>
                  <td className="payee">{p.payee}</td>
                  <td>{p.purpose}</td>
                  <td>
                    {p.type === 'cheque' ? (
                      <span className="pill cheque"><span aria-hidden>◆</span> Cheque</span>
                    ) : (
                      <span className="pill">{p.type === 'autoDebit' ? 'Auto-debit' : 'Transfer'}</span>
                    )}
                  </td>
                  <td>{RECURRENCE_LABEL[p.recurrence]}</td>
                  <td>{p.account}</td>
                  <td className="r amt tnum">{money(p.amount)}</td>
                  <td>
                    {p.includedInBudget ? (
                      <span className="pill ok"><span aria-hidden>✓</span> Yes</span>
                    ) : (
                      <span className="pill"><span aria-hidden>✕</span> No</span>
                    )}
                  </td>
                  <td>
                    {p.status === 'atRisk' ? (
                      <span className="pill risk"><span aria-hidden>▲</span> At risk</span>
                    ) : p.status === 'paid' ? (
                      <span className="pill ok"><span aria-hidden>✓</span> Paid</span>
                    ) : (
                      <span className="pill">Upcoming</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="tot-row">
                <td colSpan={6}>Total — next 12 months (recurrences expanded)</td>
                <td className="r tnum">{money(total12)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
          </>
        ) : (
          <PaymentsEditor payments={m.payments} categories={m.budget} />
        )}
      </Card>

      <Card title="Why some cheques sit outside the budget">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>◆</span>
            <span>
              {outOfBudget.map((p) => `${p.payee} (${money(p.amount)})`).join(' and ')}{' '}
              {outOfBudget.length === 1 ? 'is' : 'are'} marked <b>not in budget</b> — no monthly
              budget line covers {outOfBudget.length === 1 ? 'it' : 'them'}, so the projection
              subtracts {outOfBudget.length === 1 ? 'it' : 'them'} as lump sums.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s3)' }} aria-hidden>✓</span>
            <span>
              Rent, school and EMI cheques are <b>in budget</b> — already inside the monthly burn
              of {aed(m.survivalTotal)}. Subtracting them again would understate runway by{' '}
              {aed(inBudgetChequeExposure)} over 12 months.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--warning)' }} aria-hidden>▲</span>
            <span>
              Each in-budget item links to exactly one budget line. The database enforces this with
              a check constraint, so an in-budget payment cannot exist without naming its line.
            </span>
          </li>
        </ul>
      </Card>
    </>
  );
}
