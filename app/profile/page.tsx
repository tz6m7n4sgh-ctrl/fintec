import { Card, PageHead } from '@/components/ui';
import { formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { RULES } from '@/lib/engine/uae';
import { aed, money } from '@/lib/format/money';

/** A read-only field with the inline rule help the spec asks for (FR-C1). */
function Field({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input readOnly value={value} />
      {help ? <div className="help">{help}</div> : null}
    </div>
  );
}

export default async function ProfilePage() {
  const m = await getReadModel();
  const p = m.profile;
  const r = m.readiness;

  return (
    <>
      <PageHead
        title="Income & profile"
        sub="The inputs every termination figure is computed from"
      />

      <div className="card" style={{ marginBottom: 14, background: 'color-mix(in oklab, var(--warning) 10%, var(--surface-1))', borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <b>▲ Read-only for now.</b> These fields are displayed from the seeded reference profile.
          Editing writes to the database, which needs sign-in — the next build step.
        </div>
      </div>

      <Card title="Employment" sub="Drives service period, gratuity and notice pay">
        <div className="form-grid">
          <Field label="Basic salary (monthly)" value={money(p.basicSalary)}
            help="Per your MOHRE contract. Gratuity, leave encashment and ILOE all use BASIC — never gross." />
          <Field label="Gross salary (monthly)" value={money(p.grossSalary)}
            help="Basic plus allowances. Used only for notice paid in lieu." />
          <Field label="Employment start" value={formatDate(p.employmentStart)} />
          <Field label="Expected last day" value={formatDate(p.expectedLastDay)}
            help="Every deadline on the calendar is counted from this date." />
          <Field label="Unpaid leave days" value={String(p.unpaidLeaveDays)}
            help="Deducted from service days before gratuity is calculated." />
          <Field label="Unused annual leave days" value={String(p.unusedLeaveDays)}
            help={`Encashed at basic/30 = ${aed(p.basicSalary / 30)} per day.`} />
          <Field label="Notice period (days)" value={String(p.noticePeriodDays)} />
          <Field label="Notice days paid in lieu" value={String(p.noticeDaysPaidInLieu)}
            help="Days the employer waives but pays. Priced at GROSS/30." />
          <Field label="Other amounts owed to you" value={money(p.otherOwedToEmployee)}
            help="Unpaid salary, commissions, air ticket, reimbursements." />
          <Field label="Amounts you owe the employer" value={money(p.owedToEmployer)}
            help="Staff loans or advances, deducted from the settlement." />
        </div>
      </Card>

      <Card title="ILOE — unemployment insurance" sub="Hard 30-day claim window after termination">
        <div className="form-grid">
          <Field label="Subscribed 12+ consecutive months" value={p.iloeSubscribed12m ? 'Yes' : 'No'}
            help="Premiums must be paid up. Without this there is no claim." />
          <Field label="Involuntary & non-disciplinary" value={p.iloeInvoluntary ? 'Yes' : 'No'}
            help="Resignation and dismissal for misconduct are both excluded." />
          <Field label="Average basic salary, last 6 months" value={money(p.iloeAvgBasic6m)}
            help={`At or below ${money(RULES.ILOE_CATEGORY_THRESHOLD)} is Category A (cap ${money(RULES.ILOE_CAP_A)}/mo); above is Category B (cap ${money(RULES.ILOE_CAP_B)}/mo).`} />
          <Field label="Computed monthly benefit" value={money(r.iloe.monthlyBenefit)}
            help={r.iloe.eligible
              ? `60% of average basic, capped at ${money(r.iloe.monthlyCap)}. Paid for up to ${RULES.ILOE_MAX_MONTHS} months = ${aed(r.iloe.iloeTotal)}.`
              : 'Not eligible on the answers above.'} />
        </div>
      </Card>

      <Card title="Money" sub="What you have to live on">
        <div className="form-grid">
          <Field label="Cash savings" value={money(p.cashSavings)} />
          <Field label="Other liquid assets" value={money(p.otherLiquidAssets)}
            help="Only what you could actually access within days." />
          <Field label="Monthly side income" value={money(p.monthlySideIncome)}
            help="Reduces net burn. If it covers survival spending, runway is unlimited." />
          <Field label="Computed total resources" value={money(r.runway.totalResources)}
            help="Savings + liquid assets + final settlement + ILOE total." />
        </div>
      </Card>

      <Card title="Situation" sub="Visa and cover deadlines">
        <div className="form-grid">
          <Field label="Dependents" value={String(p.dependents)} />
          <Field label="Visa grace days" value={String(p.visaGraceDays)}
            help={`30–90 standard; 180 for Golden/Green visas. AED ${RULES.OVERSTAY_AED_PER_DAY}/day overstay after ${formatDate(r.deadlines.visaGraceEnd)}.`} />
          <Field label="Health cover months after end" value={String(p.healthCoverMonthsAfterEnd)}
            help="Health insurance is mandatory for residency once employer cover lapses." />
        </div>
      </Card>

      <Card title="Income streams">
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Frequency</th><th className="r">Amount</th><th>Ends</th><th>Active</th></tr>
            </thead>
            <tbody>
              {m.income.map((i) => (
                <tr key={i.id}>
                  <td className="payee">{i.name}</td>
                  <td>{i.frequency === 'monthly' ? 'Monthly' : 'One-off'}</td>
                  <td className="r amt mono">{money(i.amount)}</td>
                  <td className="mono">{i.endDate ? formatDate(i.endDate) : '—'}</td>
                  <td>{i.active ? <span className="pill ok"><span aria-hidden>✓</span> Active</span> : <span className="pill">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">Salary auto-ends at your last working day in the termination scenario.</span>
        </div>
      </Card>
    </>
  );
}
