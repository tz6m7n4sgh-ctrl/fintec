import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { getUser } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { Assurances, NotConfigured } from '@/app/auth/Assurances';
import { CredentialsForm } from '@/app/auth/CredentialsForm';

export const metadata = { title: 'Create an account — Readiness' };

/**
 * Account creation (US-39 / FR-K1).
 *
 * An email address and a password, verified against nothing, because nothing is
 * sent to the address. The account exists the moment the form is submitted and
 * the user lands on /profile — which is the only screen that does anything for
 * an account with no figures in it yet.
 *
 * The warning about there being no password reset is on this screen rather than
 * only in the field help, and it is stated before the form rather than after
 * it. It is the one consequence of this design a user cannot recover from on
 * their own, so it belongs where it is read, not where it is discovered.
 */
export default async function SignUpPage() {
  const user = await getUser();
  if (user) redirect('/settings');

  const configured = isSupabaseConfigured();

  return (
    <>
      <PageHead title="Create an account" sub="Email and password — nothing gets emailed to you" />

      <Card title="Your account" sub="One screen, no verification step">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
          Your figures are stored against this account and nobody else can read them. The address is
          the account&rsquo;s name and the way you sign back in — it is not used to send anything.
        </p>
        {configured ? <CredentialsForm mode="signup" /> : <NotConfigured />}
      </Card>

      {configured && (
        <Card title="Before you choose a password" sub="The one thing that cannot be undone here">
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
            This app sends no email at all — which also means there is <b>no password reset link</b>.
            If the password is lost and you do not have a passkey, contact the person who operates
            this app for help regaining access. Use a password manager, or write it down somewhere
            you trust.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            Already have an account?{' '}
            <Link href="/sign-in" prefetch={false}>
              Sign in instead
            </Link>
            .
          </p>
        </Card>
      )}

      <Assurances />
    </>
  );
}
