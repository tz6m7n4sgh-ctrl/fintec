'use client';

import Link from 'next/link';
import { useActionState } from 'react';
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
          autoComplete={isSignUp ? 'email' : 'username'}
          required
          aria-required="true"
          aria-describedby="email-help"
        />
        <div className="help" id="email-help">
          {isSignUp
            ? 'This names your account and is how you sign back in. Nothing is sent to it — there is no confirmation email and no link to click.'
            : 'The address you signed up with.'}
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
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
              password can only be cleared from the Supabase dashboard.
            </>
          ) : (
            'Forgotten it? There is no reset email — it has to be cleared from the Supabase dashboard.'
          )}
        </div>
      </div>

      {isSignUp && (
        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            name="confirm"
            type="password"
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
