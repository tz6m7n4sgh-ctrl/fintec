'use client';

import { useActionState, useState } from 'react';
import type { Profile } from '@/lib/engine/types';
import { readFormNumber } from '@/lib/forms/numbers';
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
 *
 * Numeric fields are checked in the browser too (HAD-20), on blur and on
 * submit, with the same `readFormNumber` the server action runs — one reader,
 * so the two cannot drift. The server remains the source of truth; nothing
 * validated here is trusted, it is merely said earlier and next to the box it
 * is about rather than in one banner after a round trip.
 */

const INITIAL: SaveResult = { ok: false };

/**
 * Every numeric field, with the label the user sees above it.
 *
 * The client-side mirror of the server action's list: each of these is read
 * with `readFormNumber` on blur and again on submit, and a submit with an
 * unreadable value is blocked before it leaves the browser.
 */
const NUMERIC_FIELDS: Record<string, string> = {
  basicSalary: 'Basic salary (monthly)',
  grossSalary: 'Gross salary (monthly)',
  unpaidLeaveDays: 'Unpaid leave days',
  unusedLeaveDays: 'Unused annual leave days',
  noticePeriodDays: 'Notice period (days)',
  noticeDaysPaidInLieu: 'Notice days paid in lieu',
  otherOwedToEmployee: 'Other amounts owed to you',
  owedToEmployer: 'Amounts you owe your employer',
  iloeAvgBasic6m: 'Average basic salary, last 6 months',
  cashSavings: 'Cash savings',
  otherLiquidAssets: 'Other liquid assets',
  dependents: 'Dependents',
  visaGraceDays: 'Visa grace period (days)',
  healthCoverMonthsAfterEnd: 'Health cover after last day (months)',
};

