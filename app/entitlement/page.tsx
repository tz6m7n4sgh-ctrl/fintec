import Link from 'next/link';
import { cookies } from 'next/headers';
import { PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { isAiWordingConfigured } from '@/lib/ai/anthropic';
import { answerSegments, ASK_SCREENS } from '@/lib/ai/ask';
import { EntitlementAnswer } from './EntitlementAnswer';
import { askAboutFigures } from './actions';
import { ASK_COOKIE, parseAskCookie, type AskCookie } from './ask-cookie';

/**
 * The ask surface (HAD-119), rendered only when a key is configured and the
 * figures are the user's own — a stranger asking about the reference dataset
 * would get confident answers about nobody's finances.
 *
 * Every rendered answer keeps its bracketed citations as links to the screen
 * that proves the claim; the failure states are worded rather than blank so
 * the form never appears to simply do nothing.
 */
function AskCard({ outcome }: { outcome: AskCookie | null }) {
  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Ask about your figures</h2>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
        Answered only from the figures this app has computed, with a link to the screen that
        proves it. AI-worded; it never computes anything new, and it refuses rather than guesses.
      </p>
      {outcome && (
        <div style={{ margin: '10px 0', borderLeft: '3px solid var(--line)', paddingLeft: 12 }}>
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>You asked: {outcome.question}</p>
          {'text' in outcome ? (
            <p style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 6, marginBottom: 0 }}>
              {answerSegments(outcome.text).map((seg, i) =>
                seg.type === 'text' ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <Link key={i} href={seg.route} prefetch={false}>
                    {ASK_SCREENS[seg.route].name}
                  </Link>
                ),
              )}
            </p>
          ) : (
            <p style={{ fontSize: 13, lineHeight: 1.55, marginTop: 6, marginBottom: 0, color: 'var(--ink-2)' }}>
              {outcome.failure === 'unreachable'
                ? 'The answer service could not be reached. Every figure on this screen is computed locally and unaffected.'
                : outcome.failure === 'invalid'
                  ? 'The answer mentioned a number that is not in your figures, so it was discarded rather than shown.'
                  : 'The answer could not point at a screen that proves it, so it was discarded rather than shown.'}
            </p>
          )}
        </div>
      )}
      <form action={askAboutFigures} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <label htmlFor="ask-question" className="visually-hidden" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Your question
        </label>
        <input
          id="ask-question"
          name="question"
          type="text"
          required
          maxLength={500}
          placeholder="e.g. How much of my gratuity comes from the years after five?"
          style={{ flex: '1 1 260px' }}
        />
        <button className="btn primary" type="submit">Ask</button>
      </form>
    </section>
  );
}

export default async function EntitlementPage() {
  const model = await getReadModel();
  const askable = isAiWordingConfigured() && Boolean(model.user) && !model.isSeedData;
  const askOutcome = askable ? parseAskCookie((await cookies()).get(ASK_COOKIE)?.value) : null;

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
          {askable && <AskCard outcome={askOutcome} />}
        </>
      )}
    </>
  );
}

