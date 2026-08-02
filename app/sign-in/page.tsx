import { redirect } from 'next/navigation';
import { Card, PageHead } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { getUser } from '@/lib/supabase/server';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in — Readiness' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getUser()) redirect('/settings');
  const { error } = await searchParams;

  return (
    <>
      <PageHead title="Sign in" sub="Email and password" />
      <Card title="Sign in to see your own figures">
        <p className="auth-intro">
          Signed out, this app shows the reference dataset — real numbers in shape, but not yours.
          Signing in lets it read and write your own.
        </p>
        {error === 'invalid' && (
          <div className="card auth-message auth-error" role="alert">
            <b>✕ Email or password is incorrect.</b>
          </div>
        )}
        <SignInForm configured={isSupabaseConfigured()} />
      </Card>
    </>
  );
}