function Field({
  name,
  label,
  defaultValue,
  help,
  type = 'text',
  step,
  required,
  error,
  onBlur,
}: {
  name: string;
  label: string;
  defaultValue: string | number;
  help?: string;
  type?: string;
  step?: string;
  required?: boolean;
  /** Inline problem with what was typed — set on blur or on a blocked submit. */
  error?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
}) {
  const id = `f-${name}`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined;
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
        /*
         * `type="text"` with a decimal keypad, deliberately, rather than
         * `type="number"` — which is what these were.
         *
         * Measured in Chromium rather than assumed: given "32,000", a
         * `type="number"` input reports `value === ""` and its form submits an
         * empty string. The comma is not rejected with a message; the figure
         * is silently discarded. On the server that arrives as blank, blank
         * legitimately means zero, and a basic salary of 32,000 becomes a
         * basic salary of nothing — with gratuity, leave encashment, ILOE and
         * the runway all computed from it.
         *
         * A text input sends "32,000" verbatim, and `lib/forms/numbers.ts`
         * reads it. `inputMode="decimal"` keeps the numeric keypad on a phone,
         * which is the only thing `type="number"` was buying here.
         */
        inputMode={type === 'text' ? 'decimal' : undefined}
        defaultValue={defaultValue}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onBlur={onBlur}
      />
      {help ? <div className="help" id={helpId}>{help}</div> : null}
      {error ? (
        <p className="cost" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
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

  /*
   * The client half of the number reading (HAD-20). Mirrored locally only to
   * decide what to say next to each box — the form still posts the raw inputs
   * and the server action re-reads everything with the same function.
   */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const checkField = (name: string, raw: string): boolean => {
    const read = readFormNumber(raw, NUMERIC_FIELDS[name]);
    setErrors((prev) => {
      if (read.ok) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev[name] === read.error ? prev : { ...prev, [name]: read.error };
    });
    return read.ok;
  };

  const onNumericBlur: React.FocusEventHandler<HTMLInputElement> = (e) =>
    checkField(e.currentTarget.name, e.currentTarget.value);

  /*
   * Blocks a submit carrying an unreadable number. Every numeric field is
   * re-read here — not just the ones already blurred — so a first-time submit
   * reveals every problem at once rather than one per attempt. Focus lands on
   * the first offending box, because an error a screen-reader user has to hunt
   * for is barely an error message.
   */
  const onSubmit: React.FormEventHandler<HTMLFormElement> = (e) => {
    const form = e.currentTarget;
    let firstBad: string | null = null;
    for (const name of Object.keys(NUMERIC_FIELDS)) {
      const input = form.elements.namedItem(name);
      if (!(input instanceof HTMLInputElement)) continue;
      if (!checkField(name, input.value)) firstBad ??= name;
    }
    if (firstBad) {
      e.preventDefault();
      const input = form.elements.namedItem(firstBad);
      if (input instanceof HTMLInputElement) input.focus();
    }
  };

  // Numeric fields share the same blur handler and their stored error.
  const num = (name: string) => ({ error: errors[name], onBlur: onNumericBlur });

  // Seeded values are a worked example, not the user's figures. Prefilling the
  // form with them would invite someone to save a stranger's salary as their
  // own, so a first-time user starts from blank.
  const v = (live: string | number, blank: string | number) => (isSeedData ? blank : live);
  const vb = (live: boolean) => (isSeedData ? false : live);

  return (
    <form action={action} onSubmit={onSubmit}>
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
          help="From your MOHRE contract. Gratuity, leave encashment and ILOE all use BASIC — never gross." {...num('basicSalary')} />
        <Field name="grossSalary" label="Gross salary (monthly)" defaultValue={v(profile.grossSalary, '')}
          help="Basic plus allowances. Used only for notice paid in lieu. Cannot be less than basic." {...num('grossSalary')} />
        <Field name="employmentStart" label="Employment start" type="date" required defaultValue={v(profile.employmentStart, '')}
          help="Required. Service length is counted from here, which sets your gratuity." />
        <Field name="expectedLastDay" label="Expected last day" type="date" required defaultValue={v(profile.expectedLastDay, '')}
          help="Required. Every deadline in the app is counted from this date." />
        <Field name="unpaidLeaveDays" label="Unpaid leave days" defaultValue={v(profile.unpaidLeaveDays, 0)}
          help="Deducted from service days before gratuity is calculated." {...num('unpaidLeaveDays')} />
        <Field name="unusedLeaveDays" label="Unused annual leave days" defaultValue={v(profile.unusedLeaveDays, 0)}
          help="Encashed at basic ÷ 30 per day." {...num('unusedLeaveDays')} />
        <Field name="noticePeriodDays" label="Notice period (days)" defaultValue={v(profile.noticePeriodDays, 30)} {...num('noticePeriodDays')} />
        <Field name="noticeDaysPaidInLieu" label="Notice days paid in lieu" defaultValue={v(profile.noticeDaysPaidInLieu, 0)}
          help="Paid at GROSS ÷ 30 per day — the one figure that uses gross." {...num('noticeDaysPaidInLieu')} />
        <Field name="otherOwedToEmployee" label="Other amounts owed to you" defaultValue={v(profile.otherOwedToEmployee, 0)} {...num('otherOwedToEmployee')} />
        <Field name="owedToEmployer" label="Amounts you owe your employer" defaultValue={v(profile.owedToEmployer, 0)}
          help="Subtracted from the final settlement." {...num('owedToEmployer')} />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>ILOE — unemployment insurance</h2>
      <div className="form-grid">
        <Check name="iloeSubscribed12m" label="Subscribed 12+ consecutive months" defaultChecked={vb(profile.iloeSubscribed12m)}
          help="Both this and an involuntary exit are required to qualify." />
        <Check name="iloeInvoluntary" label="Exit is involuntary (not resignation or dismissal for cause)" defaultChecked={vb(profile.iloeInvoluntary)} />
        <Field name="iloeAvgBasic6m" label="Average basic salary, last 6 months" defaultValue={v(profile.iloeAvgBasic6m, '')}
          help="Pays 60% of this, capped at AED 10,000/month up to a 16,000 basic, or 20,000 above it. Three months maximum." {...num('iloeAvgBasic6m')} />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>Money</h2>
      <div className="form-grid">
        <Field name="cashSavings" label="Cash savings" defaultValue={v(profile.cashSavings, '')} {...num('cashSavings')} />
        <Field name="otherLiquidAssets" label="Other liquid assets" defaultValue={v(profile.otherLiquidAssets, 0)}
          help="Only what you could actually reach within a month." {...num('otherLiquidAssets')} />
      </div>

      <h2 style={{ fontSize: 14.5, marginTop: 18 }}>Situation</h2>
      <div className="form-grid">
        <Field name="dependents" label="Dependents" defaultValue={v(profile.dependents, 0)} {...num('dependents')} />
        <Field name="visaGraceDays" label="Visa grace period (days)" defaultValue={v(profile.visaGraceDays, 30)}
          help="Counted from your last working day. Overstaying carries a daily fine." {...num('visaGraceDays')} />
        <Field name="healthCoverMonthsAfterEnd" label="Health cover after last day (months)" defaultValue={v(profile.healthCoverMonthsAfterEnd, 0)}
          {...num('healthCoverMonthsAfterEnd')} />
      </div>

      <div style={{ marginTop: 18 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
