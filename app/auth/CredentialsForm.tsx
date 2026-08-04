'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/credentials';
import { signIn, signUp, type AuthResult } from './actions';

/**
 * The email + password form, shared by /sign-in and /sign-up.
 *
 * One component rather than two because the two screens differ by a single
 * field and some copy, and a second near-identical form is a second place for
 * the autocomplete hints, the error region and the validation rules to drift
 * apart.
 *
 * This is the only client component in the auth flow, and it holds no auth
 * logic at all — it posts a FormData to a server action and renders whatever
 * comes back. That is what keeps the Supabase client out of the browser bundle.
 * It also means the form works before hydration: without JavaScript the browser
 * posts it and the server responds, which for a sign-in screen is worth having.
 *
 * `autoComplete` is set precisely on every field. Password managers key off
 * these exact values, and getting them wrong is the difference between a
 * saved password offered automatically and a user locked out of an app with no
 * reset flow.
 */

const INITIAL: AuthResult = {};

/**
 * A password input with a Show/Hide toggle (HAD-127 — the frames specify it).
 *
 * In an app with no reset email, a typo in a hidden field is expensive, so
 * letting the user see what they typed is a recovery feature, not a
 * convenience. The toggle is a button, not a checkbox, and it never submits.
 * `aria-pressed` carries the state; the input keeps its own id, name and
 * autocomplete untouched so password managers behave exactly as before.
 * Progressive enhancement holds: before hydration the button does nothing and
 * the field is an ordinary password input.
 */
function PasswordInput(props: React.ComponentProps<'input'>) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input {...props} type={shown ? 'text' : 'password'} style={{ paddingRight: 56, width: '100%' }} />
      <button
        type="button"
        className="text-button"
        onClick={() => setShown(s => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', fontSize: 12.5, textDecoration: 'none', padding: '10px 10px' }}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function CredentialsForm({ mode }: { mode: 'signin' | 'signup' }) {
  const isSignUp = mode === 'signup';
  const [state, action, pending] = useActionState(isSignUp ? signUp : signIn, INITIAL);

  return (
    <form action={action}>
      {state.error && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            borderColor: 'color-mix(in oklab, var(--critical) 45%, transparent)',
          }}
          role="alert"
        >
          <div style={{ fontSize: 13, color: 'var(--critical-ink)', lineHeight: 1.55 }}>
            <b>✕ {state.error}</b>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          /*
           * `username`, not `email`, on both screens. `email` is the hint for
           * collecting an address as data; `username` is the hint for the field
           * that identifies the account, which is what a password manager pairs
           * with the password field when deciding what to save. Getting this
           * wrong means the manager may store a password with no identifier
           * attached — and in an app with no reset flow, a credential the
           * manager did not capture properly is a lockout.
           */
          autoComplete="username"
          required
          aria-required="true"
          aria-describedby="email-help"
          /*
           * React 19 resets an uncontrolled form once its action settles, and a
           * reset restores each input to its default value — so this is what
           * keeps the address on screen after a rejection rather than clearing
           * it. Empty on first render, which is correct.
           */
          defaultValue={state.email ?? ''}
        />
        <div className="help" id="email-help">
          {isSignUp
            ? 'This names your account and is how you sign back in. Nothing is sent to it — there is no confirmation email and no link to click.'
            : 'The address you signed up with.'}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          name="password"
          /*
           * 'new-password' tells a password manager to offer a generated one and
           * to save what is typed; 'current-password' tells it to fill what it
           * already has. Swapping them is the classic way to end up with a
           * manager that never offers to save the credential.
           */
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          required
          aria-required="true"
          minLength={isSignUp ? PASSWORD_MIN_LENGTH : undefined}
          aria-describedby="password-help"
        />
        <div className="help" id="password-help">
          {isSignUp ? (
            <>
              At least {PASSWORD_MIN_LENGTH} characters. <b>Choose one you can recover</b> — use a
              password manager if you have one. There is no reset email in this app, so a forgotten
              password requires help from the person who operates this app.
            </>
          ) : (
            'Forgotten it? There is no reset email. Contact the person who operates this app for help regaining access.'
          )}
        </div>
      </div>

      {isSignUp && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="confirm">Confirm password</label>
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            required
            aria-required="true"
            minLength={PASSWORD_MIN_LENGTH}
            aria-describedby="confirm-help"
          />
          <div className="help" id="confirm-help">
            Typed twice because a typo here cannot be undone by email.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
        <button className="btn primary" type="submit" disabled={pending}>
          {pending
            ? isSignUp
              ? 'Creating account…'
              : 'Signing in…'
            : isSignUp
              ? 'Create account'
              : 'Sign in'}
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <Link href="/sign-in" prefetch={false}>
                Sign in
              </Link>
            </>
          ) : (
            <>
              No account yet?{' '}
              <Link href="/sign-up" prefetch={false}>
                Create one
              </Link>
            </>
          )}
        </span>
      </div>
    </form>
  );
}
