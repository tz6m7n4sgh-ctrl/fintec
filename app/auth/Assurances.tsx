import { Card } from '@/components/ui';

/**
 * The three claims a user should be able to check before typing real salary,
 * savings and debt figures into someone else's software.
 *
 * On both auth screens rather than only one. Signing up is the moment the
 * decision is actually made, and signing in is the moment it is renewed on a
 * new device — neither is the wrong place to answer "what stops this leaking".
 */
export function Assurances() {
  return (
    <Card title="What protects your data" sub="Worth knowing before you put real figures in">
      <ul className="insights">
        <li>
          <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>1</span>
          <span>
            Every table has <b>row-level security enabled and forced</b>, with policies keyed to
            your user id. A query for someone else&rsquo;s rows returns nothing — the database
            refuses it, not the UI.
          </span>
        </li>
        <li>
          <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>2</span>
          <span>
            Statement files live in a <b>private bucket</b> namespaced to your user id. There is no
            public URL to guess.
          </span>
        </li>
        <li>
          <span className="ic" style={{ color: 'var(--s1-ink)' }} aria-hidden>3</span>
          <span>
            No financial data is kept in <b>localStorage</b>. The session cookie is the only thing
            stored in your browser.
          </span>
        </li>
      </ul>
    </Card>
  );
}

/**
 * Shown in place of the form when no Supabase project is reachable.
 *
 * The app is required to render without a backend — the whole e2e suite runs
 * that way, against the §11 seed — so a missing project has to degrade to "you
 * cannot sign in" rather than crash a screen showing someone their termination
 * deadlines.
 */
export function NotConfigured() {
  return (
    <div
      className="card"
      style={{ borderColor: 'color-mix(in oklab, var(--warning) 40%, transparent)' }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.55 }}>
        <b>▲ Sign-in is not configured.</b> This deployment has no Supabase URL or publishable key
        set, so there is nothing to sign in to. The app still renders the reference dataset.
      </div>
    </div>
  );
}
