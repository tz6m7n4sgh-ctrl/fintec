'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { parseOtpInput } from '@/lib/supabase/otp';

/**
 * Email sign-in (US-39 / FR-K1).
 *
 * A six-digit code is preferred over a magic link, for two reasons that matter
 * here: a link opens in whichever browser handles mail — often an in-app
 * webview where the session lands in the wrong place — and a code can be
 * completed on the device that started the flow. FR-K2 later adds passkeys on
 * top; email stays as the recovery path so a passkey is never the only way in
 * (R-4).
 *
 * Preferred, but not required. Which of the two Supabase sends is decided by
 * the project's email template, not by this code: `{{ .Token }}` sends a code,
 * `{{ .ConfirmationURL }}` sends a link, and the stock template is the latter.
 * Asking for a code and being sent a link is a dead end no user can debug, so
 * the box takes either — a pasted link carries the same grant, and verifying
 * its token hash needs no redirect and no dashboard configuration.
 *
 * Errors are shown verbatim from Supabase rather than replaced with a generic
 * message. "Email logins are disabled" and "Token has expired" need different
 * actions from the user, and hiding which one happened helps nobody.
 */

type Stage = 'email' | 'code';

export function SignInForm() {
  const router = useRouter();
  const supabase = createClient();
  const searchParams = useSearchParams();

  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // A failed click-through lands back here with the reason in the query string.
  const [error, setError] = useState<string | null>(searchParams.get('error'));
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
      /*
       * New addresses create an account. One flow covers both signing in and
       * signing up, which is the natural shape for a one-time code: the code
       * itself proves the address is real, so there is nothing a separate
       * sign-up step would add.
       *
       * This was `false` while the app was single-user by assumption. It is
       * not — the schema has always been multi-user, with `user_id` on every
       * table and RLS keyed to it. A typo now creates a stray empty account
       * rather than a confusing rejection; that is the better failure, since
       * the code simply never arrives and nothing is lost.
       */
      options: {
        shouldCreateUser: true,
        /*
         * Where a clicked link should land. Supabase honours this only if the
         * origin is in the project's allowed-redirect list; otherwise it falls
         * back to Site URL. Sending it costs nothing and makes the click path
         * work wherever the list has been set up — and where it has not, the
         * paste path below does not depend on this at all.
         */
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage('code');
    setNotice(`Sent to ${email.trim()}. It expires in about an hour. If this is your first time, signing in creates your account.`);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const parsed = parseOtpInput(code);
    if (!parsed) {
      setBusy(false);
      setError('That is neither a six-digit code nor a sign-in link. Paste either one exactly as it appears in the email.');
      return;
    }

    /*
     * Three shapes, three calls. A code is tied to the address that requested
     * it; a token hash stands on its own and passing an email alongside it
     * would be rejected; a `?code=` is an already-verified PKCE grant that only
     * needs exchanging.
     */
    const { error } =
      parsed.kind === 'code'
        ? await supabase!.auth.verifyOtp({
            email: email.trim(),
            token: parsed.token,
            type: 'email',
          })
        : parsed.kind === 'hash'
          ? await supabase!.auth.verifyOtp({
              token_hash: parsed.tokenHash,
              type: parsed.type,
            })
          : await supabase!.auth.exchangeCodeForSession(parsed.code);

    setBusy(false);
    if (error) {
      /*
       * The one failure worth rewriting. An exchange fails when this browser
       * does not hold the verifier it stored when the email was requested —
       * i.e. the link was opened somewhere else. Supabase says
       * "code verifier should be non-empty", which tells the user nothing about
       * what to do next.
       */
      const missingVerifier =
        parsed.kind === 'exchange' && /verifier/i.test(error.message);
      setError(
        missingVerifier
          ? 'That link was opened in a different browser to the one that requested it, so this browser cannot complete it. Request a new code here and paste the link without clicking it.'
          : error.message,
      );
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
              We email you a six-digit code, or a sign-in link — either works. No password to
              remember or lose. New here? Entering your email creates your account, there is no
              separate sign-up.
            </div>
          </div>
          <button className="btn primary" type="submit" disabled={busy || !email.trim()}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <div className="field">
            <label htmlFor="code">Code or sign-in link</label>
            <input
              id="code"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby="code-help"
            />
            <div className="help" id="code-help">
              Sent to {email.trim()}. Enter the six-digit code if the email has one. If it has a
              button or link instead, <b>copy the link and paste it here rather than clicking it</b>
              {' '}— clicking spends the token on a redirect that may go nowhere, and it only works
              once. Already clicked and landed on a page that would not load? Paste{' '}
              <b>that</b> address here instead — it still works. Check spam if nothing has arrived.
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
