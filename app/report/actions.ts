'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getReadModel } from '@/lib/data/store';
import { isAiWordingConfigured, requestWording } from '@/lib/ai/anthropic';
import { buildWordingInput, validateWording, wordingDigest } from '@/lib/ai/wording';
import { WORDING_COOKIE, type WordingCookie } from './wording-cookie';

/**
 * "Word this in plain language" (HAD-118).
 *
 * The action reads the same read model the page renders, hands the flattened
 * fact sheet to the model, and accepts the reply only if every number in it is
 * already in that fact sheet. A rejected or failed generation stores the
 * failure instead — the page words it honestly rather than showing nothing and
 * leaving the user to wonder whether the button worked.
 *
 * The outcome rides back in a short-lived cookie (see `wording-cookie.ts` for
 * why that is the no-JavaScript-safe channel) and the action redirects to the
 * report, which is the whole visible effect: the deterministic working is
 * untouched either way.
 */
export async function wordInPlainLanguage(): Promise<void> {
  // The button only renders when a key is configured; this guards the raw
  // POST endpoint the form still is.
  if (!isAiWordingConfigured()) redirect('/report');

  const m = await getReadModel();
  const input = buildWordingInput(m.profile, m.readiness, m.score);
  const digest = wordingDigest(input);

  let outcome: WordingCookie;
  try {
    const text = await requestWording(input);
    const verdict = validateWording(text, input);
    /*
     * One invented number discards the whole generation. Logged server-side so
     * a recurring offender is visible in ops, but the offending token is never
     * rendered — showing "the model said 91,479.47" would put the wrong number
     * on the screen after all.
     */
    if (!verdict.ok) {
      console.warn(`AI wording rejected: numbers not in the input: ${verdict.offending.join(', ')}`);
      outcome = { digest, failure: 'invalid' };
    } else if (text.length > 3000) {
      // Browsers silently drop cookies past ~4KB, which would look like the
      // button doing nothing. Treat oversize like any other unusable reply.
      outcome = { digest, failure: 'invalid' };
    } else {
      outcome = { digest, text };
    }
  } catch {
    outcome = { digest, failure: 'unreachable' };
  }

  const jar = await cookies();
  jar.set(WORDING_COOKIE, JSON.stringify(outcome), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Long enough to survive the redirect and a re-read, short enough that a
    // wording never outlives the sitting that asked for it.
    maxAge: 60 * 10,
  });

  // Outside the try/catch on purpose — redirect() signals by throwing.
  redirect('/report');
}
