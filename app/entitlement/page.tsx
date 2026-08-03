import Link from 'next/link';
import { PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { EntitlementAnswer } from './EntitlementAnswer';

export default async function EntitlementPage() {
  const model = await getReadModel();

  return (
    <>
      <PageHead title="Your entitlement" sub="Change one date. See the settlement and every deadline change with it." />
      {model.user && model.isSeedData ? (
        <section className="card answer-empty">
          <span aria-hidden>◇</span>
          <h2>There is no answer yet</h2>
          <p>We need your basic salary, gross salary, employment start and last working day before the engine can calculate anything. We have not filled these with example values.</p>
          <Link className="btn primary" href="/profile" prefetch={false}>Add your employment details</Link>
        </section>
      ) : (
        <>
          {model.isSeedData && <p className="demo-note"><b>Reference example.</b> These are demonstration figures, not yours. Sign in and add your details for a personal answer.</p>}
          <EntitlementAnswer profile={model.profile} payments={model.payments} />
        </>
      )}
    </>
  );
}

