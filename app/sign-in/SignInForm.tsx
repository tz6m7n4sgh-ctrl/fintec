import Link from 'next/link';
import { signIn } from '@/app/auth/actions';

export function SignInForm({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <div className="card auth-message auth-warning">
        <b>▲ Sign-in is unavailable.</b>{' '}
        This deployment has no Supabase URL or publishable key. You can still use the reference dataset.
      </div>
    );
  }

  return (
    <form action={signIn} className="auth-form">
      <div className="field">
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="btn primary" type="submit">Sign in</button>
      <p className="help auth-help">
        New here? <Link href="/sign-up">Create an account</Link>. Forgotten passwords can only be
        cleared by an administrator; this app does not send password-reset email.
      </p>
    </form>
  );
}
