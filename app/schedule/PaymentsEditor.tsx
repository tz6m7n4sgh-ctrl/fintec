'use client';

import { useActionState, useMemo, useState } from 'react';
import type { BudgetCategory, ScheduledPayment } from '@/lib/engine/types';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';
import { deletePayment, savePayment, type SaveResult } from './actions';

/**
 * Editable scheduled payments (US-21 / §4.6).
 *
 * The only interactive part of this screen, so the only part that is a client
 * component — the rest of the page stays server rendered and the route keeps
 * its near-zero JavaScript.
 *
 * The design problem here is not CRUD. It is that **"already in my monthly
 * budget" is a checkbox that moves the runway figure**, and a user has no
 * reason to guess that. So the flag is not a bare checkbox: it states the
 * consequence in both directions, and ticking it reveals the budget-line
 * selector rather than hiding a validation failure until save.
 */

const INITIAL: SaveResult = { ok: false };

const TYPE_LABEL: Record<string, string> = {
  cheque: 'Cheque',
  transfer: 'Transfer',
  autoDebit: 'Auto-debit',
};

const RECURRENCE_LABEL: Record<string, string> = {
  none: 'One-off',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  termly: 'Termly',
  yearly: 'Yearly',
};

const STATUS_LABEL: Record<string, string> = {
  upcoming: 'Upcoming',
  paid: 'Paid',
  atRisk: 'At risk',
};

const BLANK: ScheduledPayment = {
  id: '',
  dueDate: '',
  payee: '',
  purpose: '',
  amount: 0,
  account: '',
  type: 'cheque',
  recurrence: 'none',
  includedInBudget: false,
  status: 'upcoming',
};

function Row({
  label,
  htmlFor,
  help,
  children,
}: {
  label: string;
  htmlFor: string;
  help?: string;
  children: React.ReactNode;
}) {
  const helpId = `${htmlFor}-help`;
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? (
        <div className="help" id={helpId}>
          {help}
        </div>
      ) : null}
    </div>
  );
}

