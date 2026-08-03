'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  browserSupportsWebAuthn,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';
import { beginPasskeyRegistration, finishPasskeyRegistration, removePasskey } from './passkey-actions';

/**
 * Adding and revoking passkeys (US-40 / HAD-17).
 *
 * ## Why the revoke list is the feature
 *
 * Registering a passkey is a one-off; living with several of them is not. A
 * user who replaces a phone has a credential in the table for a device they no
 * longer own, and no way to tell which row it is unless the rows are named and
 * dated. So the list carries a label, when it was added, and when it was last
 * used — the last of those being the one that actually identifies the stale
 * entry, because the passkey you never use is the one you no longer have.
 *
 * ## Why removing takes two clicks
 *
 * A misclick that revokes a sign-in method is recoverable here — the password
 * still works — but only because the password still works. The confirmation is
 * in the button rather than in a dialog: a browser `confirm()` cannot be
 * styled, is suppressed in some contexts, and is one more thing the a11y suite
 * cannot see into.
 */

export interface PasskeyRow {
  id: string;
  label: string;
  transports: string[];
  added: string | null;
  lastUsed: string | null;
}

export function PasskeyManager({
  passkeys,
  unreadable = false,
}: {
  passkeys: PasskeyRow[];
  unreadable?: boolean;
}) {
  const router = useRouter();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();

  // Only answerable in the browser; `null` until it is, so the button does not
  // flash and disappear on a device that cannot use it.
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  async function add() {
    setBusy(true);
    setError('');
    setAdded('');

    const begin = await beginPasskeyRegistration();
    if (begin.error || !begin.options) {
      setBusy(false);
      setError(begin.error ?? 'Passkeys are not available right now.');
      return;
    }

    let attestation: unknown;
    try {
      attestation = await startRegistration({ optionsJSON: begin.options });
    } catch (caught) {
      setBusy(false);
      setError(explain(caught));
      return;
    }

    const finished = await finishPasskeyRegistration(begin.options.challenge, attestation);
    setBusy(false);

    if (finished.error) {
      setError(finished.error);
      return;
    }

    setAdded(finished.label ?? 'Passkey');
    // The list is server-rendered, so the new row appears only once the server
    // components are rebuilt.
    router.refresh();
  }

  function remove(id: string) {
    setError('');
    startRemoving(async () => {
      const result = await removePasskey(id);
      setConfirming(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {unreadable ? (
        <p role="alert" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--critical-ink)' }}>
          ✕ Your passkeys could not be read just now, so this list is not a statement that you have
          none. Reload before adding one, or you may end up with a duplicate.
        </p>
      ) : passkeys.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          No passkeys yet. Adding one lets you sign in with this device&rsquo;s fingerprint, face or
          PIN instead of typing a password.
        </p>
      ) : (
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Passkey</th>
                <th scope="col">Added</th>
                <th scope="col">Last used</th>
                <th scope="col" className="r">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((key) => (
                <tr key={key.id}>
                  <th scope="row" className="rowhead">
                    {key.label}
                    {key.transports.length > 0 ? (
                      <span
                        className="sub"
                        style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}
                      >
                        {key.transports.join(', ')}
                      </span>
                    ) : null}
                  </th>
                  <td className="tnum">{key.added ?? '—'}</td>
                  {/*
                    An unused passkey is the one most likely to belong to a
                    device that is gone, so this says so rather than showing a
                    dash the reader has to interpret.
                  */}
                  <td className="tnum">{key.lastUsed ?? 'Never used'}</td>
                  <td className="r">
                    {confirming === key.id ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button
                          className="btn"
                          type="button"
                          disabled={removing}
                          onClick={() => remove(key.id)}
                          style={{ color: 'var(--critical-ink)' }}
                        >
                          {removing ? 'Removing…' : 'Yes, remove'}
                        </button>
                        <button className="btn" type="button" onClick={() => setConfirming(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setConfirming(key.id)}
                        aria-label={`Remove the passkey "${key.label}"`}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <div
          role="alert"
          style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--critical-ink)', marginTop: 12 }}
        >
          ✕ {error}
        </div>
      ) : null}

      {added ? (
        <div role="status" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 12 }}>
          ✓ Added <b>{added}</b>. It can sign you in from now on.
        </div>
      ) : null}

      {supported === false ? (
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 12 }}>
          This browser does not support passkeys, so one cannot be added from here. Your password
          continues to work.
        </p>
      ) : (
        <button
          className="btn primary"
          type="button"
          onClick={add}
          disabled={busy || supported === null}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      )}

      <div className="legend">
        <span className="key">
          <b>A passkey is never the only way in (R-4).</b> Email and password sign-in always
          remains, which is what makes losing every registered device recoverable. It is also why
          adding a passkey is not the same as turning a password off — there is nothing here that
          does that.
        </span>
      </div>
    </>
  );
}

/** See `app/auth/PasskeySignIn.tsx` — the same names, from the registration side. */
function explain(caught: unknown): string {
  if (caught instanceof WebAuthnError || caught instanceof Error) {
    const name = 'name' in caught ? caught.name : '';

    if (name === 'InvalidStateError') {
      /*
       * The authenticator recognised itself in `excludeCredentials` and
       * refused. That is the exclude list doing its job, and saying "already
       * registered" is more useful than saying it failed.
       */
      return 'This device already has a passkey for this account.';
    }
    if (name === 'NotAllowedError') {
      return 'The prompt was dismissed, so nothing was added.';
    }
    if (name === 'SecurityError') {
      return 'This browser will not create a passkey on this address. Passkeys need the site to be served over HTTPS on its real domain.';
    }
    if (name === 'NotSupportedError') {
      return 'This device cannot create the kind of passkey this app asks for — one that stays on the device and is unlocked with a fingerprint, face or PIN.';
    }
  }
  return 'The passkey prompt did not complete. Try again.';
}
