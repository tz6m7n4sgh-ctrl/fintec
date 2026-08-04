import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getReadModel } from '@/lib/data/store';
import { DOORWAY_COOKIE, isDoorway } from '@/lib/onboarding/doorway';

export const metadata: Metadata = {
  title: 'Readiness — know what happens if your job ends',
  description: 'Six questions, then a clear figure for your UAE termination readiness.',
};

/**
 * The public home is an introduction, not a financial screen (HAD-129).
 *
 * Signed-in people continue to the one Answer home at `/entitlement`. A new
 * account without enough information still follows the HAD-122 first-run
 * intercept. Most importantly, a signed-out visitor receives no seed figures
 * from this route: the reference data is available only through the explicit
 * worked-example link below.
 */
export default async function HomePage() {
  const model = await getReadModel();

  if (model.user) {
    const jar = await cookies();
    if (model.isSeedData && !isDoorway(jar.get(DOORWAY_COOKIE)?.value)) redirect('/start');
    redirect('/entitlement');
  }

  return (
    <div className="public-home">
      <header className="public-home-head">
        <Link className="brand" href="/" aria-label="Readiness home">
          <span className="brand-mark" aria-hidden>₯</span>
          <span className="brand-name">Readiness</span>
        </Link>
        <Link className="public-sign-in" href="/sign-in" prefetch={false}>Sign in</Link>
      </header>

      <section className="public-home-hero" aria-labelledby="welcome-title">
        <p className="public-eyebrow">Plan for what comes next</p>
        <h1 id="welcome-title">
          If your job ends, what are you owed — and how long will your money last?
        </h1>
        <p className="public-lede">
          See your settlement, monthly runway, upcoming payments and deadlines in one clear answer.
        </p>
        <Link className="btn primary public-start" href="/start" prefetch={false}>
          Start — six questions, then a figure
        </Link>
        <p className="public-trust">
          No email verification. Your figures show their arithmetic.
        </p>
      </section>

      <Link className="public-example" href="/example" prefetch={false}>
        <span className="public-example-mark" aria-hidden>◒</span>
        <span>
          <b>Prefer to look around first?</b>
          <span>See the worked example</span>
        </span>
        <span className="public-example-arrow" aria-hidden>→</span>
      </Link>
    </div>
  );
}
