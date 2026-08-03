'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { DOORWAY_COOKIE, isDoorway } from '@/lib/onboarding/doorway';
import { readSix, summariseProblems, type Problem } from '@/lib/onboarding/six';
import { createClient } from '@/lib/supabase/server';

/**
 * The first run's two steps (workstream B1).
 *
 * Built alongside the existing screens per OD-2 — `/start` goes up beside
 * `/profile` rather than replacing it, and the old route is retired when
 * workstream C removes the section it belongs to. Editing in place would leave
 * the app half-migrated for the length of the phase.
 */

export async function chooseDoorway(form: FormData): Promise<void> {
  const choice = String(form.get('doorway') ?? '');
  if (!isDoorway(choice)) redirect('/start');

  const jar = await cookies();
  jar.set(DOORWAY_COOKIE, choice, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect('/start/figures');
}

export interface FiguresResult {
  ok: boolean;
  /** Everything wrong with the submission, not merely the first thing. */
  problems?: Problem[];
  /** The line under the blocked submit. */
  summary?: string;
  /** A failure that is not the user's fault. */
  error?: string;
}

/**
 * Saves the six.
 *
 * Only these six columns are written. `upsert` updates what it is given, so an
 * existing profile keeps its other sixteen fields — the first run is not
 * allowed to quietly reset somebody's savings because it did not ask about
 * them.
 */
export async function saveFigures(_prev: FiguresResult, form: FormData): Promise<FiguresResult> {
  const get = (name: string) => String(form.get(name) ?? '');

  /*
   * Read before touching the network. Nothing is written until all six are
   * usable, so a half-answered form cannot leave a half-invented row behind.
   */
  const reading = readSix(get);
  if (!reading.ok) {
    return {
      ok: false,
      problems: reading.problems,
      summary: summariseProblems(reading.problems, get),
    };
  }

  const supabase = await createClient();
  if (!supabase) return { ok: false, error: 'Supabase is not configured for this deployment.' };

  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'You are signed out. Sign in again to save your answers.' };

  const v = reading.values;
  const { error } = await supabase.from('profiles').upsert(
    {
      user_id: user.id,
      employment_start: v.employmentStart,
      expected_last_day: v.expectedLastDay,
      basic_salary: v.basicSalary,
      gross_salary: v.grossSalary,
      unpaid_leave_days: v.unpaidLeaveDays,
      unused_leave_days: v.unusedLeaveDays,
    },
    { onConflict: 'user_id' },
  );

  if (error) return { ok: false, error: error.message };

  // Every screen computes from the profile, so every screen is now stale.
  revalidatePath('/', 'layout');

  /*
   * Six fields, then an answer — so this goes straight to the figure rather
   * than to a "saved successfully" screen nobody asked for.
   *
   * `/report` is the closest thing that exists today. Workstream B2 replaces it
   * with the date-driven Answer screen, and this redirect is the one line that
   * changes when it does.
   */
  redirect('/report');
}
