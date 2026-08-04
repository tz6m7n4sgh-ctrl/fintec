/**
 * The one place the Anthropic API is called (HAD-118).
 *
 * `server-only` makes the boundary structural: importing this from a client
 * component fails the build, so the key cannot reach the browser by accident —
 * the same discipline `scripts/secret-guard.mjs` enforces for the Supabase
 * secrets. `ANTHROPIC_API_KEY` has no `NEXT_PUBLIC_` twin and never will.
 *
 * Called with `fetch` directly rather than the SDK, per the ticket: one POST
 * to one endpoint does not justify a dependency this app has to audit.
 */

import 'server-only';

import { buildPrompt, type WordingInput } from './wording';

/**
 * No key, no feature. The report page renders exactly as today when this is
 * false — no button, no dead UI — which is also why this check lives here
 * beside the call rather than in the page: one definition of "configured", the
 * lesson of HAD-75.
 */
export function isAiWordingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Requests the wording. Throws on anything short of a complete, normal
 * response — the caller's fallback is the deterministic working, which is
 * always correct, so there is nothing to salvage from a partial or refused
 * generation.
 *
 * Model notes, so the choices here read as decisions rather than defaults:
 *
 * - `claude-sonnet-5`, per the ticket.
 * - `thinking: disabled` — this is rewording, not reasoning, and disabling it
 *   keeps the small `max_tokens` budget entirely for the prose (on this model
 *   thinking is otherwise on by default and spends from the same cap).
 * - No `temperature`: the ticket asks for low temperature, but claude-sonnet-5
 *   rejects non-default sampling parameters with a 400. Low variance comes
 *   from disabled thinking and the tightly constrained prompt instead — and
 *   the validator, not sampling, is what actually guarantees the numbers.
 * - `max_tokens` is small on purpose: four short paragraphs, and the result
 *   has to fit in a cookie to survive the no-JavaScript round trip.
 */
export async function requestWording(input: WordingInput): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');

  const { system, user } = buildPrompt(input);

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 600,
      thinking: { type: 'disabled' },
      system,
      messages: [{ role: 'user', content: user }],
    }),
    // A wording request is decoration on a page that works without it. Fail
    // fast rather than hold the form submission open.
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new Error(`Anthropic API returned ${res.status}.`);
  }

  const body: {
    stop_reason?: string;
    content?: { type: string; text?: string }[];
  } = await res.json();

  /*
   * Only a normally-completed turn is usable. `max_tokens` would mean prose cut
   * off mid-sentence — possibly mid-caveat — and `refusal` means there is no
   * prose at all. Both fall back to the deterministic working.
   */
  if (body.stop_reason !== 'end_turn') {
    throw new Error(`Generation did not complete normally (stop_reason: ${body.stop_reason ?? 'missing'}).`);
  }

  const text = (body.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n')
    .trim();

  if (!text) throw new Error('Generation contained no text.');
  return text;
}
