'use client';

import { useActionState } from 'react';
import { PREFS_INITIAL, saveNotificationPrefs } from './notification-actions';
import { LEAD_DAY_CHOICES, type NotificationPrefs as Prefs } from '@/lib/settings/notifications';

/**
 * Notification preferences (US-44).
 *
 * Email has no switch. It is not a disabled checkbox either — a greyed-out
 * control invites "why can't I?", and a sentence answers it. Push is
 * best-effort by construction (browser permission, live subscription, an
 * installed PWA on iOS), so if email could also be off the app would be able to
 * reach a state where a AED 45,000 cheque falls due and nothing anywhere is
 * obliged to say so.
 */

export function NotificationPrefsEditor({ prefs }: { prefs: Prefs }) {
  const [state, action, pending] = useActionState(saveNotificationPrefs, PREFS_INITIAL);
  const current = state.saved ?? prefs;

  return (
    <form action={action}>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
        <legend style={{ fontSize: 13, fontWeight: 600, padding: 0 }}>
          How far ahead to remind you
        </legend>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
          {LEAD_DAY_CHOICES.map((d) => (
            <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                name="leadDays"
                value={d}
                defaultChecked={current.leadDays.includes(d)}
              />
              {d} day{d === 1 ? '' : 's'}
            </label>
          ))}
        </div>
        <span className="help" style={{ display: 'block', marginTop: 6 }}>
          The payment calendar draws a funding marker on each of these, so changing them
          changes that screen too.
        </span>
      </fieldset>

      {/*
        No push control here. Push is enabled per *device*, by subscribing this
        browser — see `PushToggle`. A checkbox in an account-level form would
        set `push_enabled` with no subscription behind it, which is an app that
        believes it can reach somebody it cannot, on the channel that warns
        about bounced cheques. This form owns lead times.
      */}
      <div className="tbl-wrap" tabIndex={0}>
        <table>
          <tbody>
            <tr>
              <th scope="row" className="rowhead">
                Email
                <span className="sub" style={{ display: 'block', fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 400 }}>
                  Always on — see below
                </span>
              </th>
              <td className="r"><span className="pill ok"><span aria-hidden>✓</span> On</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {state.error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', margin: '12px 0', fontSize: 13 }}>
          <b>✕ {state.error}</b>
        </div>
      ) : null}
      {state.ok ? (
        <div role="status" style={{ margin: '12px 0', fontSize: 13 }}>
          <b>✓ Saved.</b> Reminders at {current.leadDays.join(', ')} day
          {current.leadDays.length === 1 && current.leadDays[0] === 1 ? '' : 's'} before each due date.
        </div>
      ) : null}

      <button className="btn" type="submit" disabled={pending} style={{ marginTop: 12 }}>
        {pending ? 'Saving…' : 'Save reminder settings'}
      </button>
    </form>
  );
}
