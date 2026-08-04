/**
 * The cookie that carries a wording between the action and the page (HAD-118).
 *
 * ## Why a cookie at all
 *
 * The button is a plain form posting to a server action, so it works with
 * JavaScript disabled — the progressive-enhancement requirement. Without JS
 * there is no client to hand an action's return value to: the action's only
 * ways to reach the next render are the URL or a cookie, and several
 * paragraphs of prose do not belong in a URL. So the action stores the
 * outcome here and redirects back to `/report`, and the page reads it.
 *
 * Short-lived and digest-stamped: the digest is of the figures the wording was
 * generated from, and the page refuses to render words about numbers that have
 * since changed. Stale prose over fresh figures would be exactly the
 * plausible-looking wrong answer this app exists to avoid.
 *
 * In its own file because a `'use server'` module may only export async
 * functions, and the page needs these synchronously.
 */

export const WORDING_COOKIE = 'report-wording';

/** Why there is no wording to show, in states the page can word honestly. */
export type WordingFailure = 'invalid' | 'unreachable';

export type WordingCookie =
  | { digest: string; text: string }
  | { digest: string; failure: WordingFailure };

/** Parses defensively — the value has been through the browser. */
export function parseWordingCookie(raw: string | undefined): WordingCookie | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.digest !== 'string') return null;
    if (typeof o.text === 'string') return { digest: o.digest, text: o.text };
    if (o.failure === 'invalid' || o.failure === 'unreachable') {
      return { digest: o.digest, failure: o.failure };
    }
    return null;
  } catch {
    return null;
  }
}
