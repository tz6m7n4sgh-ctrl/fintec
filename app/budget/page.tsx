import { Card, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { monthlyActuals } from '@/lib/engine/projection';
import { aed, money, percent } from '@/lib/format/money';

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

  const cut = m.currentTotal - m.survivalTotal;

  return (
    <>
      <PageHead
        title="Budget"
        sub="Current spending against the survival plan · auto rows are computed from their source screens"
      />

      <div className="grid g3">
        <div className="card tile">
          <div className="lbl">Current monthly spend</div>
          <div className="val mono">{money(m.currentTotal)}</div>
          <div className="foot">Sum of all categories</div>
        </div>
        <div className="card tile">
          <div className="lbl">Survival monthly spend</div>
          <div className="val mono">{money(m.survivalTotal)}</div>
          <div className="foot">Drives runway and scenarios</div>
        </div>
        <div className="card tile">
          <div className="lbl">Monthly saving if you switch</div>
          <div className="val mono">{money(cut)}</div>
          <div className="foot">{percent(m.currentTotal ? cut / m.currentTotal : 0)} of current spend</div>
        </div>
      </div>

      <Card
        title="Categories"
        sub="Auto rows are read-only — edit them on the screen that owns the data"
      >
        <div className="tbl-wrap">
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
                const actualTotal = actualByCategory.get(c.id);
                const actualPerMonth = actualTotal === undefined ? undefined : actualTotal / monthsOfActuals;
                return (
                  <tr key={c.id}>
                    <td className="payee">
                      {c.name}
                      {c.autoSource ? <span className="sub">computed — read-only</span> : null}
                    </td>
                    <td className="r mono">{money(c.currentAmount)}</td>
                    <td className="r mono">{money(c.survivalAmount)}</td>
                    <td className="r mono" style={diff > 0 ? { color: 'var(--good-ink)' } : undefined}>
                      {diff > 0 ? `−${money(diff)}` : '—'}
                    </td>
                    <td className="r mono" style={{ color: 'var(--ink-2)' }}>
                      {actualPerMonth === undefined ? '—' : money(actualPerMonth)}
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
                <td className="r mono">{money(m.currentTotal)}</td>
                <td className="r mono">{money(m.survivalTotal)}</td>
                <td className="r mono">−{money(cut)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="How the survival budget drives runway">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1)' }} aria-hidden>→</span>
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
