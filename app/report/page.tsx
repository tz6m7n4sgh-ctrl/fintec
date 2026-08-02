import { Card, PageHead, ScenarioBadge } from '@/components/ui';
import { daysUntil, formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { RULES } from '@/lib/engine/uae';
import { aed, money, moneyPrecise, months } from '@/lib/format/money';
import { PrintButton } from './PrintButton';

/**
 * The "if it happens tomorrow" page. Printable to PDF via the browser's own
 * print pipeline — no extra dependency, and what you see is what you get.
 */
export default async function ReportPage() {
  const m = await getReadModel();
  const r = m.readiness;
  const s = m.score;

  const items: Array<[string, number, string]> = [
    ['End-of-service gratuity', r.settlement.gratuity,
      `${r.gratuity.gratuityDays.toFixed(2)} days at ${aed(r.gratuity.dailyBasic)}/day (basic salary ÷ 30)`],
    ['Unused leave encashment', r.settlement.leaveEncashment,
      `${m.profile.unusedLeaveDays} days at basic ÷ 30`],
    ['Notice paid in lieu', r.settlement.noticePayInLieu,
      `${m.profile.noticeDaysPaidInLieu} days at GROSS ÷ 30`],
    ['Other amounts owed to you', r.settlement.otherOwedToEmployee, 'Unpaid salary, commissions, ticket, reimbursements'],
    ['Less: amounts you owe the employer', -r.settlement.owedToEmployer, 'Staff loans or advances'],
  ];

  return (
    <>
      <PageHead
        title="Termination report"
        sub={`Prepared ${formatDate(new Date().toISOString().slice(0, 10))} · assumes a last working day of ${formatDate(m.profile.expectedLastDay)}`}
      />

      <div style={{ marginBottom: 14 }}>
        <PrintButton />
      </div>

      <Card title="The short answer">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>▸</span>
            <span>
              You are owed <b>{aed(r.settlement.finalSettlement)}</b>, payable within{' '}
              {RULES.SETTLEMENT_DUE_DAYS} days — by <b>{formatDate(r.deadlines.settlementDue)}</b>.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>▸</span>
            <span>
              {r.iloe.eligible ? (
                <>
                  You can claim <b>{aed(r.iloe.iloeTotal)}</b> of ILOE benefit
                  ({aed(r.iloe.monthlyBenefit)}/month × {RULES.ILOE_MAX_MONTHS}), but only if you
                  file by <b>{formatDate(r.deadlines.iloeDeadline)}</b>.
                </>
              ) : (
                <>You are <b>not eligible</b> for ILOE on your current answers.</>
              )}
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>▸</span>
            <span>
              Your money lasts <b>{months(r.runway.runwayMonths)} months</b> at the survival
              budget
              {m.projection.zeroCrossingLabel ? (
                <> — but the projected balance goes negative in <b>{m.projection.zeroCrossingLabel}</b> once cheque lump sums are counted.</>
              ) : '.'}
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--critical-ink)' }} aria-hidden>▸</span>
            <span>
              You must fund <b>{aed(r.deadlines.cheques6m)}</b> of cheques in the six months
              after your last day. These cannot bounce.
            </span>
          </li>
        </ul>
      </Card>

      <Card title="Itemised final settlement" sub="Compare this against what your employer actually pays">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <thead><tr><th>Item</th><th>Basis</th><th className="r">Amount (AED)</th></tr></thead>
            <tbody>
              {items.map(([label, value, basis]) => (
                <tr key={label}>
                  <td className="payee">{label}</td>
                  <td style={{ color: 'var(--ink-2)', fontSize: 12.5 }}>{basis}</td>
                  <td className="r mono">{value < 0 ? `(${moneyPrecise(Math.abs(value))})` : moneyPrecise(value)}</td>
                </tr>
              ))}
              <tr className="tot-row">
                <td>Total final settlement</td>
                <td />
                <td className="r mono">{moneyPrecise(r.settlement.finalSettlement)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Service: {r.service.serviceDays} days = {r.service.serviceYears.toFixed(3)} years.
            {r.gratuity.capApplied
              ? ` Gratuity capped at 24 months' basic (${aed(r.gratuity.gratuityCap)}).`
              : ` Under the 24-month cap of ${aed(r.gratuity.gratuityCap)}.`}
          </span>
        </div>
      </Card>

      <Card title="Deadlines" sub="Counted from your last working day">
        <div>
          {[
            ['Final settlement due', r.deadlines.settlementDue, `Compare against ${aed(r.settlement.finalSettlement)}. If short or late: MOHRE 600 590 000.`],
            ['ILOE claim — hard deadline', r.deadlines.iloeDeadline, 'iloe.ae with Emirates ID, termination letter and work-permit cancellation.'],
            ['Visa grace period ends', r.deadlines.visaGraceEnd, `AED ${RULES.OVERSTAY_AED_PER_DAY}/day overstay penalty afterwards.`],
          ].map(([name, date, note]) => {
            const d = daysUntil(date as string);
            return (
              <div className="dl-row" key={name as string}>
                <div className="t">
                  <div className="n">{name as string}</div>
                  <div className="d">{formatDate(date as string)} · {note as string}</div>
                </div>
                <span className="count" style={{ borderColor: 'var(--ring)' }}>
                  {d >= 0 ? `${d} days` : `${Math.abs(d)} days ago`}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Runway and scenarios">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr><th scope="row" className="rowhead">Cash savings</th><td className="r mono">{money(m.profile.cashSavings)}</td></tr>
              <tr><th scope="row" className="rowhead">Other liquid assets</th><td className="r mono">{money(m.profile.otherLiquidAssets)}</td></tr>
              <tr><th scope="row" className="rowhead">Final settlement</th><td className="r mono">{money(r.settlement.finalSettlement)}</td></tr>
              <tr><th scope="row" className="rowhead">ILOE total</th><td className="r mono">{money(r.iloe.iloeTotal)}</td></tr>
              <tr className="tot-row"><th scope="row" className="rowhead">Total resources</th><td className="r mono">{money(r.runway.totalResources)}</td></tr>
              <tr><th scope="row" className="rowhead">Survival spending per month</th><td className="r mono">{money(r.runway.survivalSpend)}</td></tr>
              <tr><th scope="row" className="rowhead">Less side income</th><td className="r mono">{money(m.profile.monthlySideIncome)}</td></tr>
              <tr className="tot-row"><th scope="row" className="rowhead">Net monthly burn</th><td className="r mono">{money(r.runway.netMonthlyBurn)}</td></tr>
              <tr className="tot-row"><th scope="row" className="rowhead">Runway</th><td className="r mono">{months(r.runway.runwayMonths)} months</td></tr>
            </tbody>
          </table>
        </div>
        <div className="grid g4" style={{ marginTop: 14 }}>
          {r.scenarios.map((sc) => (
            <div className="card" key={sc.months}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 550 }}>After {sc.months} months</div>
              <div className="mono" style={{ fontSize: 19, fontWeight: 620, margin: '7px 0 8px', color: sc.shortfall ? 'var(--critical-ink)' : undefined }}>
                {sc.remaining < 0 ? `−${money(Math.abs(sc.remaining))}` : money(sc.remaining)}
              </div>
              <ScenarioBadge remaining={sc.remaining} netMonthlyBurn={r.runway.netMonthlyBurn} />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Readiness" sub={`${s.total} of ${s.max} — ${s.band}`}>
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              {s.criteria.map((c) => (
                <tr key={c.key}>
                  <th scope="row" className="rowhead payee">
                    {c.label}<span className="sub">{c.detail}</span>
                  </th>
                  <td className="r mono amt">{c.score} / {c.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
