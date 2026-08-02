'use client';

import { useActionState, useMemo, useState } from 'react';
import type { SchoolFee } from '@/lib/engine/types';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';
import { deleteSchoolFee, saveSchoolFee, type SchoolFeeResult } from './actions';

const INITIAL: SchoolFeeResult = { ok: false };
const BLANK: SchoolFee = {
  id: '', child: '', school: '', term: '', dueDate: '', amount: 0,
  paidByCheque: false, paid: false,
};

function Field({ name, label, value, type = 'text', required = false }: {
  name: string; label: string; value: string | number; type?: string; required?: boolean;
}) {
  const id = `sf-${name}`;
  return <div className="field"><label htmlFor={id}>{label}</label><input
    id={id} name={name} type={type} defaultValue={value} required={required}
    min={type === 'number' ? 0 : undefined} step={type === 'number' ? '0.01' : undefined}
  /></div>;
}

function FeeForm({ fee, onDone }: { fee: SchoolFee; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveSchoolFee, INITIAL);
  const isNew = !fee.id;
  if (state.ok && !pending) queueMicrotask(onDone);
  return <form action={action} className="card" style={{ marginBottom: 14 }}>
    <input type="hidden" name="id" value={fee.id} />
    <h2 style={{ fontSize: 15, marginTop: 0 }}>{isNew ? 'Add a school fee' : `Edit — ${fee.child}, ${fee.term}`}</h2>
    {state.error ? <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}><b>✕ {state.error}</b></div> : null}
    <div className="form-grid">
      <Field name="child" label="Child" value={fee.child} required />
      <Field name="school" label="School" value={fee.school} required />
      <Field name="term" label="Term" value={fee.term} required />
      <Field name="dueDate" label="Due date" type="date" value={fee.dueDate} required />
      <Field name="amount" label="Amount (AED)" type="number" value={fee.amount || ''} required />
    </div>
    <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
      <label><input name="paidByCheque" type="checkbox" defaultChecked={fee.paidByCheque} /> Paid by cheque</label>
      <label><input name="paid" type="checkbox" defaultChecked={fee.paid} /> Already paid</label>
    </div>
    <p className="help">Cheque fees appear in cheque exposure and on the payment calendar. The annual total feeds the monthly budget at annual total ÷ 12.</p>
    <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
      <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Saving…' : isNew ? 'Add fee' : 'Save changes'}</button>
      <button className="btn" type="button" onClick={onDone} disabled={pending}>Cancel</button>
    </div>
  </form>;
}

function DeleteFee({ fee }: { fee: SchoolFee }) {
  const [state, action, pending] = useActionState(deleteSchoolFee, INITIAL);
  return <form action={action} style={{ display: 'inline' }}>
    <input type="hidden" name="id" value={fee.id} />
    <button className="btn" type="submit" disabled={pending} title={state.error} aria-label={`Delete ${fee.child} ${fee.term}`}>{pending ? '…' : 'Delete'}</button>
  </form>;
}

export function SchoolFeesEditor({ fees }: { fees: SchoolFee[] }) {
  const [editing, setEditing] = useState<SchoolFee | null>(null);
  const annual = useMemo(() => fees.reduce((sum, fee) => sum + fee.amount, 0), [fees]);
  return <>
    {editing ? <FeeForm key={editing.id || 'new'} fee={editing} onDone={() => setEditing(null)} />
      : <div style={{ marginBottom: 12 }}><button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>Add a school fee</button></div>}
    <div className="tbl-wrap" tabIndex={0}><table className="wide">
      <thead><tr><th>Child</th><th>School</th><th>Term</th><th>Due</th><th className="r">Amount</th><th>Cheque</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{fees.map((f) => <tr key={f.id}>
        <td className="payee">{f.child}</td><td>{f.school}</td><td>{f.term}</td><td className="mono">{formatDate(f.dueDate)}</td>
        <td className="r amt mono">{money(f.amount)}</td>
        <td>{f.paidByCheque ? <span className="pill cheque"><span aria-hidden>◆</span> Yes</span> : <span className="pill">No</span>}</td>
        <td>{f.paid ? <span className="pill ok"><span aria-hidden>✓</span> Paid</span> : <span className="pill">Due</span>}</td>
        <td style={{ whiteSpace: 'nowrap' }}><button className="btn" type="button" onClick={() => setEditing(f)} aria-label={`Edit ${f.child} ${f.term}`}>Edit</button>{' '}<DeleteFee fee={f} /></td>
      </tr>)}
      {fees.length === 0 ? <tr><td colSpan={8}>No school fees recorded.</td></tr> : null}
      <tr className="tot-row"><td colSpan={4}>Annual total</td><td className="r mono">{money(annual)}</td><td colSpan={3} /></tr></tbody>
    </table></div>
    <p style={{ fontSize: 13, color: 'var(--ink-2)' }}><b>{money(annual / 12)}</b> per month feeds the computed, read-only School fees budget line.</p>
  </>;
}
