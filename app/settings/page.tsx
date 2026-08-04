import Link from 'next/link';
import { Card, PageHead } from '@/components/ui';
import { ChangePassword } from './ChangePassword';
import { EraseData } from './EraseData';
import { ImportBackup } from './ImportBackup';
import { NotificationPrefsEditor } from './NotificationPrefs';
import { Passkeys } from './Passkeys';
import { PushToggle } from './PushToggle';
import { isPushConfigured } from '@/lib/settings/push';
import { RemindersPreview } from './RemindersPreview';
import { todayInDubai } from '@/lib/engine/dates';
import { signOut } from '@/app/auth/actions';
import { getReadModel } from '@/lib/data/store';
import { isSupabaseConfigured, supabaseProjectHost } from '@/lib/supabase/config';

export default async function SettingsPage() {
  const m = await getReadModel();
  const configured = isSupabaseConfigured();
  const projectHost = supabaseProjectHost();
  const pushConfigured = isPushConfigured();

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
                    <td className="r tnum">{m.user.email ?? m.user.id}</td>
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
            {/*
              Documented where the other session control lives, because the two
              differ in exactly the way that matters: the button above is
              deliberately global, the idle timer deliberately is not.
            */}
            <div className="legend">
              <span className="key">
                <b>This device signs itself out after 15 minutes idle</b> (US-41), with a warning a
                minute before. It ends the session rather than drawing a lock screen — an overlay
                over figures already on the page is removable from devtools, and the cookie behind
                it would still work. Only this device: your others are unaffected.
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
                <th scope="row" className="rowhead">
                  Supabase project
                  {/*
                    This row used to read a *second* isSupabaseConfigured() that
                    checked process.env while sign-in used committed defaults.
                    They could therefore give opposite answers (HAD-75). Both
                    this identity and every client now use the single config
                    module, without a fallback.
                  */}
                  {projectHost ? (
                    <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                      {projectHost}
                    </span>
                  ) : null}
                </th>
                <td className="r">
                  {!configured ? (
                    <span className="pill cheque"><span aria-hidden>✕</span> Not configured</span>
                  ) : (
                    <span className="pill ok"><span aria-hidden>✓</span> Configured</span>
                  )}
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
        {!configured ? (
          <div className="legend">
            <span className="key">
              <b>This deployment has no backend.</b> Set both{' '}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
              <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to use a Supabase project.
              Leaving them unset is the safe choice for preview deployments.
            </span>
          </div>
        ) : null}
      </Card>

      <Card title="Passwords" sub="How you get in, and what happens if you lose it">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
          Sign-in is email and password, completed entirely in the app. Nothing is emailed —
          no code, no confirmation link, and <b>no reset link</b>.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          That is the trade for a flow that never depends on a mailbox, an SMTP provider or a
          redirect allow-list. You can change your password here, and a passkey now lets you{' '}
          <b>sign in</b> without typing one.
        </p>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          A <b>forgotten</b> password is still a different problem, and worth being exact about: a
          passkey gets you back into the app, but changing a password here requires typing the
          current one, because a session alone must not be enough to lock the real owner out. So a
          password you cannot remember still requires help from the person who operates this app.
          The passkey means you are not locked out meanwhile.
        </p>

        {m.isSeedData ? (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 0 }}>
            <b>Sign in to change your password.</b> There is no account here to change one for.
          </p>
        ) : (
          <ChangePassword />
        )}
      </Card>

      <Card title="Passkeys — biometric sign-in" sub="Fingerprint or Face ID via WebAuthn">
        {m.isSeedData ? (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
            <b>Sign in to add a passkey.</b> A passkey is registered against an account, and there
            is no account here to register one against.
          </p>
        ) : (
          <Passkeys />
        )}
      </Card>

      <Card
        title="Notifications"
        sub={`Reminders ${m.notificationPrefs.leadDays.join(' and ')} days before each cheque and school fee`}
      >
        {m.isSeedData ? (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
            <b>Sign in to set your reminders.</b> These are stored per account, and there is no
            account here to store them against.
          </p>
        ) : (
          <>
            <NotificationPrefsEditor prefs={m.notificationPrefs} />

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

            <h3 style={{ fontSize: 13.5, margin: '0 0 6px' }}>Web push on this device</h3>
            <PushToggle enabled={m.notificationPrefs.pushEnabled} />
          </>
        )}

        {/*
          Outside the editor deliberately. This is a property of the app, not of
          a session — somebody deciding whether to sign up is exactly who should
          be able to read it, and it was invisible to them while it lived inside
          the signed-in form.
        */}
        <div className="legend">
          <span className="key">
            <b>Email cannot be turned off.</b> Push depends on a browser permission, a live
            subscription and — on iOS — the app being installed, so it is best-effort by
            construction. If email could be switched off too, this app would be able to reach a
            state where a cheque falls due and nothing is obliged to tell you.
          </span>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

        {/*
          Said plainly, in the same place the settings are, rather than left for
          someone to discover by not receiving a reminder.

          The schedule below is real and computed; what does not exist is a
          sender. That distinction matters enough to draw: this app has twice
          shipped a control that looked live and did nothing, and a
          notifications panel is the worst possible place for a third.
        */}
        <h3 style={{ fontSize: 13.5, margin: '0 0 6px' }}>Nothing is sent yet</h3>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
          The reminder schedule below is real — it is computed from your cheques and school fees
          and it is what would go out. <b>No email or push is delivered</b>, because sending needs
          an email provider and web-push keys this deployment does not have (HAD-13). Until it
          does, this screen and the payment calendar are the channel, and they are the honest
          ones: they cannot claim to have told you something they did not.
        </p>
      </Card>

      <RemindersPreview reminders={m.reminders} today={todayInDubai()} />

      <Card title="Reminder delivery" sub="What is missing before anything can be sent">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead">
                  Reminder schedule
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Which reminders, on which day, in Asia/Dubai
                  </span>
                </th>
                <td className="r"><span className="pill ok"><span aria-hidden>✓</span> Built</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Send-once guarantee
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Per occurrence, per channel, per lead time — migration 0011
                  </span>
                </th>
                <td className="r"><span className="pill ok"><span aria-hidden>✓</span> Built</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Email provider
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Needs an API key this project deliberately does not hold
                  </span>
                </th>
                <td className="r"><span className="pill cheque"><span aria-hidden>✕</span> Not configured</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Service worker
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Registered on every page; carries the push handler
                  </span>
                </th>
                <td className="r"><span className="pill ok"><span aria-hidden>✓</span> Built</span></td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Web-push key
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    VAPID pair — public half in <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>, private half in Supabase
                  </span>
                </th>
                <td className="r">
                  {pushConfigured
                    ? <span className="pill ok"><span aria-hidden>✓</span> Configured</span>
                    : <span className="pill cheque"><span aria-hidden>✕</span> Not configured</span>}
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead">
                  Scheduled job
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                    Something that runs once a day at Dubai midnight
                  </span>
                </th>
                <td className="r"><span className="pill cheque"><span aria-hidden>✕</span> Not configured</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Listed rather than summarised as &ldquo;coming soon&rdquo;, because the three missing
            rows are decisions rather than work — each one adds a secret or a third party to an
            app that currently has neither.
          </span>
        </div>
      </Card>

      <Card title="Your data" sub="Export, import, or erase everything">
        {m.isSeedData ? (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
            <b>Sign in to export or import.</b> These screens are showing the §11 reference
            dataset, which is not stored anywhere — exporting it would hand you a copy of the
            sample figures rather than your own.
          </p>
        ) : (
          <>
            {/*
              A plain `<a>`, not a button and not `next/link`. The download is a
              GET route handler (`export/route.ts`), so this works with
              JavaScript disabled and the browser names the file — which matters
              on the day the thing that is broken is this app. `next/link` would
              intercept the click and try to route to it.

              The trailing slash matches `trailingSlash: true`, and the base
              path is applied by hand because only `next/link` gets it for free.
              Under a sub-path deployment a bare href would 404, and an escape
              hatch that silently stops working is worse than not having one.
            */}
            <a
              className="btn"
              href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/settings/export/`}
              download
              style={{ display: 'inline-block', textDecoration: 'none' }}
            >
              Export all data (JSON)
            </a>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 10 }}>
              Every figure you have entered, in one file you can read. Your uploaded statement
              PDFs are <b>not</b> in it — those stay in storage.
            </p>

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

            <ImportBackup />
          </>
        )}

        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />

        {m.isSeedData ? (
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 0 }}>
            <b>Sign in to erase your data.</b> There is nothing to delete here — this is the §11
            reference dataset, which is not stored anywhere and reappears on every visit.
          </p>
        ) : (
          <EraseData />
        )}
      </Card>
    </>
  );
}
