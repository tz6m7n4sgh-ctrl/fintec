'use client';

import { useActionState, useState } from 'react';
import type { IncomeStream } from '@/lib/engine/types';
import { incomeAfterLastDay, monthlyIncomeOn, streamsEndingBy } from '@/lib/engine/income';
import { formatDate } from '@/lib/engine/dates';
import { aed, money } from '@/lib/format/money';
import { deleteIncomeStream, saveIncomeStream, type IncomeResult } from './actions';

/**
 * Editable income streams (US-27).
 *
 * The story's real content is not the CRUD, it is that **income stops when the
 * job does** — and until now that was a property of the seed rather than a rule.
 * `lib/engine/income.ts` evaluates each stream against its own window, so the
 * salary ending on the last working day falls out of the dates instead of being
 * asserted about one particular row.
 *
 * The screen shows both figures side by side, because the difference between
 * them is the thing the user is actually planning around.
 */

const INITIAL: IncomeResult = { ok: false };

const BLANK: IncomeStream = {
  id: '',
  name: '',
  amount: 0,
  frequency: 'monthly',
  active: true,
};

function StreamForm({
  stream,
  expectedLastDay,
  onDone,
}: {
  stream: IncomeStream;
  expectedLastDay: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveIncomeStream, INITIAL);
  const isNew = stream.id === '';
  if (state.ok && !pending) queueMicrotask(onDone);

  return (
    <form action={action} className="card" style={{ marginBottom: 14 }}>
      <input type="hidden" name="id" value={stream.id} />
      <h2 style={{ fontSize: 15, marginTop: 0 }}>
        {isNew ? 'Add an income stream' : `Edit — ${stream.name}`}
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
        <div className="field">
          <label htmlFor="i-name">Name</label>
          <input id="i-name" name="name" defaultValue={stream.name} required />
        </div>
        <div className="field">
          <label htmlFor="i-amount">Amount (AED)</label>
          <input
            id="i-amount"
            name="amount"
            type="number"
            min={0}
            step="0.01"
            defaultValue={stream.amount || ''}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="i-frequency">Frequency</label>
          <select id="i-frequency" name="frequency" defaultValue={stream.frequency}>
            <option value="monthly">Monthly</option>
            <option value="oneOff">One-off</option>
          </select>
          <div className="help">
            Only monthly streams count towards the figure that offsets your burn — a one-off is an
            amount on a date, not a rate.
          </div>
        </div>
        <div className="field">
          <label htmlFor="i-startDate">Starts</label>
          <input id="i-startDate" name="startDate" type="date" defaultValue={stream.startDate ?? ''} />
          <div className="help">Leave blank if it is already running.</div>
        </div>
        <div className="field">
          <label htmlFor="i-endDate">Ends</label>
          <input
            id="i-endDate"
            name="endDate"
            type="date"
            defaultValue={stream.endDate ?? ''}
            aria-describedby="i-endDate-help"
          />
          <div className="help" id="i-endDate-help">
            The last day it pays. For your salary this is your last working day (
            {formatDate(expectedLastDay)}) — that date is what stops it counting towards your
            runway, so it is worth getting right.
          </div>
        </div>
        <div className="field">
          <label htmlFor="i-active" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              id="i-active"
              name="active"
              type="checkbox"
              defaultChecked={stream.active}
            />
            <span>Active</span>
          </label>
          <div className="help">Unticking stops it counting on every date, whatever its window.</div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending ? 'Saving…' : isNew ? 'Add stream' : 'Save changes'}
        </button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteStream({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteIncomeStream, INITIAL);
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

export function IncomeEditor({
  income,
  expectedLastDay,
}: {
  income: IncomeStream[];
  expectedLastDay: string;
}) {
  const [editing, setEditing] = useState<IncomeStream | null>(null);

  const nowTotal = monthlyIncomeOn(income, expectedLastDay);
  const afterTotal = incomeAfterLastDay(income, expectedLastDay);
  const ending = streamsEndingBy(income, expectedLastDay);

  return (
    <>
      {editing ? (
        <StreamForm
          key={editing.id || 'new'}
          stream={editing}
          expectedLastDay={expectedLastDay}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div style={{ marginBottom: 12 }}>
          <button className="btn primary" type="button" onClick={() => setEditing(BLANK)}>
            Add an income stream
          </button>
        </div>
      )}

      <div className="tbl-wrap" tabIndex={0}>
        <table className="wide">
          <thead>
            <tr>
              <th>Name</th><th>Frequency</th><th className="r">Amount</th>
              <th>Starts</th><th>Ends</th><th>Active</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {income.map((i) => (
              <tr key={i.id}>
                <td className="payee">{i.name}</td>
                <td>{i.frequency === 'monthly' ? 'Monthly' : 'One-off'}</td>
                <td className="r amt mono">{money(i.amount)}</td>
                <td className="mono">{i.startDate ? formatDate(i.startDate) : '—'}</td>
                <td className="mono">{i.endDate ? formatDate(i.endDate) : '—'}</td>
                <td>
                  {i.active ? (
                    <span className="pill ok"><span aria-hidden>✓</span> Active</span>
                  ) : (
                    <span className="pill"><span aria-hidden>✕</span> Inactive</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 6 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setEditing(i)}
                    aria-label={`Edit ${i.name}`}
                  >
                    Edit
                  </button>
                  <DeleteStream id={i.id} name={i.name} />
                </td>
              </tr>
            ))}
            {income.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                  No income streams recorded. Add your salary with its last working day as the end
                  date, and anything that keeps paying afterwards.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/*
        The two figures the user is actually planning around. Showing them apart
        is the point: the gap between them is what the termination scenario is.
      */}
      <div className="grid g2" style={{ marginTop: 14 }}>
        <div className="card tile">
          <div className="lbl">Monthly income on {formatDate(expectedLastDay)}</div>
          <div className="val mono">{money(nowTotal)}</div>
          <div className="foot">Everything still running on your last working day</div>
        </div>
        <div className="card tile">
          <div className="lbl">Monthly income the day after</div>
          <div className="val mono">{money(afterTotal)}</div>
          <div className="foot">
            {ending.length === 0
              ? 'Nothing ends on your last day — check your salary carries an end date'
              : `${ending.map((s) => s.name).join(', ')} stops — ${aed(nowTotal - afterTotal)} less per month`}
          </div>
        </div>
      </div>
    </>
  );
}
