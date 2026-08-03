'use client';

import { useMemo, useState } from 'react';
import { parseFormNumber } from '@/lib/forms/numbers';

type Doorway = 'happened' | 'coming' | 'exploring';

const MONEY = new Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED', maximumFractionDigits: 0 });

export function onboardingAnswer(values: Record<string, string>) {
  const required = ['employmentStart', 'expectedLastDay', 'basicSalary', 'grossSalary', 'unpaidLeaveDays', 'unusedLeaveDays'];
  const missing = required.filter((key) => !values[key]?.trim());
  const errors: Record<string, string> = {};
  if (values.employmentStart && values.expectedLastDay && values.expectedLastDay < values.employmentStart) {
    errors.expectedLastDay = 'Last day must be on or after your employment start.';
  }
  for (const key of required.slice(2)) {
    if (!values[key]) continue;
    const parsed = parseFormNumber(values[key]);
    if (!parsed.ok) errors[key] = parsed.reason === 'negative' ? 'Enter zero or a positive number.' : 'Enter a number. Commas are fine.';
  }
  const basic = parseFormNumber(values.basicSalary || '');
  const gross = parseFormNumber(values.grossSalary || '');
  if (basic.ok && gross.ok && gross.value < basic.value) errors.grossSalary = 'Gross salary cannot be less than basic salary.';
  return { missing, errors };
}

const fields: ReadonlyArray<{ name: string; label: string; type?: 'date'; consequence: string }> = [
  { name: 'employmentStart', label: 'Employment start', type: 'date', consequence: 'Without it, we cannot work out your service length or gratuity.' },
  { name: 'expectedLastDay', label: 'Last working day', type: 'date', consequence: 'Without it, we cannot set the calculation date or your deadlines.' },
  { name: 'basicSalary', label: 'Basic salary each month', consequence: 'Use the basic amount on your contract. Gratuity and leave pay use this—not gross.' },
  { name: 'grossSalary', label: 'Gross salary each month', consequence: 'Basic plus allowances. We need it to distinguish notice pay from gratuity.' },
  { name: 'unpaidLeaveDays', label: 'Unpaid leave already taken', consequence: 'Blank does not mean zero. Enter 0 if you took none; these days reduce reckonable service.' },
  { name: 'unusedLeaveDays', label: 'Unused leave your employer owes', consequence: 'Blank does not mean zero. Enter 0 if none is owed; otherwise it is valued using basic salary.' },
];

export function Onboarding() {
  const [doorway, setDoorway] = useState<Doorway | ''>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const result = useMemo(() => onboardingAnswer(values), [values]);
  const needed = result.missing.length + (doorway ? 0 : 1);
  const invalid = Object.keys(result.errors).length;

  return <div className="onboarding-layer">
    <main className="onboarding" aria-labelledby="onboarding-title">
      <div className="onboarding-brand"><span aria-hidden>₯</span> Readiness</div>
      {!doorway ? <section className="doorway">
        <p className="eyebrow">Let’s start where you are</p>
        <h1 id="onboarding-title">Has your job ending already happened?</h1>
        <p className="onboarding-lede">Choose the closest answer. It changes how we talk about dates—not the calculation.</p>
        <div className="doorway-options">
          <button type="button" onClick={() => setDoorway('happened')}><b>It already happened</b><span>I know my last working day</span></button>
          <button type="button" onClick={() => setDoorway('coming')}><b>I think it’s coming</b><span>I have a date or a best estimate</span></button>
          <button type="button" onClick={() => setDoorway('exploring')}><b>I’m just working things out</b><span>I want to understand a possible date</span></button>
        </div>
      </section> : submitted && needed === 0 && invalid === 0 ? <Answer values={values} doorway={doorway} onBack={() => setSubmitted(false)} /> : <section>
        <button className="text-button" type="button" onClick={() => setDoorway('')}>← Change your answer</button>
        <p className="eyebrow">Six details, then an answer</p>
        <h1 id="onboarding-title">Your employment details</h1>
        <p className="onboarding-lede">Nothing is pre-filled and a blank is never quietly changed to zero.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (!needed && !invalid) setSubmitted(true); }} noValidate>
          <div className="onboarding-grid">{fields.map((field) => {
            const error = result.errors[field.name];
            return <div className={`onboarding-field ${error ? 'has-error' : ''}`} key={field.name}>
              <label htmlFor={`on-${field.name}`}>{field.label}</label>
              <input id={`on-${field.name}`} type={field.type || 'text'} inputMode={field.type ? undefined : 'decimal'} value={values[field.name] || ''}
                aria-invalid={Boolean(error)} aria-describedby={`on-${field.name}-note`}
                onChange={(e) => setValues((old) => ({ ...old, [field.name]: e.target.value }))} />
              <div id={`on-${field.name}-note`} className={error ? 'field-error' : 'field-consequence'}>{error || field.consequence}</div>
            </div>;
          })}</div>
          <div className="onboarding-submit">
            <button className="btn primary" type="submit" disabled={needed > 0 || invalid > 0}>Show my answer</button>
            <span role="status">{needed > 0 ? `${needed} ${needed === 1 ? 'answer' : 'answers'} still needed` : invalid > 0 ? `${invalid} ${invalid === 1 ? 'field needs' : 'fields need'} attention` : 'Ready to calculate'}</span>
          </div>
        </form>
      </section>}
    </main>
  </div>;
}

function Answer({ values, doorway, onBack }: { values: Record<string, string>; doorway: Doorway; onBack: () => void }) {
  const basic = parseFormNumber(values.basicSalary); const unpaid = parseFormNumber(values.unpaidLeaveDays); const unused = parseFormNumber(values.unusedLeaveDays);
  const start = new Date(`${values.employmentStart}T00:00:00Z`); const end = new Date(`${values.expectedLastDay}T00:00:00Z`);
  const calendarDays = Math.floor((end.getTime() - start.getTime()) / 86400000);
  const serviceDays = calendarDays - (unpaid.ok ? unpaid.value : 0); const years = Math.max(0, serviceDays / 365.25);
  const daily = basic.ok ? basic.value / 30 : 0;
  const gratuityDays = years <= 5 ? years * 21 : 5 * 21 + (years - 5) * 30;
  const gratuity = daily * gratuityDays; const leave = daily * (unused.ok ? unused.value : 0);
  return <section className="onboarding-answer">
    <p className="eyebrow">Your first answer</p><h1 id="onboarding-title">About {MONEY.format(gratuity + leave)} may be owed</h1>
    <p className="onboarding-lede">Estimated gratuity plus unused leave, based only on the six details you gave us.</p>
    <div className="answer-total"><span>Estimated gratuity</span><b>{MONEY.format(gratuity)}</b><span>Unused leave pay</span><b>{MONEY.format(leave)}</b></div>
    <div className="answer-note"><b>This is a starting estimate, not a promise.</b> It does not yet include notice pay, other deductions or statutory caps. {doorway === 'exploring' ? 'Because your date is provisional, changing it can change this answer.' : 'Your dates determine the service period used here.'}</div>
    <button className="btn" type="button" onClick={onBack}>Edit the six details</button>
  </section>;
}
