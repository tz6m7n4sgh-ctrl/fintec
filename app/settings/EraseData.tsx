'use client';

import { useActionState, useState } from 'react';
import { eraseAllData, type EraseResult } from './erase-actions';
import { ERASE_CONFIRMATION } from '@/lib/settings/erase';

/**
 * Erase everything (US-46).
 *
 * The control is deliberately awkward. Every other editor in this app is built
 * to get out of the way; this one is built to be difficult to do by accident,
 * because it is the only action here that destroys something irreplaceable and
 * the user's bank statements are among it.
 *
 * So: a two-step reveal, a typed phrase rather than a checkbox, and a list of
 * exactly what will go — written before the click, not after.
 */

const INITIAL: EraseResult = { ok: false };

const WHAT_GOES = [
  'Your profile — salary, dates, savings, everything on it',
  'Budget categories, debts, school fees and scheduled payments',
  'Income streams and bank accounts',
  'Every uploaded statement file, and every transaction parsed from one',
  'Categorisation rules and your action-plan progress',
];

export function EraseData() {
  const [armed, setArmed] = useState(false);
  const [state, action, pending] = useActionState(eraseAllData, INITIAL);

  if (state.ok) {
    return (
      <div role="status">
        <p style={{ fontSize: 13, lineHeight: 1.55 }}>
          <b>✓ Everything is gone.</b>{' '}
          {state.filesDeleted
            ? `${state.filesDeleted} statement file${state.filesDeleted === 1 ? '' : 's'} deleted, `
            : 'No statement files to delete, '}
          {Object.values(state.deleted ?? {}).reduce((a, b) => a + b, 0)} rows removed. Verified
          empty afterwards.
        </p>
        {/*
          Said plainly rather than left for someone to discover. Deleting the
          account itself needs the admin API and the service-role key, which
          this app does not have anywhere — see erase-actions.ts. "Deleted
          everything" that quietly leaves a login behind is the kind of
          half-truth this screen should not tell.
        */}
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          <b>Your sign-in still exists.</b> The data is gone, but the account is not — this app
          has no key that can delete an account, by design. Sign in again and you will find an
          empty app. To remove the login itself, delete the user in your Supabase dashboard.
        </p>
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
        Erases every figure you have entered and every statement you have uploaded.{' '}
        <b>There is no undo and no backup.</b> If you want a copy first, export your data before
        doing this.
      </p>

      {armed ? (
        <form action={action} className="card" style={{ marginTop: 12 }}>
          <h2 style={{ fontSize: 15, marginTop: 0, color: 'var(--critical-ink)' }}>
            This will permanently delete:
          </h2>
          <ul className="insights" style={{ marginBottom: 14 }}>
            {WHAT_GOES.map((line) => (
              <li key={line}>
                <span className="ic" style={{ color: 'var(--critical-ink)' }} aria-hidden>✕</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {state.error ? (
            <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12 }}>
              <b>✕ {state.error}</b>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="erase-confirm">
              Type <b>{ERASE_CONFIRMATION}</b> to confirm
            </label>
            <input
              id="erase-confirm"
              name="confirm"
              autoComplete="off"
              // No `required` and no pattern: the server decides. A form that
              // validates the phrase in the browser would let a disabled-JS
              // submit through unchecked.
              aria-describedby="erase-confirm-help"
            />
            <span className="help" id="erase-confirm-help">
              Exactly as written, in capitals.
            </span>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="btn" type="submit" disabled={pending}
              style={{ borderColor: 'var(--critical-ink)', color: 'var(--critical-ink)' }}>
              {pending ? 'Erasing…' : 'Erase everything'}
            </button>
            <button className="btn primary" type="button" onClick={() => setArmed(false)} disabled={pending}>
              Cancel — keep my data
            </button>
          </div>
        </form>
      ) : (
        <button className="btn" type="button" onClick={() => setArmed(true)}>
          Erase all my data…
        </button>
      )}
    </>
  );
}