function PaymentForm({
  payment,
  categories,
  onDone,
}: {
  payment: ScheduledPayment;
  categories: BudgetCategory[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(savePayment, INITIAL);
  // Controlled purely so the budget-line selector can appear on tick. Every
  // other field is uncontrolled with a defaultValue, as elsewhere in this app.
  const [inBudget, setInBudget] = useState(payment.includedInBudget);
  const isNew = payment.id === '';

  // A save that succeeded closes the form. Reading it from render rather than
  // an effect keeps the component honest: there is no state to get out of sync.
  if (state.ok && !pending) {
    queueMicrotask(onDone);
  }

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={payment.id} />

      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add a scheduled payment' : `Edit — ${payment.payee}`}
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
        <Row label="Payee" htmlFor="f-payee">
          <input id="f-payee" name="payee" defaultValue={payment.payee} required />
        </Row>
        <Row label="Purpose" htmlFor="f-purpose">
          <input id="f-purpose" name="purpose" defaultValue={payment.purpose} />
        </Row>
        <Row label="Due date" htmlFor="f-dueDate" help="The date it clears, not the date you wrote it.">
          <input id="f-dueDate" name="dueDate" type="date" defaultValue={payment.dueDate} required />
        </Row>
        <Row label="Amount (AED)" htmlFor="f-amount">
          <input id="f-amount" name="amount" type="number" min={0} step="0.01" defaultValue={payment.amount || ''} required />
        </Row>
        <Row
          label="Type"
          htmlFor="f-type"
          help="Cheques are shown first and counted separately — bouncing one in the UAE has legal consequences."
        >
          <select id="f-type" name="type" defaultValue={payment.type}>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Row>
        <Row label="Recurrence" htmlFor="f-recurrence">
          <select id="f-recurrence" name="recurrence" defaultValue={payment.recurrence}>
            {Object.entries(RECURRENCE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Row>
        <Row label="Account" htmlFor="f-accountLabel" help="However you refer to it — never a full account number.">
          <input id="f-accountLabel" name="accountLabel" defaultValue={payment.account} />
        </Row>
        <Row label="Status" htmlFor="f-status">
          <select id="f-status" name="status" defaultValue={payment.status}>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Row>
      </div>

      {/*
        G-1, stated rather than implied. This checkbox is the difference between
        a payment being counted once and counted twice, and the user cannot be
        expected to infer that from the words "in budget".
      */}
      <div
        style={{
          marginTop: 16,
          padding: '12px 14px',
          border: '1px solid var(--rule, #d3d9dc)',
          borderRadius: 4,
        }}
      >
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="f-inBudget" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              id="f-inBudget"
              name="includedInBudget"
              type="checkbox"
              checked={inBudget}
              onChange={(e) => setInBudget(e.target.checked)}
              aria-describedby="f-inBudget-help"
            />
            <span>This amount is already inside a monthly budget line</span>
          </label>
          <div className="help" id="f-inBudget-help">
            {inBudget ? (
              <>
                <b>Ticked:</b> the projection will <b>not</b> subtract this again as a lump sum,
                because it is already part of your monthly burn. Say which line covers it.
              </>
            ) : (
              <>
                <b>Unticked:</b> the projection subtracts this as a <b>lump sum</b> on its due date,
                on top of your monthly burn. Correct for a one-off — a balloon payment, a family
                loan — that no monthly budget line covers.
              </>
            )}
          </div>
        </div>

        {inBudget ? (
          <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <label htmlFor="f-budgetCategoryId">Budget line</label>
            <select
              id="f-budgetCategoryId"
              name="budgetCategoryId"
              defaultValue={payment.budgetCategoryId ?? ''}
              required
            >
              <option value="">Choose a budget line…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add payment' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteButton({ id, payee }: { id: string; payee: string }) {
  const [state, action, pending] = useActionState(deletePayment, INITIAL);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="id" value={id} />
      <button
        className="btn"
        type="submit"
        disabled={pending}
        aria-label={`Delete ${payee}`}
        title={state.error ?? undefined}
      >
        {pending ? '…' : 'Delete'}
      </button>
    </form>
  );
}

export function PaymentsEditor({
  payments,
  categories,
}: {
  payments: ScheduledPayment[];
  categories: BudgetCategory[];
}) {
  const [editing, setEditing] = useState<ScheduledPayment | null>(null);
  const [fType, setType] = useState('');
  const [fAccount, setAccount] = useState('');
  const [fStatus, setStatus] = useState('');

  // Only offer values that actually appear. A filter whose every option can
  // return nothing is worse than no filter — the same rule the transactions
  // ledger follows.
  const accounts = useMemo(
    () => [...new Set(payments.map((p) => p.account).filter(Boolean))].sort(),
    [payments],
  );

  const rows = useMemo(
    () =>
      payments
        .filter((p) => (fType ? p.type === fType : true))
        .filter((p) => (fAccount ? p.account === fAccount : true))
        .filter((p) => (fStatus ? p.status === fStatus : true))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [payments, fType, fAccount, fStatus],
  );

  const filtered = fType || fAccount || fStatus;

  return (
    <>
      {editing ? (
        <PaymentForm
          key={editing.id || 'new'}
          payment={editing}
          categories={categories}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add a payment
          </button>
        </div>
      )}

      <div className="filters" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="fl-type">Type</label>
          <select id="fl-type" value={fType} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="fl-account">Account</label>
          <select id="fl-account" value={fAccount} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="fl-status">Status</label>
          <select id="fl-status" value={fStatus} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        {filtered ? (
          <button
            className="btn"
            type="button"
            style={{ alignSelf: 'end' }}
            onClick={() => {
              setType('');
              setAccount('');
              setStatus('');
            }}
          >
            Clear filters
          </button>
        ) : null}
        <div
          aria-live="polite"
          style={{ alignSelf: 'end', fontSize: 12.5, color: 'var(--ink-3)', paddingBottom: 8 }}
        >
          Showing {rows.length} of {payments.length}
        </div>
      </div>

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Next due</th><th>Payee</th><th>Purpose</th><th>Type</th>
              <th>Recurrence</th><th>Account</th><th className="r">Amount</th>
              <th>In budget</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="mono">{formatDate(p.dueDate)}</td>
                <td className="payee">{p.payee}</td>
                <td>{p.purpose}</td>
                <td>
                  {p.type === 'cheque' ? (
                    <span className="pill cheque"><span aria-hidden>◆</span> Cheque</span>
                  ) : (
                    <span className="pill">{TYPE_LABEL[p.type]}</span>
                  )}
                </td>
                <td>{RECURRENCE_LABEL[p.recurrence]}</td>
                <td>{p.account}</td>
                <td className="r amt mono">{money(p.amount)}</td>
                <td>
                  {p.includedInBudget ? (
                    <span className="pill ok"><span aria-hidden>✓</span> Yes</span>
                  ) : (
                    <span className="pill"><span aria-hidden>✕</span> No</span>
                  )}
                </td>
                <td>
                  {p.status === 'atRisk' ? (
                    <span className="pill risk"><span aria-hidden>▲</span> At risk</span>
                  ) : p.status === 'paid' ? (
                    <span className="pill ok"><span aria-hidden>✓</span> Paid</span>
                  ) : (
                    <span className="pill">Upcoming</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(p)}
                    aria-label={`Edit ${p.payee}`}
                  >
                    Edit
                  </button>
                  <DeleteButton id={p.id} payee={p.payee} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  {payments.length === 0
                    ? 'No scheduled payments yet. Add the cheques and standing obligations you have committed to.'
                    : 'No payments match these filters.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
