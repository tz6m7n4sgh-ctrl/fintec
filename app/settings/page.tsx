import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { signOut } from '@/app/auth/actions';
import { getReadModel, isSupabaseConfigured } from '@/lib/data/store';

export default async function SettingsPage() {
  const m = await getReadModel();
  const configured = isSupabaseConfigured();

  return (
    <>
      <PageHead title="Settings" sub="Sign-in devices, alerts and your data" />

      <Card title="Account" sub="Who this session belongs to">
        {m.user ? (
          <>
            <div className="tbl-wrap" tabIndex={0}>
              <table>
                <tbody>
                  <tr>
                    <th scope="row" className="rowhead">Signed in as</th>
                    <td className="r mono">{m.user.email ?? m.user.id}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <form action={signOut} style={{ marginTop: 12 }}>
              <button className="btn" type="submit">Sign out everywhere</button>
            </form>
            <div className="legend">
              <span className="key">
                Signs out of every device, not just this one — it revokes the refresh tokens
                rather than only clearing this browser&rsquo;s cookie.
              </span>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
              Not signed in, so these screens show the reference dataset rather than your own
              figures.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link className="btn primary" href="/sign-in" prefetch={false} style={{ display: 'inline-block', textDecoration: 'none' }}>
                Sign in
              </Link>
              <Link className="btn" href="/sign-up" prefetch={false} style={{ display: 'inline-block', textDecoration: 'none' }}>
                Create an account
              </Link>
            </div>
          </>
        )}
      </Card>

      <Card title="Backend" sub="Where your data lives">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead">Supabase project</th>
                <td className="r">
                  {configured
                    ? <span className="pill ok"><span aria-hidden>✓</span> Configured</span>
                    : <span className="pill cheque"><span aria-hidden>✕</span> Not configured</span>}
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Database schema &amp; row-level security
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Defined in three migrations under <code>supabase/migrations</code>
                  </span>
                </th>
                <td className="r"><span className="pill"><span aria-hidden>○</span> Not checked from here</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Private statements bucket
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Defined in migration 0002
                  </span>
                </th>
                <td className="r"><span className="pill"><span aria-hidden>○</span> Not checked from here</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">Reading live data</th>
                <td className="r">
                  {m.isSeedData
                    ? <span className="pill risk"><span aria-hidden>▲</span> Seed data</span>
                    : <span className="pill ok"><span aria-hidden>✓</span> Live</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Nothing here queries your database to confirm the migrations ran — that would be a
            round trip on every render to answer a question that changes about once a year. Rather
            than show a tick it has not earned, these two rows say what they are and where they are
            defined. To check them yourself, run the RLS query in the README against your project.
          </span>
        </div>
      </Card>

      <Card title="Passwords" sub="How you get in, and what happens if you lose it">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
          Sign-in is email and password, completed entirely in the app. Nothing is emailed —
          no code, no confirmation link, and <b>no reset link</b>.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          That is the trade for a flow that never depends on a mailbox, an SMTP provider or a
          redirect allow-list. It also means a forgotten password can only be cleared from the
          Supabase dashboard, under Authentication → Users. Changing your password from inside the
          app is not built yet.
        </p>
        <button className="btn" disabled>Change password</button>
      </Card>

      <Card title="Passkeys — biometric sign-in" sub="Fingerprint or Face ID via WebAuthn">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          No passkeys registered yet. Email and password sign-in is live and always remains
          available as a recovery path, so a passkey is never the only way in (R-4).
        </p>
        <button className="btn" disabled>Register this device</button>
      </Card>

      <Card title="Notifications" sub="Reminders 7 and 2 days before each cheque and school fee">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead">Email</th>
                <td className="r"><input type="checkbox" defaultChecked disabled aria-label="Email reminders" /></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Web push
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>
                    Requires installing the app on iOS
                  </span>
                </th>
                <td className="r"><input type="checkbox" disabled aria-label="Web push reminders" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Email is the guaranteed channel; push is best-effort and depends on browser permission.
          </span>
        </div>
      </Card>

      <Card title="Your data" sub="Export, import, or erase everything">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <button className="btn" disabled>Export all data (JSON)</button>
          <button className="btn" disabled>Import from JSON</button>
          <button className="btn" disabled style={{ borderColor: 'color-mix(in oklab, var(--critical) 45%, transparent)', color: 'var(--critical-ink)' }}>
            Delete all data
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 12, marginBottom: 0 }}>
          Delete removes every row and every uploaded statement file from storage. It cannot be
          undone.
        </p>
      </Card>
    </>
  );
}
