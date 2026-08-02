import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, PageHead } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { getUser } from '@/lib/supabase/server';
import { SignUpForm } from './SignUpForm';

export const metadata = { title: 'Sign up — Readiness' };

const messages: Record<string, React.ReactNode> = {
  mismatch: <b>✕ The passwords do not match.</b>,
  invalid: <b>✕ Enter a valid email and a password of at least 8 characters.</b>,
  exists: <><b>✕ An account already exists for that email.</b> <Link href="/sign-in">Sign in instead</Link>.</>,
  failed: <b>✕ We could not create the account. Please try again.</b>,
  confirmation: <><b>✕ The account was not signed in.</b> In Supabase, turn off Authentication → Providers → Email → Confirm email, then try again.</>,
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUser()) redirect('/settings');
  const { error } = await searchParams;
  return <>
    <PageHead title="Sign up" sub="Create your account in the app" />
    <Card title="Create an account">
      <p className="auth-intro">No code or link will be sent. Your account is created and signed in here.</p>
      {error && messages[error] && <div className="card auth-message auth-error" role="alert">{messages[error]}</div>}
      <SignUpForm configured={isSupabaseConfigured()} />
    </Card>
  </>;
}
