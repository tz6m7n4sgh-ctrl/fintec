import Link from 'next/link';
import { redirect } from 'next/navigation';

import { PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { EntitlementAnswer } from '@/app/entitlement/EntitlementAnswer';

export const metadata = { title: 'Worked example — Readiness' };

/** The reference figures are a deliberate demo destination, never the home. */
export default async function ExamplePage() {
  const model = await getReadModel();
  if (model.user) redirect('/entitlement');

  return (
    <>
      <PageHead
        title="Worked example"
        sub="A demonstration of the answer using reference figures — none of these numbers are yours."
      />
      <div className="demo-note example-note">
        <b>Reference example.</b> Start with six questions for a personal answer, or sign in to
        return to your figures.
        <span className="example-actions">
          <Link href="/start" prefetch={false}>Start my answer</Link>
          <Link href="/sign-in" prefetch={false}>Sign in</Link>
        </span>
      </div>
      <EntitlementAnswer profile={model.profile} payments={model.payments} />
    </>
  );
}
