import { Card, PageHead } from '@/components/ui';
import { getReadModel, isSupabaseConfigured } from '@/lib/data/store';

export default async function SettingsPage() {
  const m = await getReadModel();
  const configured = isSupabaseConfigured();

  return (
    <>
      <PageHead title="Settings" sub="Sign-in devices, alerts and your data" />

      <Card title="Backend" sub="Where your data lives">
        <div className="tbl-wrap">
          <table>
            <tbody>
              <tr>
                <td>Supabase project</td>
                <td className="r">
                  {configured
                    ? <span className="pill ok"><span aria-hidden>✓</span> Configured</span>
                    : <span className="pill cheque"><span aria-hidden>✕</span> Not configured</span>}
                </td>
              </tr>
              <tr>
                <td>Database schema &amp; row-level security</td>
                <td className="r"><span className="pill ok"><span aria-hidden>✓</span> Applied</span></td>
              </tr>
              <tr>
                <td>Private statements bucket</td>
                <td className="r"><span className="pill ok"><span aria-hidden>✓</span> Created</span></td>
              </tr>
              <tr>
                <td>Reading live data</td>
                <td className="r">
                  {m.isSeedData
                    ? <span className="pill risk"><span aria-hidden>▲</span> Seed data</span>
                    : <span className="pill ok"><span aria-hidden>✓</span> Live</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Passkeys — biometric sign-in" sub="Fingerprint or Face ID via WebAuthn">
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          No passkeys registered yet. Sign-in is the next build step; email or one-time-code
          sign-in always remains available as a recovery path, so a passkey is never the only
          way in.
        </p>
        <button className="btn" disabled>Register this device</button>
      </Card>

      <Card title="Notifications" sub="Reminders 7 and 2 days before each cheque and school fee">
        <div className="tbl-wrap">
          <table>
            <tbody>
              <tr>
                <td>Email</td>
                <td className="r"><input type="checkbox" defaultChecked disabled aria-label="Email reminders" /></td>
              </tr>
              <tr>
                <td>
                  Web push
                  <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)' }}>
                    Requires installing the app on iOS
                  </span>
                </td>
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
          <button className="btn" disabled style={{ borderColor: 'color-mix(in oklab, var(--critical) 45%, transparent)', color: 'var(--critical)' }}>
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
