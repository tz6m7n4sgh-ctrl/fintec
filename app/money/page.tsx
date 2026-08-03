import Link from 'next/link';

import { Card, Empty, Money, PageHead, RunwayStatusBadge } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { addDays, formatDate } from '@/lib/engine/dates';
import { RULES } from '@/lib/engine/uae';
import { aed, money, months } from '@/lib/format/money';

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
    </>
  );
}
