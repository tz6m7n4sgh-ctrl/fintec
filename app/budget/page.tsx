import { Card, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { monthlyActuals } from '@/lib/engine/projection';
import { aed, money, percent } from '@/lib/format/money';
import { BudgetEditor } from './BudgetEditor';

export default async function BudgetPage() {
  const m = await getReadModel();

  // Budget vs actual: only confirmed, non-duplicate transactions count (US-25/31).
  const actualByCategory = new Map<string, number>();
  for (const t of m.transactions) {
    if (t.isDuplicate || t.reviewStatus === 'pending' || t.direction !== 'debit') continue;
    if (!t.categoryId) continue;
    actualByCategory.set(t.categoryId, (actualByCategory.get(t.categoryId) ?? 0) + t.amount);
  }
  const monthsOfActuals = monthlyActuals(m.transactions).length || 1;
  const actualPerMonth = Object.fromEntries(
    [...actualByCategory].map(([id, total]) => [id, total / monthsOfActuals]),
  );

  const cut = m.currentTotal - m.survivalTotal;

  return (
    <>
      <PageHead
        title="Budget"
        sub={
          m.isSeedData
            ? 'Current spending against the survival plan · auto rows are computed from their source screens'
            : 'Edit a line and watch the runway respond · auto rows are computed from their source screens'
        }
      />

      {m.isSeedData ? (
        <>
          <div className="grid g3">
            <div className="card tile">
              <div className="lbl">Current monthly spend</div>
              <div className="val tnum">{money(m.currentTotal)}</div>
              <div className="foot">Sum of all categories</div>
            </div>
            <div className="card tile">
              <div className="lbl">Survival monthly spend</div>
              <div className="val tnum">{money(m.survivalTotal)}</div>
              <div className="foot">Drives runway and scenarios</div>
            </div>
            <div className="card tile">
              <div className="lbl">Monthly saving if you switch</div>
              <div className="val tnum">{money(cut)}</div>
              <div className="foot">
                {percent(m.currentTotal ? cut / m.currentTotal : 0)} of current spend
              </div>
            </div>
          </div>

          <Card
            title="Categories"
            sub="Auto rows are read-only — edit them on the screen that owns the data"
          >
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
              These are the §11 reference figures. <b>Sign in to build your own budget</b> — editing
              is disabled here because there is no account to save it against.
            </p>
            <div className="tbl-wrap" tabIndex={0}>
              <table className="wide">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th className="r">Current</th>
                    <th className="r">Survival</th>
                    <th className="r">Difference</th>
                    <th className="r">Actual / mo</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {m.budget.map((c) => {
                    const diff = c.currentAmount - c.survivalAmount;
                    return (
                      <tr key={c.id}>
                        <td className="payee">
                          {c.name}
                          {c.autoSource ? <span className="sub">computed — read-only</span> : null}
                        </td>
                        <td className="r tnum">{money(c.currentAmount)}</td>
                        <td className="r tnum">{money(c.survivalAmount)}</td>
                        <td
                          className="r tnum"
                          style={diff > 0 ? { color: 'var(--good-ink)' } : undefined}
                        >
                          {diff > 0 ? `−${money(diff)}` : '—'}
                        </td>
                        <td className="r tnum" style={{ color: 'var(--ink-2)' }}>
                          {actualPerMonth[c.id] === undefined ? '—' : money(actualPerMonth[c.id])}
                        </td>
                        <td>
                          {c.autoSource === 'debts' ? (
                            <a className="pill" href="/loans">Loans →</a>
                          ) : c.autoSource === 'schoolFees' ? (
                            <a className="pill" href="/loans">School fees →</a>
                          ) : (
                            <span className="pill">Editable</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="tot-row">
                    <td>Total</td>
                    <td className="r tnum">{money(m.currentTotal)}</td>
                    <td className="r tnum">{money(m.survivalTotal)}</td>
                    <td className="r tnum">−{money(cut)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <BudgetEditor
          categories={m.budget}
          totalResources={m.readiness.runway.totalResources}
          monthlySideIncome={m.profile.monthlySideIncome}
          savedRunwayMonths={m.readiness.runway.runwayMonths}
          actualPerMonth={actualPerMonth}
        />
      )}

      <Card title="How the survival budget drives runway">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>→</span>
            <span>
              Runway uses the <b>survival</b> total ({aed(m.survivalTotal)}), less side income of{' '}
              {aed(m.profile.monthlySideIncome)}, giving a net burn of{' '}
              <b>{aed(m.readiness.runway.netMonthlyBurn)}</b> per month.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--warning)' }} aria-hidden>▲</span>
            <span>
              &quot;Actual / mo&quot; is the average of confirmed statement transactions across{' '}
              {monthsOfActuals} month{monthsOfActuals === 1 ? '' : 's'}. Rows still pending review
              are excluded — nothing counts as actual until you confirm it.
            </span>
          </li>
        </ul>
      </Card>
    </>
  );
}
