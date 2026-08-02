'use client';

import { useActionState } from 'react';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';
import {
  confirmAllPending,
  confirmTransaction,
  discardTransaction,
  type ReviewResult,
} from './actions';

/**
 * The review inbox (US-31 / R-2).
 *
 * This screen is the safety net, not a queue to be cleared. An LLM reading a
 * bank statement can misread an amount, and until a human says otherwise a
 * parsed row counts toward nothing — `monthlyActuals()` skips anything still
 * pending, which `projection.test.ts` asserts.
 *
 * So the design here runs against convenience on purpose: confirming says
 * plainly that it starts moving figures, and the bulk action names how many
 * rows it will affect rather than offering a bare "Confirm all". Someone who
 * clicks without reading should still not be surprised by what happened.
 *
 * Each row's controls live inside **one** table cell. A `<form>` wrapping
 * several `<td>`s is invalid HTML — the browser hoists it out of the table and
 * the fields stop submitting together — so the form is nested in a cell rather
 * than spanning them.
 */

const INITIAL: ReviewResult = { ok: false };

export interface ReviewRow {
  id: string;
  date: string;
  description: string;
  accountLabel: string;
  amount: number;
  direction: 'credit' | 'debit';
  categoryId?: string;
  matchedScheduledPaymentId?: string;
  matchLabel?: string;
  /** Why the match was proposed — shown so the user can evaluate it. */
  matchReason?: string;
  /** True when this came from the matcher rather than being stored. */
  isProposed?: boolean;
  /** True when the category came from a keyword rule rather than being stored. */
  isCategoryProposed?: boolean;
}

function RowControls({
  row,
  categories,
  payments,
}: {
  row: ReviewRow;
  categories: Array<{ id: string; label: string }>;
  payments: Array<{ id: string; label: string }>;
}) {
  const [confirmState, confirmAction, confirming] = useActionState(confirmTransaction, INITIAL);
  const [discardState, discardAction, discarding] = useActionState(discardTransaction, INITIAL);
  const error = confirmState.error ?? discardState.error;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <form action={confirmAction} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="hidden" name="id" value={row.id} />
        {/*
          Editable, not hidden — and that distinction became a defect the moment
          US-33 started proposing matches.

          While nothing proposed, the field was always empty and un-editable did
          no harm. With a proposal in it, a user facing a *wrong* match had two
          options: Confirm, which marks an outstanding payment paid (US-18, R-5),
          or Discard, which loses a real transaction. The correct action —
          "right transaction, wrong match, clear it" — did not exist.

          It still defaults to the proposal, because dropping it would silently
          un-match a payment the matcher had correctly identified.
        */}
        <select
          name="matchedScheduledPaymentId"
          defaultValue={row.matchedScheduledPaymentId ?? ''}
          aria-label={
            row.isProposed
              ? `Matched payment for ${row.description} — suggested, change or clear it`
              : `Matched payment for ${row.description}`
          }
        >
          <option value="">No match</option>
          {payments.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <select
          name="categoryId"
          defaultValue={row.categoryId ?? ''}
          aria-label={
            row.isCategoryProposed
              ? `Category for ${row.description} — suggested by a keyword rule`
              : `Category for ${row.description}`
          }
          title={row.isCategoryProposed ? 'Suggested by a keyword rule' : undefined}
        >
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        <button className="btn primary" type="submit" disabled={confirming || discarding}>
          {confirming ? '…' : 'Confirm'}
        </button>
      </form>

      <form action={discardAction}>
        <input type="hidden" name="id" value={row.id} />
        <button
          className="btn"
          type="submit"
          disabled={confirming || discarding}
          title="The parser got this row wrong — remove it"
          aria-label={`Discard ${row.description}`}
        >
          {discarding ? '…' : 'Discard'}
        </button>
      </form>

      {error ? (
        <span role="alert" style={{ color: 'var(--critical-ink)', fontSize: 12 }}>
          ✕ {error}
        </span>
      ) : null}
    </div>
  );
}

function ConfirmAll({ count }: { count: number }) {
  const [state, action, pending] = useActionState(confirmAllPending, INITIAL);
  return (
    <form action={action} style={{ marginBottom: 12 }}>
      <button className="btn" type="submit" disabled={pending || count === 0}>
        {pending ? 'Confirming…' : `Confirm all ${count} as read`}
      </button>
      {state.error ? (
        <span role="alert" style={{ color: 'var(--critical-ink)', marginLeft: 10 }}>
          ✕ {state.error}
        </span>
      ) : null}
      <span className="help" style={{ display: 'block', marginTop: 6 }}>
        Accepts every row exactly as parsed and starts counting them toward your actual
        spending. It leaves any category you have already set alone — correct those
        individually first.
      </span>
    </form>
  );
}

export function ReviewInbox({
  rows,
  categories,
  payments,
}: {
  rows: ReviewRow[];
  categories: Array<{ id: string; label: string }>;
  /** Selectable payments. Derived rows are excluded — they cannot be stored. */
  payments: Array<{ id: string; label: string }>;
}) {
  return (
    <>
      <ConfirmAll count={rows.length} />

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Account</th>
              <th className="r">Amount</th><th>Proposed match</th><th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="tnum">{formatDate(row.date)}</td>
                <td className="payee">{row.description}</td>
                <td>{row.accountLabel}</td>
                <td className="r amt tnum">
                  {row.direction === 'debit' ? '−' : '+'}{money(row.amount)}
                </td>
                <td>
                  {row.matchLabel ? (
                    <>
                      <span className={row.isProposed ? 'pill' : 'pill ok'}>
                        <span aria-hidden>{row.isProposed ? '?' : '✓'}</span> {row.matchLabel}
                      </span>
                      {/*
                        A proposal is labelled as one, and carries why. A
                        suggestion the user cannot evaluate is a suggestion they
                        will rubber-stamp — and a confirmed wrong match marks an
                        outstanding cheque paid.
                      */}
                      {row.isProposed ? (
                        <span className="sub">Suggested — {row.matchReason}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="pill">No match</span>
                  )}
                </td>
                <td><RowControls row={row} categories={categories} payments={payments} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
