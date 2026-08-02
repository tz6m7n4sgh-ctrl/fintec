'use client';

import { useActionState, useMemo, useState } from 'react';
import type { SchoolFee } from '@/lib/engine/types';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';
import { deleteSchoolFee, saveSchoolFee, type SchoolFeeResult } from './actions';

/**
 * Editable school fees (US-20).
 *
 * As with debts, the CRUD is not the interesting part — the consequences are,
 * and one term reaches three places at once:
 *
 * - the **budget**, as annual total ÷ 12 in a read-only auto row;
 * - the **calendar and both cheque-exposure tiles**, if it is cheque-paid;
 * - the **projection**, through those obligations.
 *
 * All three are derived from this table. Nothing here writes a scheduled
 * payment, which is what the seed used to do by hand and what HAD-81 removed.
 *
 * The form says all of that, because a user ticking "paid by cheque" is
 * creating a dated obligation whose failure mode in the UAE is criminal, and
 * they should learn that here rather than on the calendar.
 */

const INITIAL: SchoolFeeResult = { ok: false };

const BLANK: SchoolFee = {
  id: '',
  child: '',
  school: '',
  term: '',
  dueDate: '',
  amount: 0,
  paidByCheque: false,
  paid: false,
};

function Field({
  name,
  label,
  value,
  type = 'text',
  required = false,
  help,
}: {
  name: string;
  label: string;
  value: string | number;
  type?: string;
  required?: boolean;
  help?: string;
}) {
  const id = `sf-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={type === 'number' ? 0 : undefined}
        step={type === 'number' ? '0.01' : undefined}
        aria-describedby={help ? `${id}-help` : undefined}
      />
      {help ? <span className="help" id={`${id}-help`}>{help}</span> : null}
    </div>
  );
}

function FeeForm({ fee, onDone }: { fee: SchoolFee; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveSchoolFee, INITIAL);
  const isNew = !fee.id;

  // The server revalidates; this closes the form once it has.
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={fee.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a school fee' : `Edit — ${fee.child}, ${fee.term}`}
      </h2>

      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      <div className="form-grid">
        <Field name="child" label="Child" value={fee.child} required />
        <Field name="school" label="School" value={fee.school} required />
        <Field name="term" label="Term" value={fee.term} required help="Term 1, Spring, and so on." />
        <Field name="dueDate" label="Due date" type="date" value={fee.dueDate} required />
        <Field name="amount" label="Amount (AED)" type="number" value={fee.amount || ''} required />
      </div>

      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <label>
          <input name="paidByCheque" type="checkbox" defaultChecked={fee.paidByCheque} /> Paid by
          cheque
        </label>
        <label>
          <input name="paid" type="checkbox" defaultChecked={fee.paid} /> Already paid
        </label>
      </div>

      <p className="help" style={{ marginTop: 10 }}>
        The annual total feeds the read-only <b>School fees</b> budget line at total ÷ 12.
        A term marked <b>paid by cheque</b> also becomes a dated cheque on the calendar and
        counts toward both exposure figures — a bounced cheque in the UAE carries civil and
        potential criminal consequences, so it must not be invisible. Marking a term
        <b> already paid</b> removes it from those figures; it is no longer an exposure.
      </p>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add fee' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteFee({ fee }: { fee: SchoolFee }) {
  const [state, action, pending] = useActionState(deleteSchoolFee, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={fee.id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        title={state.error}
        aria-label={`Delete ${fee.child} ${fee.term}`}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function SchoolFeesEditor({ fees }: { fees: SchoolFee[] }) {
  const [editing, setEditing] = useState<SchoolFee | null>(null);

  const annual = useMemo(() => fees.reduce((sum, f) => sum + f.amount, 0), [fees]);
  const unpaidCheques = useMemo(
    () => fees.filter((f) => f.paidByCheque && !f.paid),
    [fees],
  );

  return (
    <>
      {editing ? (
        <FeeForm key={editing.id || 'new'} fee={editing} onDone={() => setEditing(null)} />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add a school fee
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Child</th><th>School</th><th>Term</th><th>Due</th>
              <th className="r">Amount</th><th>Cheque</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {fees.map((f) => (
              <tr key={f.id}>
                <td className="payee">{f.child}</td>
                <td>{f.school}</td>
                <td>{f.term}</td>
                <td className="tnum">{formatDate(f.dueDate)}</td>
                <td className="r amt tnum">{money(f.amount)}</td>
                <td>
                  {f.paidByCheque ? (
                    <span className="pill cheque"><span aria-hidden>◆</span> Yes</span>
                  ) : (
                    <span className="pill">No</span>
                  )}
                </td>
                <td>
                  {f.paid ? (
                    <span className="pill ok"><span aria-hidden>✓</span> Paid</span>
                  ) : (
                    <span className="pill">Due</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(f)}
                    aria-label={`Edit ${f.child} ${f.term}`}
                  >
                    Edit
                  </button>
                  <DeleteFee fee={f} />
                </td>
              </tr>
            ))}
            {fees.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No school fees recorded.
                </td>
              </tr>
            ) : null}
            <tr className="tot-row">
              <td colSpan={4}>Annual total</td>
              <td className="r tnum">{money(annual)}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        <b>{money(annual / 12)}</b> per month feeds the computed, read-only School fees budget
        line.
        {unpaidCheques.length > 0 ? (
          <>
            {' '}
            <span aria-hidden>◆</span>{' '}
            <b>{unpaidCheques.length} cheque{unpaidCheques.length === 1 ? '' : 's'}</b> still to
            clear, worth {money(unpaidCheques.reduce((s, f) => s + f.amount, 0))} — these appear
            on the payment calendar and in your cheque exposure.
          </>
        ) : null}
      </p>
    </>
  );
}
