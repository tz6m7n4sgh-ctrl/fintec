'use client';

import { useActionState, useState } from 'react';
import { PASSWORD_INITIAL, changePassword } from './password-actions';
import { signOut } from '@/app/auth/actions';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/credentials';

/**
 * Changing a password from inside the app (HAD-74).
 *
 * Behind a reveal rather than always open. Three password fields permanently on
 * the Settings screen invite a browser's password manager to fill them and a
 * passer-by to read the card as "this account's password is here" — and the
 * control is used approximately never.
 */

export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(changePassword, PASSWORD_INITIAL);

  if (state.ok) {
    return (
      <div role="status">
        <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
          <b>✓ Your password has been changed.</b> This browser is still signed in with the new
          one.
        </p>
        {/*
          Offered here rather than left to be found. Changing a password is
          usually a response to somebody else having had it, and the change
          alone does not evict them — an existing session on another device
          keeps working until its refresh token is revoked.
        */}
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          If you changed it because someone else may have known it, that is not finished:{' '}
          <b>a session already open on another device keeps working</b> until its token is
          revoked. Sign out everywhere to end them.
        </p>
        <form action={signOut}>
          <button className="btn" type="submit">Sign out everywhere</button>
        </form>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="btn" type="button" onClick={() => setOpen(true)}>
        Change password…
      </button>
    );
  }

  return (
    <form action={action}>
      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 12, fontSize: 13 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="pw-current">Current password</label>
        <input
          id="pw-current"
          name="current"
          type="password"
          autoComplete="current-password"
          aria-describedby="pw-current-help"
        />
        <span className="help" id="pw-current-help">
          Asked for because changing a password does not otherwise require knowing it — without
          this, an open session left unattended could be used to lock you out.
        </span>
      </div>

      <div className="field">
        <label htmlFor="pw-next">New password</label>
        <input
          id="pw-next"
          name="next"
          type="password"
          autoComplete="new-password"
          aria-describedby="pw-next-help"
        />
        <span className="help" id="pw-next-help">
          At least {PASSWORD_MIN_LENGTH} characters.
        </span>
      </div>

      <div className="field">
        <label htmlFor="pw-confirm">Confirm new password</label>
        {/*
          No `required` and no `minlength`: the server decides. Browser-side
          validation on a form like this would let a disabled-JS submit through
          unchecked — the same reasoning as the erase confirmation.
        */}
        <input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? 'Changing…' : 'Change password'}
        </button>
        <button className="btn primary" type="button" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
