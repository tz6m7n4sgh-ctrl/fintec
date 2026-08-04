'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getReadModel } from '@/lib/data/store';
import { isAiWordingConfigured, requestAnswer } from '@/lib/ai/anthropic';
import { buildAskInput, isNoAnswer, validateAnswer, NO_ANSWER } from '@/lib/ai/ask';
import { ASK_COOKIE, type AskCookie } from './ask-cookie';

/**
 * "Ask about your figures" (HAD-119).
 *
 * The action builds the fact sheet — every fact carrying the route of the
 * screen that proves it — asks the model the user's question, and accepts the
 * reply only if it passes both structural rules: no number that is not on the
 * sheet, and at least one known screen cited. A reply that fails either is
 * replaced by an honest refusal; nothing unproven reaches the page.
 */
export async function askAboutFigures(form: FormData): Promise<void> {
  if (!isAiWordingConfigured()) redirect('/entitlement');

  const question = String(form.get('question') ?? '').trim().slice(0, 500);
  if (!question) redirect('/entitlement');

  const m = await getReadModel();
  const input = buildAskInput(m);

  let outcome: AskCookie;
  try {
    const text = await requestAnswer(input, question);
    const verdict = validateAnswer(text, input);
    if (!verdict.ok) {
      /*
       * Logged server-side so a recurring offender is visible; never rendered,
       * for the same reason the report never renders a rejected wording.
       */
      console.warn(`Ask answer rejected (${verdict.reason}): ${verdict.offending.join(', ')}`);
      outcome = { question, failure: verdict.reason === 'numbers' ? 'invalid' : 'unproven' };
    } else if (text.length > 2500) {
      // Past cookie-safe size the answer would silently vanish in the browser.
      outcome = { question, failure: 'invalid' };
    } else {
      outcome = { question, text: isNoAnswer(text) ? NO_ANSWER : text };
    }
  } catch {
    outcome = { question, failure: 'unreachable' };
  }

  const jar = await cookies();
  jar.set(ASK_COOKIE, JSON.stringify(outcome), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 10,
  });

  // Outside the try/catch on purpose — redirect() signals by throwing.
  redirect('/entitlement');
}
