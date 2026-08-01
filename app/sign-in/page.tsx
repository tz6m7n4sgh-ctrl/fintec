import { redirect } from 'next/navigation';
import { Card, PageHead } from '@/components/ui';
import { getUser } from '@/lib/supabase/server';
import { SignInForm } from './SignInForm';

export const metadata = { title: 'Sign in — Readiness' };

export default async function SignInPage() {
  // Already signed in: nothing to do here.
  const user = await getUser();
  if (user) redirect('/settings');

  return (
    <>
      <PageHead title="Sign in" sub="Email and a one-time code" />

      <Card title="Sign in to see your own figures">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
          Signed out, this app shows the reference dataset — real numbers in shape, but not yours.
          Signing in is what lets it read and write your own.
        </p>
        <SignInForm />
      </Card>

      <Card title="What protects your data" sub="Worth knowing before you put real figures in">
        <ul className="insights">
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>1</span>
            <span>
              Every table has <b>row-level security enabled and forced</b>, with policies keyed to
              your user id. A query for someone else&rsquo;s rows returns nothing — the database
              refuses it, not the UI.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>2</span>
            <span>
              Statement files live in a <b>private bucket</b> namespaced to your user id. There is no
              public URL to guess.
            </span>
          </li>
          <li>
            <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>3</span>
            <span>
              No financial data is kept in <b>localStorage</b>. The session cookie is the only thing
              stored in your browser.
            </span>
          </li>
        </ul>
      </Card>
    </>
  );
}
