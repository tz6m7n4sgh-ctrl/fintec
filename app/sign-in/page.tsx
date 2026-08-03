import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { getUser } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { Assurances, NotConfigured } from '@/app/auth/Assurances';
import { CredentialsForm } from '@/app/auth/CredentialsForm';
import { PasskeySignIn } from '@/app/auth/PasskeySignIn';

export const metadata = { title: 'Sign in — Readiness' };

/**
 * Email and password, for an account that already exists.
 *
 * Signing up is a separate screen rather than the same form with a second
 * button. The two actions have different consequences — one reads an existing
 * account, the other creates one and commits the user to a password with no
 * reset path — and a single form that quietly does whichever applies hides that
 * difference at exactly the wrong moment.
 *
 * There is no Suspense boundary here any more. The old form read an `?error=`
 * left behind by a failed magic-link click, which needed `useSearchParams` and
 * therefore a boundary. Errors now come back from the server action itself.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ idle?: string }>;
}) {
  // Already signed in: nothing to do here.
  const user = await getUser();
  if (user) redirect('/settings');

  const configured = isSupabaseConfigured();
  // Set by `signOutIdle` (US-41). Without it the session appears to have
  // vanished for no reason, which reads as a bug rather than as the feature
  // the user was told about.
  const endedByIdle = (await searchParams).idle === '1';

  return (
    <>
      <PageHead title="Sign in" sub="Email and password" />

      {endedByIdle ? (
        <Card title="Your session ended after 15 minutes idle">
          <p role="status" style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4, marginBottom: 0 }}>
            This device was left alone, so the session was closed rather than left open on a
            screen of your salary and bank figures. <b>Your other devices are still signed in</b> —
            walking away from one says nothing about the rest. Sign in again below.
          </p>
        </Card>
      ) : null}

      <Card title="Sign in to see your own figures">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
          Signed out, this app shows the reference dataset — real numbers in shape, but not yours.
          Signing in is what lets it read and write your own.
        </p>
        {configured ? (
          <>
            {/*
              Above the form, because a user with a passkey should not have to
              scroll past a password box to find the thing that replaces it —
              and below the heading, because a user without one must not read
              the screen as "passkey required". It renders nothing at all until
              the browser has confirmed it supports WebAuthn.
            */}
            <PasskeySignIn />
            <CredentialsForm mode="signin" />
          </>
        ) : (
          <NotConfigured />
        )}
      </Card>

      {configured && (
        <Card title="No account yet?" sub="It takes one screen and no email">
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
            Creating an account needs an email address and a password, and nothing else. Nothing is
            sent to the address — no confirmation, no code, no link to click. You are signed in as
            soon as the account exists.
          </p>
          <Link
            className="btn primary"
            href="/sign-up"
            prefetch={false}
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Create an account
          </Link>
        </Card>
      )}

      <Assurances />
    </>
  );
}
