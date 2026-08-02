import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { ProfileForm } from './ProfileForm';
import { IncomeEditor } from './IncomeEditor';
import { AccountsEditor } from './AccountsEditor';
import { formatDate } from '@/lib/engine/dates';
import { getReadModel } from '@/lib/data/store';
import { RULES } from '@/lib/engine/uae';
import { aed, money } from '@/lib/format/money';

/**
 * A read-only field with the inline rule help the spec asks for (FR-C1).
 *
 * The label is associated with the input via htmlFor/id, and the help text via
 * aria-describedby, so a screen reader announces both. A visually adjacent
 * <label> with no `for` is not associated at all — the control reads out as
 * unlabelled, which an audit of this page caught across all 21 inputs.
 */
function Field({ label, value, help }: { label: string; value: string; help?: string }) {
  const id = `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} readOnly value={value} aria-describedby={help ? helpId : undefined} />
      {help ? <div className="help" id={helpId}>{help}</div> : null}
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

      {m.user ? (
        <Card
          title={m.isSeedData ? 'Set up your profile' : 'Your profile'}
          sub={
            m.isSeedData
              ? 'The figures below are a worked example until you save your own'
              : 'Every termination figure in the app is computed from these'
          }
        >
          {m.isSeedData && (
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
              The form starts blank on purpose. Prefilling it with the reference figures would
              invite you to save a stranger&rsquo;s salary as your own.
            </p>
          )}
          <ProfileForm profile={p} isSeedData={m.isSeedData} />
        </Card>
      ) : (
        <div className="card" style={{ marginBottom: 14, background: 'color-mix(in oklab, var(--warning) 10%, var(--surface-1))', borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)' }}>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <b>▲ Reference profile, not yours.</b> These are the §11 example figures.{' '}
            <Link href="/sign-in" prefetch={false} className="banner-link">Sign in</Link> to enter your own — a new
            email address creates an account, there is no separate sign-up.
          </div>
        </div>
      )}

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
          <Field label="Monthly side income" value={money(r.runway.monthlySideIncome)}
            help="Derived from the income streams below — whatever still arrives after your last working day. Reduces net burn; if it covers survival spending, runway is unlimited." />
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
        {m.isSeedData ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
              These are the §11 reference figures. <b>Sign in to record your own</b> — editing is
              disabled here because there is no account to save them against.
            </p>
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr><th>Name</th><th>Frequency</th><th className="r">Amount</th><th>Ends</th><th>Active</th></tr>
            </thead>
            <tbody>
              {m.income.map((i) => (
                <tr key={i.id}>
                  <td className="payee">{i.name}</td>
                  <td>{i.frequency === 'monthly' ? 'Monthly' : 'One-off'}</td>
                  <td className="r amt tnum">{money(i.amount)}</td>
                  <td className="tnum">{i.endDate ? formatDate(i.endDate) : '—'}</td>
                  <td>{i.active ? <span className="pill ok"><span aria-hidden>✓</span> Active</span> : <span className="pill">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
            <div className="legend">
              <span className="key">Salary auto-ends at your last working day in the termination scenario.</span>
            </div>
          </>
        ) : (
          <IncomeEditor income={m.income} expectedLastDay={p.expectedLastDay} />
        )}
      </Card>

      <Card
        title="Bank accounts"
        sub="Where statements come from — a parsed transaction is attributed to one of these"
      >
        {m.isSeedData ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
              These are the §11 reference accounts. <b>Sign in to record your own</b> — editing is
              disabled here because there is no account to save them against.
            </p>
            <div className="tbl-wrap" tabIndex={0}>
              <table className="wide">
                <thead>
                  <tr>
                    <th>Bank</th><th>Label</th><th>Last 4</th>
                    <th className="r">Balance</th><th>Cheques</th>
                  </tr>
                </thead>
                <tbody>
                  {m.accounts.map((a) => (
                    <tr key={a.id}>
                      <td className="payee">{a.bankName}</td>
                      <td>{a.accountLabel || '—'}</td>
                      <td className="tnum">{a.last4 ? `··${a.last4}` : '—'}</td>
                      <td className="r amt tnum">
                        {a.currentBalance === undefined ? '—' : money(a.currentBalance)}
                      </td>
                      <td>
                        {a.isChequeAccount
                          ? <span className="pill cheque"><span aria-hidden>◆</span> Yes</span>
                          : <span className="pill">No</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <AccountsEditor accounts={m.accounts} />
        )}
      </Card>
    </>
  );
}
