'use client';

import { useActionState, useMemo, useState } from 'react';
import type { Debt } from '@/lib/engine/types';
import { money } from '@/lib/format/money';
import { deleteDebt, saveDebt, type DebtResult } from './actions';

/**
 * Editable loans and mortgages (US-19).
 *
 * The thing worth surfacing here is not the CRUD, it is the consequence: the
 * monthly payments on this screen total into a **read-only budget row**, and
 * that row is part of survival spending, which is the denominator of runway.
 * A user adding a mortgage is changing how long their money lasts, and the
 * screen says so rather than leaving it to be discovered on another page.
 */

const INITIAL: DebtResult = { ok: false };

const DEBT_LABEL: Record<Debt['type'], string> = {
  carLoan: 'Car loan',
  mortgage: 'Mortgage',
  personalLoan: 'Personal loan',
  creditCard: 'Credit card',
  other: 'Other',
};

const BLANK: Debt = {
  id: '',
  type: 'personalLoan',
  name: '',
  outstandingBalance: 0,
  monthlyPayment: 0,
  monthsRemaining: 0,
  lender: '',
};

function Field({
  name,
  label,
  defaultValue,
  type = 'number',
  step,
  required,
  help,
}: {
  name: string;
  label: string;
  defaultValue: string | number;
  type?: string;
  step?: string;
  required?: boolean;
  help?: string;
}) {
  const id = `d-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        step={step}
        min={type === 'number' ? 0 : undefined}
        defaultValue={defaultValue}
        required={required}
        aria-describedby={help ? `${id}-help` : undefined}
      />
      {help ? <div className="help" id={`${id}-help`}>{help}</div> : null}
    </div>
  );
}

function DebtForm({ debt, onDone }: { debt: Debt; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveDebt, INITIAL);
  const isNew = debt.id === '';
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={debt.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a loan or mortgage' : `Edit — ${debt.name}`}
      </h2>

      {state.error ? (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: 'var(--critical-ink)',
            border: '1px solid color-mix(in oklab, var(--critical) 45%, transparent)',
            borderRadius: 4,
            padding: '8px 10px',
            marginBottom: 12,
          }}
        >
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      <div className="form-grid">
        <Field name="name" label="Name" type="text" defaultValue={debt.name} required />
        <div className="field">
          <label htmlFor="d-type">Type</label>
          <select id="d-type" name="type" defaultValue={debt.type}>
            {(Object.keys(DEBT_LABEL) as Debt['type'][]).map((t) => (
              <option key={t} value={t}>{DEBT_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <Field name="lender" label="Lender" type="text" defaultValue={debt.lender} />
        <Field
          name="outstandingBalance"
          label="Outstanding balance (AED)"
          step="0.01"
          defaultValue={debt.outstandingBalance || ''}
          help="What is still owed. Does not affect runway on its own — the monthly payment does."
        />
        <Field
          name="monthlyPayment"
          label="Monthly payment (AED)"
          step="0.01"
          defaultValue={debt.monthlyPayment || ''}
          help="This is the figure that reaches your budget and shortens your runway."
        />
        <Field
          name="monthsRemaining"
          label="Months remaining"
          step="1"
          defaultValue={debt.monthsRemaining || ''}
        />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add facility' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteDebt({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteDebt, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        aria-label={`Delete ${name}`}
        title={state.error ?? undefined}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function DebtsEditor({ debts }: { debts: Debt[] }) {
  const [editing, setEditing] = useState<Debt | null>(null);

  const { outstanding, monthly } = useMemo(
    () => ({
      outstanding: debts.reduce((s, d) => s + d.outstandingBalance, 0),
      monthly: debts.reduce((s, d) => s + d.monthlyPayment, 0),
    }),
    [debts],
  );

  return (
    <>
      {editing ? (
        <DebtForm key={editing.id || 'new'} debt={editing} onDone={() => setEditing(null)} />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add a loan or mortgage
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Lender</th>
              <th className="r">Outstanding</th><th className="r">Monthly</th>
              <th className="r">Months left</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {debts.map((d) => (
              <tr key={d.id}>
                <td className="payee">{d.name}</td>
                <td><span className="pill">{DEBT_LABEL[d.type]}</span></td>
                <td>{d.lender}</td>
                <td className="r mono">{money(d.outstandingBalance)}</td>
                <td className="r amt mono">{money(d.monthlyPayment)}</td>
                <td className="r mono">{d.monthsRemaining}</td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(d)}
                    aria-label={`Edit ${d.name}`}
                  >
                    Edit
                  </button>
                  <DeleteDebt id={d.id} name={d.name} />
                </td>
              </tr>
            ))}
            {debts.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No loans or mortgages recorded. Add them here and their monthly payments will
                  total into your budget automatically.
                </td>
              </tr>
            ) : null}
            <tr className="tot-row">
              <td colSpan={3}>Total</td>
              <td className="r mono">{money(outstanding)}</td>
              <td className="r mono">{money(monthly)}</td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 12 }}>
        The <b>{money(monthly)}</b> monthly total feeds the read-only &ldquo;Loan &amp; mortgage
        payments&rdquo; line on your budget, which is part of survival spending — so it shortens
        your runway directly. You cannot edit that budget line; change it here.
      </p>
    </>
  );
}
