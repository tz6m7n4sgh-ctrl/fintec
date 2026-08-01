'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Email + one-time-code sign-in (US-39 / FR-K1).
 *
 * A six-digit code rather than a magic link, for two reasons that matter here:
 * a link opens in whichever browser handles mail — often an in-app webview
 * where the session lands in the wrong place — and a code can be completed on
 * the device that started the flow. FR-K2 later adds passkeys on top; email
 * stays as the recovery path so a passkey is never the only way in (R-4).
 *
 * Errors are shown verbatim from Supabase rather than replaced with a generic
 * message. "Email logins are disabled" and "Token has expired" need different
 * actions from the user, and hiding which one happened helps nobody.
 */

type Stage = 'email' | 'code';

export function SignInForm() {
  const router = useRouter();
  const supabase = createClient();

  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!supabase) {
    return (
      <div className="card" style={{ borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)' }}>
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <b>▲ Sign-in is not configured.</b> This deployment has no Supabase URL or publishable
          key set, so there is nothing to sign in to. The app still renders the reference dataset.
        </div>
      </div>
    );
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const { error } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      // No account is created for an unknown address: this is a single-user
      // app, and silently provisioning accounts for typos is not wanted.
      options: { shouldCreateUser: false },
    });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage('code');
    setNotice(`Code sent to ${email.trim()}. It expires in about an hour.`);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabase!.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }

    // refresh() re-runs the server components so the shell and the read model
    // both pick up the new session without a full page load.
    router.push('/');
    router.refresh();
  }

  return (
    <>
      {error && (
        <div
          className="card"
          style={{
            marginBottom: 14,
            borderColor: 'color-mix(in oklab, var(--critical) 45%, transparent)',
          }}
          role="alert"
        >
          <div style={{ fontSize: 13, color: 'var(--critical-ink)' }}>
            <b>✕ {error}</b>
          </div>
        </div>
      )}

      {notice && !error && (
        <div className="card" style={{ marginBottom: 14 }} role="status">
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>{notice}</div>
        </div>
      )}

      {stage === 'email' ? (
        <form onSubmit={sendCode}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby="email-help"
            />
            <div className="help" id="email-help">
              We send a six-digit code. No password to remember or lose.
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <div className="field">
            <label htmlFor="code">Six-digit code</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby="code-help"
            />
            <div className="help" id="code-help">
              Sent to {email.trim()}. Check spam if it has not arrived.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary" type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                setStage('email');
                setCode('');
                setError(null);
                setNotice(null);
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
    </>
  );
}
