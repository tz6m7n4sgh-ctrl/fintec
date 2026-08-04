/**
 * The cookie that carries an ask-anything outcome between the action and the
 * page (HAD-119). Same design as `app/report/wording-cookie.ts` and for the
 * same reason: the ask form is a plain POST that works without JavaScript, so
 * the outcome rides a short-lived httpOnly cookie through the redirect.
 *
 * No digest here — a wording describes the figures and goes stale with them,
 * but an answer is pinned to the question it answers, which the cookie also
 * carries so the page can show them together. The ten-minute lifetime does the
 * staleness work.
 */

export const ASK_COOKIE = 'entitlement-ask';

/** Why there is no answer to show, in states the page can word honestly. */
export type AskFailure = 'invalid' | 'unreachable' | 'unproven';

export type AskCookie =
  | { question: string; text: string }
  | { question: string; failure: AskFailure };

/** Parses defensively — the value has been through the browser. */
export function parseAskCookie(raw: string | undefined): AskCookie | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.question !== 'string') return null;
    if (typeof o.text === 'string') return { question: o.question, text: o.text };
    if (o.failure === 'invalid' || o.failure === 'unreachable' || o.failure === 'unproven') {
      return { question: o.question, failure: o.failure };
    }
    return null;
  } catch {
    return null;
  }
}
