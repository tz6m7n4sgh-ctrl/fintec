import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { redirect } from 'next/navigation';

export default async function StartPage() {
  const m = await getReadModel();

  // Once real figures exist, Home is the useful starting point. This also
  // prevents a saved user from accidentally re-entering first run via /start.
  if (!m.isSeedData) redirect('/');

  return (
    <>
      <PageHead
        title="Start"
        sub="Begin with your situation, not somebody else’s finances."
      />

      <Card title="What brings you here?" sub="Choose the description that fits today.">
        <div className="grid g3" style={{ marginTop: 12 }}>
          <StartChoice
            title="I’ve been terminated"
            detail="Use your confirmed last working day."
            href={m.user ? '/profile' : '/sign-up'}
          />
          <StartChoice
            title="I’m expecting termination"
            detail="Estimate what you would receive for a likely date."
            href={m.user ? '/profile' : '/sign-up'}
          />
          <StartChoice
            title="I’m planning ahead"
            detail="See what you would receive if you left on a date you choose."
            href={m.user ? '/profile' : '/sign-up'}
          />
        </div>
      </Card>

      <p style={{ color: 'var(--ink-2)', fontSize: 13, marginTop: 14 }}>
        {m.user ? (
          <>You’re signed in. Add your six essential details to calculate your first answer.</>
        ) : (
          <>
            Already have an account?{' '}
            <Link href="/sign-in" prefetch={false}>Sign in</Link>.
          </>
        )}
      </p>
    </>
  );
}

function StartChoice({ title, detail, href }: { title: string; detail: string; href: string }) {
  return (
    <Link href={href} prefetch={false} className="card" style={{ textDecoration: 'none' }}>
      <strong>{title}</strong>
      <span style={{ display: 'block', color: 'var(--ink-2)', fontSize: 13, marginTop: 6 }}>
        {detail}
      </span>
    </Link>
  );
}
