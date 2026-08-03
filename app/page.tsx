import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getReadModel } from '@/lib/data/store';
import { DOORWAY_COOKIE, isDoorway } from '@/lib/onboarding/doorway';

/**
 * `/` is a door, not a screen (HAD-124).
 *
 * This used to be the dashboard — the readiness header, five stat tiles, the
 * projection and spending charts, scenarios, the largest obligations. Every
 * one of those now lives in the section that owns it: the tiles, charts and
 * money insights on `/money`, the score and checklist on `/plan`, scenarios on
 * `/report`, the nearest obligations on `/money`. The dashboard was the last
 * engine-shaped screen — a summary of the calculation rather than an answer to
 * a question — and retiring it is the point of workstream C, not a side
 * effect.
 *
 * Two destinations, decided by the same rule as HAD-122:
 *
 * - never been here (no doorway answered, nothing of your own) → the doorway
 * - anyone else → the Answer section, which is the screen with the figure
 *
 * A redirect rather than rendering the answer here, so the app has one URL per
 * screen and a bookmark names what it opens.
 */
export default async function HomePage() {
  const m = await getReadModel();
  const jar = await cookies();

  if (m.isSeedData && !isDoorway(jar.get(DOORWAY_COOKIE)?.value)) redirect('/start');
  redirect('/entitlement');
}
