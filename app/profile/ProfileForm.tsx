'use client';

import { useActionState } from 'react';
import type { Profile } from '@/lib/engine/types';
import { saveProfile, type SaveResult } from './actions';

/**
 * The editable profile (US-26 / FR-C1).
 *
 * Fields are grouped the way the spec asks — Employment, ILOE, Money,
 * Situation — and each carries inline help derived from the §5 rules, because
 * the difference between basic and gross salary is the single most consequential
 * thing a user can get wrong here. Gratuity uses basic; notice-in-lieu uses
 * gross. Entering one where the other belongs changes the answer by thousands.
 *
 * A progressively-enhanced form: it posts to a server action, so it works
 * before hydration and does not need the Supabase client in the browser. That
 * keeps this route's bundle at roughly nothing, unlike /sign-in.
 */

const INITIAL: SaveResult = { ok: false };

function Field({
  name,
  label,
  defaultValue,
  help,
  type = 'number',
  step,
  required,
}: {
  name: string;
  label: string;
  defaultValue: string | number;
  help?: string;
  type?: string;
  step?: string;
  required?: boolean;
}) {
  const id = `f-${name}`;
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        step={step}
        min={type === 'number' ? 0 : undefined}
        defaultValue={defaultValue}
        required={required}
        aria-required={required || undefined}
        aria-describedby={help ? helpId : undefined}
      />
      {help ? <div className="help" id={helpId}>{help}</div> : null}
    </div>
  );
}

function Check({
  name,
  label,
  defaultChecked,
  help,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
  help?: string;
}) {
  const id = `f-${name}`;
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-describedby={help ? helpId : undefined}
      />
      {help ? <div className="help" id={helpId}>{help}</div> : null}
    </div>
  );
}

export function ProfileForm({ profile, isSeedData }: { profile: Profile; isSeedData: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, INITIAL);

  // Seeded values are a worked example, not the user's figures. Prefilling the
  // form with them would invite someone to save a stranger's salary as their
  // own, so a first-time user starts from blank.
  const v = (live: string | number, blank: string | number) => (isSeedData ? blank : live);
  const vb = (live: boolean) => (isSeedData ? false : live);

  return (
    <form action={action}>
      {state.error && (
        <div
          className="card"
          style={{ marginBottom: 14, borderColor: 'color-mix(in oklab, var(--critical) 45%, transparent)' }}
          role="alert"
        >
          <div style={{ fontSize: 13, color: 'var(--critical-ink)' }}><b>✕ {state.error}</b></div>
        </div>
      )}
      {state.ok && !state.error && (
        <div className="card" style={{ marginBottom: 14 }} role="status">
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
            <b>✓ Saved.</b> Every figure in the app now comes from these numbers.
          </div>
        </div>
      )}

      <h2 style={{ fontSize: 14.5, marginTop: 4 }}>Employment</h2>
      <div className="form-grid">
        <Field name="basicSalary" label="Basic salary (monthly)" defaultValue={v(profile.basicSalary, '')}
          help="From your MOHRE contract. Gratuity, leave encashment and ILOE all use BASIC — never gross." />
        <Field name="grossSalary" label="Gross salary (monthly)" defaultValue={v(profile.grossSalary, '')}
          help="Basic plus allowances. Used only for notice paid in lieu. Cannot be less than basic." />
        <Field name="employmentStart" label="Employment start" type="date" required defaultValue={v(profile.employmentStart, '')}
          help="Required. Service length is counted from here, which sets your gratuity." />
        <Field name="expectedLastDay" label="Expected last day" type="date" required defaultValue={v(profile.expectedLastDay, '')}
          help="Required. Every deadline in the app is counted from this date." />
        <Field name="unpaidLeaveDays" label="Unpaid leave days" defaultValue={v(profile.unpaidLeaveDays, 0)}
          help="Deducted from service days before gratuity is calculated." />
        <Field name="unusedLeaveDays" label="Unused annual leave days" defaultValue={v(profile.unusedLeaveDays, 0)}
          help="Encashed at basic ÷ 30 per day." />
        <Field name="noticePeriodDays" label="Notice period (days)" defaultValue={v(profile.noticePeriodDays, 30)} />
        <Field name="noticeDaysPaidInLieu" label="Notice days paid in lieu" defaultValue={v(profile.noticeDaysPaidInLieu, 0)}
          help="Paid at GROSS ÷ 30 per day — the one figure that uses gross." />
        <Field name="otherOwedToEmployee" label="Other amounts owed to you" defaultValue={v(profile.otherOwedToEmployee, 0)} />
        <Field name="owedToEmployer" label="Amounts you owe your employer" defaultValue={v(profile.owedToEmployer, 0)}
          help="Subtracted from the final settlement." />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>ILOE — unemployment insurance</h2>
      <div className="form-grid">
        <Check name="iloeSubscribed12m" label="Subscribed 12+ consecutive months" defaultChecked={vb(profile.iloeSubscribed12m)}
          help="Both this and an involuntary exit are required to qualify." />
        <Check name="iloeInvoluntary" label="Exit is involuntary (not resignation or dismissal for cause)" defaultChecked={vb(profile.iloeInvoluntary)} />
        <Field name="iloeAvgBasic6m" label="Average basic salary, last 6 months" defaultValue={v(profile.iloeAvgBasic6m, '')}
          help="Pays 60% of this, capped at AED 10,000/month up to a 16,000 basic, or 20,000 above it. Three months maximum." />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>Money</h2>
      <div className="form-grid">
        <Field name="cashSavings" label="Cash savings" defaultValue={v(profile.cashSavings, '')} />
        <Field name="otherLiquidAssets" label="Other liquid assets" defaultValue={v(profile.otherLiquidAssets, 0)}
          help="Only what you could actually reach within a month." />
        <Field name="monthlySideIncome" label="Monthly side income" defaultValue={v(profile.monthlySideIncome, 0)}
          help="Reduces your net monthly burn, so it extends runway directly." />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>Situation</h2>
      <div className="form-grid">
        <Field name="dependents" label="Dependents" defaultValue={v(profile.dependents, 0)} />
        <Field name="visaGraceDays" label="Visa grace period (days)" defaultValue={v(profile.visaGraceDays, 30)}
          help="Counted from your last working day. Overstaying carries a daily fine." />
        <Field name="healthCoverMonthsAfterEnd" label="Health cover after last day (months)" defaultValue={v(profile.healthCoverMonthsAfterEnd, 0)} />
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
