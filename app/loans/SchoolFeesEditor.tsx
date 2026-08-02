'use client';

import { useActionState, useMemo, useState } from 'react';
import type { SchoolFee } from '@/lib/engine/types';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';
import {
  deleteSchoolFee,
  saveSchoolFee,
  type SchoolFeeResult,
} from './actions';

const INITIAL: SchoolFeeResult = { ok: false };
const BLANK: SchoolFee = {
  id: '', child: '', school: '', term: '', dueDate: '', amount: 0,
  paidByCheque: false, paid: false,
};

function Field({ name, label, value, type = 'text', step }: {
  name: string; label: string; value: string | number; type?: string; step?: string;
}) {
  const id = `fee-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type={type} step={step}
        min={type === 'number' ? 0 : undefined} defaultValue={value} required />
    </div>
  );
}

function FeeForm({ fee, onDone }: { fee: SchoolFee; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveSchoolFee, INITIAL);
  const isNew = fee.id === '';
  if (state.ok && !pending) queueMicrotask(onDone);
  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={fee.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a school fee' : `Edit — ${fee.child}, ${fee.term}`}
      </h2>
      {state.error ? <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
        <b>✕ {state.error}</b>
      </div> : null}
      <div className="form-grid">
        <Field name="child" label="Child" value={fee.child} />
        <Field name="school" label="School" value={fee.school} />
        <Field name="term" label="Term" value={fee.term} />
        <Field name="dueDate" label="Due date" type="date" value={fee.dueDate} />
        <Field name="amount" label="Amount (AED)" type="number" step="0.01" value={fee.amount || ''} />
        <div className="field">
          <label><input name="paidByCheque" type="checkbox" defaultChecked={fee.paidByCheque} /> Paid by cheque</label>
        </div>
        <div className="field">
          <label><input name="paid" type="checkbox" defaultChecked={fee.paid} /> Paid</label>
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add fee' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </form>
  );
}

function DeleteFee({ fee }: { fee: SchoolFee }) {
  const [state, action, pending] = useActionState(deleteSchoolFee, INITIAL);
  const label = `${fee.child} ${fee.term}`;
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={fee.id} />
      <button className="btn" type="submit" disabled={pending}
        aria-label={`Delete ${label}`} title={state.error ?? undefined}>
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function SchoolFeesEditor({ fees }: { fees: SchoolFee[] }) {
  const [editing, setEditing] = useState<SchoolFee | null>(null);
  const annual = useMemo(() => fees.reduce((sum, fee) => sum + fee.amount, 0), [fees]);
  return (
    <>
      {editing ? <FeeForm key={editing.id || 'new'} fee={editing} onDone={() => setEditing(null)} /> : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>Add a school fee</button>
        </div>
      )}
      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead><tr>
            <th>Child</th><th>School</th><th>Term</th><th>Due</th>
            <th className="r">Amount</th><th>Cheque</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody>
            {fees.map((fee) => <tr key={fee.id}>
              <td className="payee">{fee.child}</td><td>{fee.school}</td><td>{fee.term}</td>
              <td className="mono">{formatDate(fee.dueDate)}</td>
              <td className="r amt mono">{money(fee.amount)}</td>
              <td>{fee.paidByCheque ? <span className="pill cheque"><span aria-hidden>◆</span> Yes</span> : <span className="pill">No</span>}</td>
              <td>{fee.paid ? <span className="pill ok"><span aria-hidden>✓</span> Paid</span> : <span className="pill">Due</span>}</td>
              <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                <button className="btn" type="button" onClick={() => setEditing(fee)} aria-label={`Edit ${fee.child} ${fee.term}`}>Edit</button>
                <DeleteFee fee={fee} />
              </td>
            </tr>)}
            {fees.length === 0 ? <tr><td colSpan={8} style={{ color: 'var(--ink-3)', fontSize: 13 }}>No school fees recorded.</td></tr> : null}
            <tr className="tot-row"><td colSpan={4}>Annual total</td><td className="r mono">{money(annual)}</td><td colSpan={3} /></tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 12 }}>
        The annual total of <b>{money(annual)}</b> is spread across 12 months: <b>{money(annual / 12)}</b> feeds the read-only &ldquo;School fees&rdquo; budget line. Change the terms here, not the budget row.
      </p>
    </>
  );
}
