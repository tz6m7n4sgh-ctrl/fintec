import Link from 'next/link';

import { UnverifiedBasis } from '@/components/Basis';
import { ActualSpendChart, ProjectionChart } from '@/components/charts';
import { Card, Empty, Money, PageHead, RunwayStatusBadge, StatTile } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { addDays, formatDate } from '@/lib/engine/dates';
import { RULES, chequesInWindow, monthlyDebtService } from '@/lib/engine/uae';
import { aed, money, months, percent } from '@/lib/format/money';

/**
 * Money (workstream C, frame 25:2).
 *
 * Absorbs Budget, Calendar, Schedule and Loans. The frame's order is the
 * screen's argument: how long the money lasts, then what leaves each month,
 * then what is due next, then what is owed — the question first, the ledger
 * after it.
 *
 * This replaces the hub of links that shipped with the shell. A hub answered
 * "where did Budget go"; this answers the section's actual job. The four
 * screens it absorbs remain the places where things are *edited* — every
 * figure here links to the screen that owns it (NFR-5).
 */
export default async function MoneyPage() {
  const m = await getReadModel();
  const r = m.readiness;

  /*
   * What is due next: the nearest three outstanding obligations. Cheques are
   * flagged individually — an uncleared cheque is a criminal matter here, so
   * one due date on this list is not like the others.
   */
  const upcoming = m.payments
    .filter((p) => p.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 3);

  const debtOutstanding = m.debts.reduce((sum, d) => sum + d.outstandingBalance, 0);

  const { projection, actuals } = m;

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
      <PageHead title="Money" sub="What is coming in and going out, and whether it clears." />

      {m.isSeedData && (
        <Empty>
          These are the reference figures, not yours. Six answers and your monthly spending are
          enough to replace them — <Link prefetch={false} href="/start">start there</Link>.
        </Empty>
      )}

      {/* The frame's hero: how long the money lasts, with its inputs stated. */}
      <Card>
        <div className="hero">
          <div>
            <div className="hero-num tnum">
              {Number.isFinite(r.runway.runwayMonths) ? (
                <>
                  {months(r.runway.runwayMonths)} <small>months</small>
                </>
              ) : (
                'Unlimited'
              )}
            </div>
            <RunwayStatusBadge status={r.runway.status} />
          </div>
          <p className="hero-meta">
            {money(r.runway.totalResources)} to spend and {money(r.runway.netMonthlyBurn)} going
            out a month — if the settlement lands and nothing changes.
          </p>
        </div>
      </Card>

      {/* Stat tiles — each navigates to where its inputs live */}
      <div className="grid g5" style={{ marginTop: 14 }}>
        <StatTile label="Total resources" value={money(r.runway.totalResources)} foot="Profile & money" href="/profile" />
        {/*
          * Points at the date, not the explanation.
          *
          * The rule for a StatTile is that every AED figure navigates to where
          * its *inputs* live (NFR-5 / BR-11), and the input to a settlement is
          * the last day — change it and this figure moves. The line-by-line
          * working is one click on from there.
          */}
        <StatTile label="Final settlement" value={money(r.settlement.finalSettlement)} foot="Change the last day" href="/entitlement" />
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

      {/*
        * Inherited from the dashboard with the tiles (HAD-124): two of the
        * figures above come out of the engine's rules, so the caveat about
        * those rules travels with them. Self-removing once a rule is sourced.
        */}
      <UnverifiedBasis />

      <Card
        title="Projected cash balance"
        sub="18 months from your last working day · lump-sum cheque hits shown on their actual month"
      >
        <ProjectionChart projection={projection} />
      </Card>



      <Card title="What goes out each month" sub="The survival budget — what you could not pause">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              {m.budget.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="rowhead payee">
                    {row.name}
                    {/*
                      * The two derived rows are marked and point at where they
                      * are edited, per the frame. Editing them here would be
                      * editing a computation — the debts and fee schedules
                      * they derive from are the real records.
                      */}
                    {row.autoSource ? (
                      <span className="sub">
                        Derived from your{' '}
                        {row.autoSource === 'debts' ? 'debts' : 'fee schedule'} —{' '}
                        <Link prefetch={false} className="banner-link" href="/loans">
                          edit them there
                        </Link>
                      </span>
                    ) : null}
                  </th>
                  <td className="r tnum">{money(row.survivalAmount)}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <th scope="row" className="rowhead">
                  Total
                </th>
                <td className="r tnum">{money(m.survivalTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Amounts are edited on the{' '}
            <Link prefetch={false} className="banner-link" href="/budget">
              budget
            </Link>{' '}
            — runway moves as you type.
          </span>
        </div>
      </Card>

      <Card title="What is due next" sub="The nearest three obligations">
        {upcoming.length === 0 ? (
          <Empty>Nothing outstanding. Obligations appear here as their due dates approach.</Empty>
        ) : (
          <div>
            {upcoming.map((p) => (
              <div className="dl-row" key={p.id}>
                <div className="t">
                  <div className="n">
                    {p.payee}
                    {p.type === 'cheque' ? (
                      <>
                        {' '}
                        <span className="pill cheque">
                          <span aria-hidden>✕</span> cheque
                        </span>
                      </>
                    ) : null}
                  </div>
                  <div className="d">
                    {formatDate(p.dueDate)} · {p.purpose}
                  </div>
                </div>
                <span className="count tnum" style={{ borderColor: 'var(--ring)' }}>
                  <Money value={p.amount} />
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="legend">
          <span className="key">
            The full list lives on the{' '}
            <Link prefetch={false} className="banner-link" href="/calendar">
              calendar
            </Link>{' '}
            and the{' '}
            <Link prefetch={false} className="banner-link" href="/schedule">
              schedule
            </Link>
            .
          </span>
        </div>
      </Card>

      <Card title="What you owe" sub="Debts, and the cheques that cannot bounce">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead payee">
                  Outstanding across {m.debts.length} {m.debts.length === 1 ? 'debt' : 'debts'}
                  <span className="sub">
                    <Link prefetch={false} className="banner-link" href="/loans">
                      Loans, mortgage and school fees
                    </Link>
                  </span>
                </th>
                <td className="r tnum">{money(debtOutstanding)}</td>
              </tr>
              <tr>
                <th scope="row" className="rowhead payee">
                  Cheque exposure, six months from your last day
                  <span className="sub">
                    Until{' '}
                    {formatDate(addDays(m.profile.expectedLastDay, RULES.CHEQUE_WINDOW_6M.value))} —
                    an uncleared cheque is a criminal matter here
                  </span>
                </th>
                <td className="r tnum" style={{ color: 'var(--critical-ink)' }}>
                  {aed(r.deadlines.cheques6m)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', marginTop: 14, alignItems: 'start' }}>
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
        <div>{/* The per-category bars live on /budget, where they are edited. */}</div>
      </div>
    </>
  );
}
