import Link from 'next/link';
import { signUp } from '@/app/auth/actions';

export function SignUpForm({ configured }: { configured: boolean }) {
  if (!configured) {
    return <div className="card auth-message auth-warning"><b>▲ Sign-up is unavailable.</b> This deployment is not connected to Supabase.</div>;
  }
  return (
    <form action={signUp} className="auth-form">
      <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} aria-describedby="password-rules" required />
        <div className="help" id="password-rules">Use at least 8 characters.</div>
      </div>
      <div className="field"><label htmlFor="passwordConfirmation">Confirm password</label><input id="passwordConfirmation" name="passwordConfirmation" type="password" autoComplete="new-password" minLength={8} required /></div>
      <button className="btn primary" type="submit">Create account</button>
      <p className="help auth-help">Already have an account? <Link href="/sign-in">Sign in</Link>.</p>
    </form>
  );
}
