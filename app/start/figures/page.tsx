import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { UnverifiedBasis } from '@/components/Basis';
import { DOORWAY_COOKIE, isDoorway } from '@/lib/onboarding/doorway';
import { FiguresForm } from './FiguresForm';

export const metadata: Metadata = {
  title: 'Six things, then your figure',
  description: 'The six answers every termination figure is calculated from.',
};

/**
 * The six fields (P2-5, workstream B1).
 *
 * The doorway is read here only to decide how the page introduces itself. It
 * never reaches the calculation — one engine, one screen, three doorways.
 */
export default async function FiguresPage() {
  const jar = await cookies();
  const chosen = jar.get(DOORWAY_COOKIE)?.value;

  // Arriving here without a doorway means somebody deep-linked. Ask the
  // question rather than guessing an answer on their behalf.
  if (!isDoorway(chosen)) redirect('/start');

  const lede =
    chosen === 'happened'
      ? 'Straight from your MOHRE contract. We will work from the last day you have been given.'
      : chosen === 'coming'
        ? 'Straight from your MOHRE contract. Put in the date you are planning around — you can move it afterwards.'
        : 'Straight from your MOHRE contract. Use today as your last day to see where you stand right now.';

  return (
    <>
      <h1>Six things, then your figure</h1>
      <p className="lede">{lede} Leave anything blank and we will say what it costs you.</p>

      <FiguresForm />

      {/*
        * The basis sits with the form, not only with the answer.
        *
        * By the time somebody has a figure on screen they have already decided
        * what the app is for. Saying it here means the caveat arrives before
        * the number does, which is the only order in which it can change what
        * they do with it.
        */}
      <UnverifiedBasis />

      <p className="privacy-note">
        These six are the only inputs to the headline figure. Everything else the app knows about
        you — savings, debts, school fees — is asked for later, and only when it changes something.
      </p>
    </>
  );
}
