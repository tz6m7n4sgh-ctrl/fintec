import { Card, PageHead } from '@/components/ui';
import { formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { DebtsEditor } from './DebtsEditor';
import { SchoolFeesEditor } from './SchoolFeesEditor';
import { monthlyDebtService, monthlySchoolFees } from '@/lib/engine/uae';
import { isOutstanding } from '@/lib/engine/settle';
import { aed, money } from '@/lib/format/money';

const DEBT_LABEL: Record<string, string> = {
  carLoan: 'Car loan', mortgage: 'Mortgage', personalLoan: 'Personal loan',
  creditCard: 'Credit card', other: 'Other',
};

export default async function LoansPage() {
  const m = await getReadModel();
  const debtService = monthlyDebtService(m.debts);
  const schoolMonthly = monthlySchoolFees(m.schoolFees);
  const outstanding = m.debts.reduce((s, d) => s + d.outstandingBalance, 0);
  /*
   * Every cheque, cleared ones included — this table is a register of what has
   * been written, and a cheque you wrote is worth being able to look up after
   * it clears. The exposure *total* below is a different question, so it sums
   * only what is still outstanding (HAD-82); before that split, the total row
   * said "exposure" while counting cleared cheques, and sat directly above the
   * engine's 6-month figure that did not.
   */
  const cheques = m.payments.filter((p) => p.type === 'cheque');
  const outstandingCheques = cheques.filter(isOutstanding);
  const clearedCount = cheques.length - outstandingCheques.length;
  const unpaidFees = m.schoolFees.filter((f) => !f.paid);

  return (
    <>
      <PageHead
        title="Loans, mortgage, school fees & cheques"
        sub="The obligations that feed the budget auto rows and the payment calendar"
      />

      <div className="grid g3">
        <div className="card tile">
          <div className="lbl">Monthly debt service</div>
          <div className="val tnum">{money(debtService)}</div>
          <div className="foot">Feeds the budget auto row</div>
        </div>
        <div className="card tile">
          <div className="lbl">Total outstanding</div>
          <div className="val tnum">{money(outstanding)}</div>
          <div className="foot">{m.debts.length} facilities</div>
        </div>
        <div className="card tile">
          <div className="lbl">School fees / month</div>
          <div className="val tnum">{money(schoolMonthly)}</div>
          <div className="foot">Annual {money(schoolMonthly * 12)} ÷ 12</div>
        </div>
      </div>

      <Card title="Debts" sub="Monthly payments total into the read-only budget row">
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
                <th>Name</th><th>Type</th><th>Lender</th>
                <th className="r">Outstanding</th><th className="r">Monthly</th><th className="r">Months left</th>
              </tr>
            </thead>
            <tbody>
              {m.debts.map((d) => (
                <tr key={d.id}>
                  <td className="payee">{d.name}</td>
                  <td><span className="pill">{DEBT_LABEL[d.type]}</span></td>
                  <td>{d.lender}</td>
                  <td className="r tnum">{money(d.outstandingBalance)}</td>
                  <td className="r amt tnum">{money(d.monthlyPayment)}</td>
                  <td className="r tnum">{d.monthsRemaining}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <td colSpan={3}>Total</td>
                <td className="r tnum">{money(outstanding)}</td>
                <td className="r tnum">{money(debtService)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
          </>
        ) : (
          <DebtsEditor debts={m.debts} />
        )}
      </Card>

      <Card title="School fees" sub={`${unpaidFees.length} of ${m.schoolFees.length} terms still to pay`}>
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
                <th>Child</th><th>School</th><th>Term</th><th>Due</th>
                <th className="r">Amount</th><th>Cheque</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {m.schoolFees.map((f) => (
                <tr key={f.id}>
                  <td className="payee">{f.child}</td>
                  <td>{f.school}</td>
                  <td>{f.term}</td>
                  <td className="tnum">{formatDate(f.dueDate)}</td>
                  <td className="r amt tnum">{money(f.amount)}</td>
                  <td>{f.paidByCheque ? <span className="pill cheque"><span aria-hidden>◆</span> Yes</span> : <span className="pill">No</span>}</td>
                  <td>{f.paid ? <span className="pill ok"><span aria-hidden>✓</span> Paid</span> : <span className="pill">Due</span>}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <td colSpan={4}>Annual total</td>
                <td className="r tnum">{money(m.schoolFees.reduce((s, f) => s + f.amount, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        </>
        ) : (
          <SchoolFeesEditor fees={m.schoolFees} />
        )}
      </Card>

      <Card
        title="Post-dated cheques"
        sub="A bounced cheque in the UAE carries civil and potential criminal consequences — these cannot be missed"
      >
        <div className="tbl-wrap" tabIndex={0}>
          <table className="wide">
            <thead>
              <tr>
                <th>Due</th><th>Payee</th><th>Purpose</th><th>Account</th>
                <th className="r">Amount</th><th>Status</th><th>In budget</th>
              </tr>
            </thead>
            <tbody>
              {cheques.map((p) => (
                <tr key={p.id}>
                  <td className="tnum">{formatDate(p.dueDate)}</td>
                  <td className="payee">{p.payee}</td>
                  <td>{p.purpose}</td>
                  <td>{p.account}</td>
                  <td className="r amt tnum">{money(p.amount)}</td>
                  {/*
                    Without this column a cleared cheque was indistinguishable
                    from one still to fund, on a card headed "these cannot be
                    missed". The schedule and the calendar have shown it all
                    along; this table was the one that did not.
                  */}
                  <td>
                    {p.status === 'atRisk' ? (
                      <span className="pill risk"><span aria-hidden>▲</span> At risk</span>
                    ) : p.status === 'paid' ? (
                      <span className="pill ok"><span aria-hidden>✓</span> Cleared</span>
                    ) : (
                      <span className="pill">Due</span>
                    )}
                  </td>
                  <td>
                    {p.includedInBudget
                      ? <span className="pill ok"><span aria-hidden>✓</span> Yes</span>
                      : <span className="pill"><span aria-hidden>✕</span> No</span>}
                  </td>
                </tr>
              ))}
              <tr className="tot-row">
                <td colSpan={4}>
                  Still to fund
                  {clearedCount > 0 ? (
                    <span style={{ fontWeight: 400, color: 'var(--ink-3)' }}>
                      {' '}— excludes {clearedCount} cleared
                    </span>
                  ) : null}
                </td>
                <td className="r tnum">
                  {money(outstandingCheques.reduce((s, p) => s + p.amount, 0))}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Cheques inside 6 months of your last day: <b style={{ marginLeft: 4 }}>{aed(m.readiness.deadlines.cheques6m)}</b>
          </span>
        </div>
      </Card>
    </>
  );
}
