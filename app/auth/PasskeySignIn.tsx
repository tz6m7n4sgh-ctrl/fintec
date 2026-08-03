'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  WebAuthnError,
} from '@simplewebauthn/browser';
import { beginPasskeySignIn, finishPasskeySignIn } from './passkey-actions';

/**
 * The passkey half of the sign-in screen (US-40).
 *
 * ## Why it renders nothing until it knows
 *
 * `browserSupportsWebAuthn()` can only be answered in the browser, so the
 * server has no way to decide whether this button is usable. Rendering it
 * anyway and failing on click would put a dead control on the one screen where
 * a user is least able to tell a broken app from their own mistake — so it
 * starts hidden and appears once the answer is known. That costs a frame on
 * the screen where it matters least: the password form below is already
 * rendered, focused and usable.
 *
 * ## Why the errors are this specific
 *
 * A passkey fails in ways the user can fix, and "sign-in failed" tells them
 * none of them. Cancelling the system prompt, having no passkey on *this*
 * device, and a browser that refuses the ceremony over an insecure origin are
 * three different situations with three different next steps, and WebAuthn
 * reports them as distinguishable errors. Flattening them would be throwing
 * away the only useful thing the browser said.
 */

/** Nothing is thrown away silently; every branch below sets one of these. */
type Status = 'idle' | 'busy' | 'error';

export function PasskeySignIn() {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  async function signIn() {
    setStatus('busy');
    setError('');

    const begin = await beginPasskeySignIn();
    if (begin.error || !begin.options) {
      setStatus('error');
      setError(begin.error ?? 'Passkey sign-in is not available right now.');
      return;
    }

    let assertion: unknown;
    try {
      assertion = await startAuthentication({ optionsJSON: begin.options });
    } catch (caught) {
      setStatus('error');
      setError(explain(caught));
      return;
    }

    const finished = await finishPasskeySignIn(begin.options.challenge, assertion);
    if (!finished.ok) {
      setStatus('error');
      setError(finished.error ?? 'That passkey could not be verified.');
      return;
    }

    /*
     * `refresh()` before `replace()` so the server components are rebuilt with
     * the new cookie before the destination renders. Without it the app shell
     * can paint one frame still believing nobody is signed in, which on this
     * app means a flash of the reference dataset — sample figures shown as if
     * they were the user's, which is the one thing every screen here is built
     * not to do.
     */
    router.refresh();
    router.replace('/');
  }

  if (!supported) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      <button
        className="btn"
        type="button"
        onClick={signIn}
        disabled={status === 'busy'}
        style={{ width: '100%' }}
      >
        {status === 'busy' ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>

      {status === 'error' && error ? (
        <div
          role="alert"
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: 'var(--critical-ink)',
            marginTop: 10,
          }}
        >
          ✕ {error}
        </div>
      ) : null}

      <p style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 10 }}>
        A passkey uses this device&rsquo;s fingerprint, face or PIN. Your password still works and
        is the way back in if you lose the device.
      </p>
    </div>
  );
}

/**
 * Turns a WebAuthn failure into the next thing to try.
 *
 * The names are the DOM exception names the spec defines, and they are checked
 * rather than the messages, which differ by browser.
 */
function explain(caught: unknown): string {
  if (caught instanceof WebAuthnError || caught instanceof Error) {
    const name = 'name' in caught ? caught.name : '';

    /*
     * The browser reports "cancelled" and "no matching credential" as the same
     * `NotAllowedError`, on purpose — telling them apart would say whether an
     * account has a passkey to somebody who just clicked a button. So this
     * names both possibilities rather than guessing which happened.
     */
    if (name === 'NotAllowedError') {
      return 'No passkey was used. Either the prompt was dismissed, or this device has no passkey for this account — sign in with your password and add one from Settings.';
    }
    if (name === 'SecurityError') {
      return 'This browser will not use a passkey on this address. Passkeys need the site to be served over HTTPS on its real domain.';
    }
    if (name === 'InvalidStateError') {
      return 'This device already has a passkey for this account.';
    }
    if (name === 'AbortError') {
      return 'The passkey prompt was closed before it finished.';
    }
    if (name === 'NotSupportedError') {
      return 'This device cannot create the kind of passkey this app asks for.';
    }
  }
  return 'The passkey prompt did not complete. Try again, or sign in with your password.';
}
