import { cookies } from 'next/headers';
import { UnverifiedBasis } from '@/components/Basis';
import { Card, PageHead, ScenarioBadge } from '@/components/ui';
import { daysUntil, formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { RULES } from '@/lib/engine/uae';
import { isAiWordingConfigured } from '@/lib/ai/anthropic';
import { buildWordingInput, wordingDigest } from '@/lib/ai/wording';
import { aed, money, moneyPrecise, months } from '@/lib/format/money';
import type { ReactNode } from 'react';
import { PrintReportButton } from '@/components/PrintReportButton';
import { wordInPlainLanguage } from './actions';
import { parseWordingCookie, WORDING_COOKIE, type WordingCookie } from './wording-cookie';

const preciseAed = (value: number) => `AED ${moneyPrecise(value)}`;

/** One deterministic line: the amount and its complete working stay together. */
function WorkingLine({
  label,
  value,
  children,
  open = false,
}: {
  label: string;
  value: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="working" open={open}>
      <summary>
        <span className="working-label">{label}</span>
        <span className="working-value tnum">{value}</span>
      </summary>
      <div className="working-body">{children}</div>
    </details>
  );
}

/**
 * A printable explanation. Every sentence and equation is derived from the
 * same read model as its displayed result.
 */
export default async function ReportPage() {
  const m = await getReadModel();
  const r = m.readiness;
  const s = m.score;
  const firstFiveYears = Math.min(r.service.serviceYears, 5);
  const laterYears = Math.max(r.service.serviceYears - 5, 0);

  /*
   * The plain-language wording (HAD-118). No key, no feature: when
   * `ANTHROPIC_API_KEY` is unset this whole block resolves to null and the
   * page renders exactly as before — no button, no dead UI.
   *
   * The stored wording is only shown while its digest matches the figures on
   * screen. A profile edit between generating and reading would otherwise
   * leave yesterday's prose above today's arithmetic, agreeing with nothing.
   */
  const aiConfigured = isAiWordingConfigured();
  let wording: WordingCookie | null = null;
  if (aiConfigured) {
    const jar = await cookies();
    const stored = parseWordingCookie(jar.get(WORDING_COOKIE)?.value);
    if (stored && stored.digest === wordingDigest(buildWordingInput(m.profile, r, s))) {
      wording = stored;
    }
  }

  return (
    <div className="report-page">
      <div className="report-heading">
        <PageHead
          title="Explain your numbers"
          sub={`Based on a last working day of ${formatDate(m.profile.expectedLastDay)} · open any line to see its arithmetic`}
        />
        <PrintReportButton />
      </div>

      {/* Every figure below is computed from rules nobody has sourced. This is
          the screen most likely to be read as authoritative — it shows the
          arithmetic in full — so it says so first rather than in a footer.

          Deliberately ABOVE the AI wording block: the unverified-basis panel
          does not depend on the model saying the caveat, and it stays visible
          whether the wording rendered, failed, or was rejected. */}
      <UnverifiedBasis />

      {aiConfigured ? (
        <>
          {wording && 'text' in wording ? (
            <Card
              title="In plain language"
              sub="AI-worded from the working below — it calculated nothing"
            >
              {wording.text.split(/\n{2,}/).map((para, i) => (
                <p key={i} style={{ fontSize: 13.5, color: 'var(--ink-1)', lineHeight: 1.6, marginTop: i === 0 ? 4 : 0 }}>
                  {para}
                </p>
              ))}
              <div className="legend">
                <span className="key">
                  Worded by an AI model from the deterministic figures below, and shown only after
                  every number in it was checked against that working. The working below is the
                  authority; this is a reading of it, on the same unverified basis.
                </span>
              </div>
            </Card>
          ) : null}
          {wording && 'failure' in wording ? (
            <Card title="In plain language" sub="No wording to show this time">
              {/*
                Said plainly rather than swallowed. A button that silently does
                nothing is a control this app has shipped twice and regretted
                twice — and the "invalid" case is a feature working, not
                failing: a generation that mentioned a figure not in your
                breakdown was discarded whole rather than shown.
              */}
              <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
                {wording.failure === 'invalid' ? (
                  <>
                    The AI wording mentioned a number that is not in your breakdown, so it was
                    discarded rather than shown. The working below is computed, not worded, and is
                    unaffected — you can try again.
                  </>
                ) : (
                  <>
                    The wording service could not be reached. The working below is computed
                    locally and is unaffected.
                  </>
                )}
              </p>
            </Card>
          ) : null}
          {/*
            A plain form so the button works with JavaScript disabled: the POST
            runs the server action, the action sets the cookie and redirects
            back here, and this render shows the result. The API key stays on
            the server for the whole round trip.
          */}
          <form action={wordInPlainLanguage} style={{ margin: '2px 0 14px' }}>
            <button className="btn" type="submit">
              {wording && 'text' in wording ? 'Word this again' : 'Word this in plain language'}
            </button>
          </form>
        </>
      ) : null}

      <Card title="Final settlement" sub="What your employer pays, line by line">
        <WorkingLine label="End-of-service gratuity" value={preciseAed(r.settlement.gratuity)} open>
          <div className="working-equation tnum">
            {moneyPrecise(m.profile.basicSalary)} ÷ {RULES.DAYS_PER_MONTH.value} = {moneyPrecise(r.gratuity.dailyBasic)} per day
          </div>
          <div className="tnum">
            ({firstFiveYears.toFixed(3)} years × {RULES.GRATUITY_DAYS_FIRST_5Y.value} days)
            {laterYears > 0 ? ` + (${laterYears.toFixed(3)} years × ${RULES.GRATUITY_DAYS_AFTER_5Y.value} days)` : ''}
            {' '}= {r.gratuity.gratuityDays.toFixed(2)} gratuity days
          </div>
          <div className="working-equation tnum">
            {r.gratuity.gratuityDays.toFixed(2)} days × {moneyPrecise(r.gratuity.dailyBasic)} = {preciseAed(r.gratuity.gratuityRaw)} accrued
          </div>
          {r.gratuity.ineligible ? (
            <div className="working-note warning">
              Paid: AED 0. You have {r.service.serviceYears.toFixed(3)} years of service, below the one-year minimum. The accrued {preciseAed(r.gratuity.gratuityRaw)} is therefore not payable.
            </div>
          ) : r.gratuity.capApplied ? (
            <div className="working-note warning">
              Paid: {preciseAed(r.settlement.gratuity)}. The accrued {preciseAed(r.gratuity.gratuityRaw)} exceeds the legal cap: {RULES.GRATUITY_CAP_MONTHS.value} months × {preciseAed(m.profile.basicSalary)} basic salary = {preciseAed(r.gratuity.gratuityCap)}.
            </div>
          ) : (
            <div className="working-note">
              Paid: {preciseAed(r.settlement.gratuity)}. This is below the cap of {RULES.GRATUITY_CAP_MONTHS.value} months × {preciseAed(m.profile.basicSalary)} = {preciseAed(r.gratuity.gratuityCap)}.
            </div>
          )}
        </WorkingLine>
        <WorkingLine label="Unused leave encashment" value={preciseAed(r.settlement.leaveEncashment)}>
          <div className="working-equation tnum">
            {m.profile.unusedLeaveDays} unused days × ({preciseAed(m.profile.basicSalary)} basic salary ÷ {RULES.DAYS_PER_MONTH.value}) = {preciseAed(r.settlement.leaveEncashment)}
          </div>
        </WorkingLine>
        <WorkingLine label="Notice paid in lieu" value={preciseAed(r.settlement.noticePayInLieu)}>
          <div className="working-equation tnum">
            {m.profile.noticeDaysPaidInLieu} days × ({preciseAed(m.profile.grossSalary)} gross salary ÷ {RULES.DAYS_PER_MONTH.value}) = {preciseAed(r.settlement.noticePayInLieu)}
          </div>
        </WorkingLine>
        <WorkingLine label="Other amounts owed to you" value={preciseAed(r.settlement.otherOwedToEmployee)}>
          <div className="working-equation tnum">Entered amount = {preciseAed(m.profile.otherOwedToEmployee)}</div>
          <div className="working-note">For example unpaid salary, commission, a ticket or reimbursements.</div>
        </WorkingLine>
        <WorkingLine label="Less: amounts you owe the employer" value={`−${preciseAed(r.settlement.owedToEmployer)}`}>
          <div className="working-equation tnum">Entered amount deducted = {preciseAed(m.profile.owedToEmployer)}</div>
          <div className="working-note">For example a staff loan or salary advance.</div>
        </WorkingLine>
        <WorkingLine label="Total final settlement" value={preciseAed(r.settlement.finalSettlement)} open>
          <div className="working-equation tnum">
            {preciseAed(r.settlement.gratuity)} + {preciseAed(r.settlement.leaveEncashment)} + {preciseAed(r.settlement.noticePayInLieu)} + {preciseAed(r.settlement.otherOwedToEmployee)} − {preciseAed(r.settlement.owedToEmployer)} = {preciseAed(r.settlement.finalSettlement)}
          </div>
        </WorkingLine>
        <div className="legend"><span className="key">Service: {r.service.serviceDays} service days ÷ {RULES.DAYS_PER_YEAR.value} = {r.service.serviceYears.toFixed(3)} years, after unpaid leave.</span></div>
      </Card>

      <Card title="ILOE benefit" sub="Calculated from your current eligibility answers">
        <WorkingLine label="Monthly benefit" value={aed(r.iloe.monthlyBenefit)} open>
          {r.iloe.eligible ? <>
            <div className="working-equation tnum">{aed(m.profile.iloeAvgBasic6m)} average basic × 60% = {aed(m.profile.iloeAvgBasic6m * RULES.ILOE_RATE.value)}</div>
            <div className="working-note">Category {r.iloe.category} pays the lower of that result and the {aed(r.iloe.monthlyCap)} monthly cap{r.iloe.capApplied ? '; the cap applies here' : ''}.</div>
          </> : <div className="working-note warning">Paid: AED 0. Eligibility requires both 12 months of subscription and involuntary job loss. Your answers do not meet both conditions.</div>}
        </WorkingLine>
        <WorkingLine label="Total ILOE" value={aed(r.iloe.iloeTotal)}>
          <div className="working-equation tnum">{aed(r.iloe.monthlyBenefit)} × {RULES.ILOE_MAX_MONTHS.value} months = {aed(r.iloe.iloeTotal)}</div>
        </WorkingLine>
      </Card>

      <Card title="Runway" sub="How the months are produced">
        <WorkingLine label="Total resources" value={aed(r.runway.totalResources)} open>
          <div className="working-equation tnum">{aed(m.profile.cashSavings)} savings + {aed(m.profile.otherLiquidAssets)} liquid assets + {aed(r.settlement.finalSettlement)} settlement + {aed(r.iloe.iloeTotal)} ILOE = {aed(r.runway.totalResources)}</div>
        </WorkingLine>
        <WorkingLine label="Net monthly burn" value={aed(r.runway.netMonthlyBurn)}>
          <div className="working-equation tnum">{aed(r.runway.survivalSpend)} survival spending − {aed(r.runway.monthlySideIncome)} side income = {aed(r.runway.netMonthlyBurn)}</div>
        </WorkingLine>
        <WorkingLine label="Runway" value={`${months(r.runway.runwayMonths)} months`} open>
          <div className="working-equation tnum">{aed(r.runway.totalResources)} total resources ÷ {aed(r.runway.netMonthlyBurn)} net monthly burn = {months(r.runway.runwayMonths)} months</div>
        </WorkingLine>
      </Card>

      <Card title="Deadlines" sub="Counted from your last working day">
        <div>
          {[
            ['Final settlement due', r.deadlines.settlementDue, `${RULES.SETTLEMENT_DUE_DAYS.value} days after ${formatDate(m.profile.expectedLastDay)}`],
            ['ILOE claim — hard deadline', r.deadlines.iloeDeadline, `${RULES.ILOE_CLAIM_DAYS.value} days after ${formatDate(m.profile.expectedLastDay)}`],
            ['Visa grace period ends', r.deadlines.visaGraceEnd, `${m.profile.visaGraceDays} days after ${formatDate(m.profile.expectedLastDay)}`],
          ].map(([name, date, note]) => {
            const d = daysUntil(date);
            return <div className="dl-row" key={name}><div className="t"><div className="n">{name}</div><div className="d">{formatDate(date)} · {note}</div></div><span className="count" style={{ borderColor: 'var(--ring)' }}>{d >= 0 ? `${d} days` : `${Math.abs(d)} days ago`}</span></div>;
          })}
        </div>
      </Card>

      <Card title="Scenarios" sub="Resources left after each period at the same monthly burn">
        <div className="grid g4">
          {r.scenarios.map((sc) => <div className="card" key={sc.months}><div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 550 }}>After {sc.months} months</div><div className="tnum" style={{ fontSize: 19, fontWeight: 620, margin: '7px 0 8px' }}>{money(sc.remaining)}</div><div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 8 }}>{money(r.runway.totalResources)} − ({sc.months} × {money(r.runway.netMonthlyBurn)})</div><ScenarioBadge remaining={sc.remaining} netMonthlyBurn={r.runway.netMonthlyBurn} /></div>)}
        </div>
      </Card>

      <Card title="Readiness" sub={`${s.total} of ${s.max} — ${s.band}`}>
        <div className="tbl-wrap" tabIndex={0}><table><tbody>{s.criteria.map((c) => <tr key={c.key}><th scope="row" className="rowhead payee">{c.label}<span className="sub">{c.detail}</span></th><td className="r tnum amt">{c.score} / {c.max}</td></tr>)}</tbody></table></div>
      </Card>
    </div>
  );
}
