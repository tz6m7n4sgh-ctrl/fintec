import Link from 'next/link';
import { ActualSpendChart, BudgetBars, ProjectionChart } from '@/components/charts';
import { Card, Money, PageHead, RunwayStatusBadge, ScenarioBadge, StatTile } from '@/components/ui';
import { formatDate, formatMonthShort } from '@/lib/engine/dates';
import { RULES, chequesInWindow, monthlyDebtService } from '@/lib/engine/uae';
import { getReadModel } from '@/lib/data/store';
import { aed, money, months, percent } from '@/lib/format/money';
import { RuleBasisPanel } from '@/components/RuleBasisPanel';

export default async function DashboardPage() {
  const m = await getReadModel();
  const { readiness: r, projection, actuals } = m;

  // Insights are derived, never hardcoded — they must stay true if inputs change.
  const fixed =
    monthlyDebtService(m.debts) +
    (m.budget.find((c) => c.autoSource === 'schoolFees')?.survivalAmount ?? 0) +
    (m.budget.find((c) => c.name === 'Rent / housing')?.survivalAmount ?? 0);
  const fixedShare = m.survivalTotal === 0 ? 0 : fixed / m.survivalTotal;
  const discretionary = m.survivalTotal - fixed;

  // Must count the SAME cheques the 113,000 figure sums, or the tile's caption
  // contradicts its own number. It used to say that and then rebuild the filter
  // by hand, which held only while nobody changed one side — HAD-82 changed one
  // side. Now both come from `chequesInWindow`, so they cannot part company.
  const cheques6mCount = chequesInWindow(
    m.payments,
    m.profile.expectedLastDay,
    RULES.CHEQUE_WINDOW_6M.value,
  ).length;

  const lumpMonths = projection.points.filter((p) => p.lumpSum > 0);
  const latestActual = actuals[actuals.length - 1];
  const actualGap = latestActual ? latestActual.spend - m.survivalTotal : 0;

  const dining = m.budget.find((c) => c.name === 'Dining & entertainment');
  const diningSaving = dining ? dining.currentAmount - dining.survivalAmount : 0;
  const diningRunwayGain =
    diningSaving > 0 && r.runway.netMonthlyBurn > 0
      ? r.runway.totalResources / r.runway.netMonthlyBurn -
        r.runway.totalResources / (r.runway.netMonthlyBurn + diningSaving)
      : 0;

  return (
    <>
      <PageHead
        title="Home"
        sub={`If your job ends ${formatDate(m.profile.expectedLastDay)}`}
      />

      <RuleBasisPanel />

      {m.isSeedData && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            background: 'color-mix(in oklab, var(--warning) 10%, var(--surface-1))',
            borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)',
          }}
        >
          {/* Two different reasons produce the same banner state, and they need
              different next actions. Saying "seeded data" to someone who has
              signed in and is waiting to see their own figures would be true
              but useless. */}
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            {m.user ? (
              <>
                <b>▲ Reference figures, not yours.</b> You are signed in as{' '}
                {m.user.email ?? 'your account'}, but no profile has been saved yet, so every
                number below comes from the §11 reference dataset. Add your salary and
                employment dates on <Link href="/profile" prefetch={false} className="banner-link">Income &amp; profile</Link>{' '}
                and these become your own.
              </>
            ) : (
              <>
                <b>▲ Reference figures, not yours.</b> These numbers are the §11 reference
                dataset — real in shape, but not about you.{' '}
                <Link href="/sign-in" prefetch={false} className="banner-link">Sign in</Link> to see your own.
              </>
            )}
          </div>
        </div>
      )}

      {/* Hero */}
      <Card>
        <div className="hero">
          <div>
            <div className="card-sub">Runway — how long your money lasts</div>
            <div className="hero-num tnum">
              {months(r.runway.runwayMonths)}{' '}
              {Number.isFinite(r.runway.runwayMonths) && <small>months</small>}
            </div>
            <div style={{ marginTop: 10 }}>
              <RunwayStatusBadge status={r.runway.status} />
            </div>
          </div>
          <div className="hero-meta">
            {aed(r.runway.totalResources)} of total resources against a net monthly burn of{' '}
            {aed(r.runway.netMonthlyBurn)}.
            <br />
            {projection.zeroCrossingLabel ? (
              <>
                Money runs out around <b>{projection.zeroCrossingLabel}</b> — sooner than the
                headline figure, because {lumpMonths.length} cheque lump sum
                {lumpMonths.length === 1 ? '' : 's'} land before then.
              </>
            ) : (
              <>The projected balance stays positive across the next 18 months.</>
            )}
            <br />
            <span style={{ color: 'var(--ink-3)' }}>
              Tap any figure to open the screen its inputs live on.
            </span>
          </div>
        </div>
      </Card>

      {/* Stat tiles — each navigates to where its inputs live */}
      <div className="grid g5" style={{ marginTop: 14 }}>
        <StatTile label="Total resources" value={money(r.runway.totalResources)} foot="Profile & money" href="/profile" />
        <StatTile label="Final settlement" value={money(r.settlement.finalSettlement)} foot="Termination report" href="/report" />
        <StatTile
          label="ILOE total"
          value={money(r.iloe.iloeTotal)}
          foot={r.iloe.eligible ? `3 × ${money(r.iloe.monthlyBenefit)} · Category ${r.iloe.category}` : 'Not eligible'}
          href="/profile"
        />
        <StatTile label="Net monthly burn" value={money(r.runway.netMonthlyBurn)} foot="Survival budget" href="/budget" />
        <StatTile
          label="Cheques — next 6 months"
          value={money(r.deadlines.cheques6m)}
          foot={`${cheques6mCount} cheques · Calendar`}
          href="/calendar"
        />
      </div>

      {/* Cash projection */}
      <Card
        title="Projected cash balance"
        sub="18 months from your last working day · lump-sum cheque hits shown on their actual month"
      >
        <ProjectionChart projection={projection} />
      </Card>

      {/* Trends */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', marginTop: 14, alignItems: 'start' }}>
        <Card title="Current vs survival spending" sub="Per category, per month · auto rows are read-only">
          <BudgetBars
            rows={m.budget.map((c) => ({
              id: c.id,
              name: c.name,
              currentAmount: c.currentAmount,
              survivalAmount: c.survivalAmount,
              auto: Boolean(c.autoSource),
            }))}
            currentTotal={m.currentTotal}
            survivalTotal={m.survivalTotal}
          />
        </Card>

        <div>
          <Card title="Actual spending trend" sub="From confirmed statement transactions">
            <ActualSpendChart data={actuals} />
          </Card>

          <Card title="What this means">
            <ul className="insights">
              <li>
                <span className="ic" style={{ color: 'var(--warning)' }} aria-hidden>▲</span>
                <span>
                  <b>Rent + debt + school = {percent(fixedShare)}</b> of the survival budget and
                  are effectively fixed — cuts have to come from the remaining {aed(discretionary)}.
                </span>
              </li>
              {lumpMonths.length > 0 && (
                <li>
                  <span className="ic" style={{ color: 'var(--critical-ink)' }} aria-hidden>▲</span>
                  <span>
                    <b>{aed(projection.totalLumpSums)}</b> of cheque lump sums fall due in{' '}
                    {lumpMonths.map((p) => p.label).join(' and ')} —{' '}
                    {(projection.totalLumpSums / (r.runway.netMonthlyBurn || 1)).toFixed(1)}× the
                    monthly burn. This is what pulls the zero date forward.
                  </span>
                </li>
              )}
              {latestActual && actualGap > 0 && (
                <li>
                  <span className="ic" style={{ color: 'var(--s2)' }} aria-hidden>▲</span>
                  <span>
                    <b>Actual spend is running {aed(actualGap)}/mo above survival</b> (
                    {money(latestActual.spend)} vs {money(m.survivalTotal)}) — the survival budget
                    is a plan, not yet a behaviour.
                  </span>
                </li>
              )}
              {diningRunwayGain > 0.05 && (
                <li>
                  <span className="ic" style={{ color: 'var(--good-ink)' }} aria-hidden>▼</span>
                  <span>
                    Holding dining to the survival figure saves {aed(diningSaving)}/mo — about{' '}
                    <b>+{diningRunwayGain.toFixed(1)} months</b> of runway.
                  </span>
                </li>
              )}
            </ul>
          </Card>
        </div>
      </div>

      {/* Scenarios */}
      <Card title="Scenarios" sub="Resources remaining after m months at the survival burn">
        <div className="grid g4" style={{ marginTop: 12 }}>
          {r.scenarios.map((s) => (
            <div className="card" key={s.months}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 550 }}>
                After {s.months} months
              </div>
              <div style={{ fontSize: 20, fontWeight: 620, margin: '7px 0 8px', letterSpacing: '-0.02em' }}>
                <Money value={s.remaining} signed />
              </div>
              <ScenarioBadge remaining={s.remaining} netMonthlyBurn={r.runway.netMonthlyBurn} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Largest upcoming obligations" sub={`Next payments after ${formatMonthShort(m.profile.expectedLastDay)}`}>
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Due</th><th>Payee</th><th>Type</th><th className="r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...m.payments]
                .filter((p) => p.dueDate >= m.profile.expectedLastDay)
                .sort((a, b) => b.amount - a.amount)
                .slice(0, 5)
                .map((p) => (
                  <tr key={p.id}>
                    <td className="tnum">{formatDate(p.dueDate)}</td>
                    <td className="payee">{p.payee}</td>
                    <td>
                      {p.type === 'cheque' ? (
                        <span className="pill cheque"><span aria-hidden>◆</span> Cheque</span>
                      ) : (
                        <span className="pill">{p.type === 'autoDebit' ? 'Auto-debit' : 'Transfer'}</span>
                      )}
                    </td>
                    <td className="r amt tnum">{money(p.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
