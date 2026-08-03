import Link from 'next/link';

import { Badge, Card, Empty, PageHead } from '@/components/ui';
import { getReadModel } from '@/lib/data/store';
import { IDLE_LIMIT_MS } from '@/lib/auth/idle';
import { formatDate } from '@/lib/engine/dates';
import { money } from '@/lib/format/money';

/**
 * You (workstream C, frame 26:52).
 *
 * Absorbs Profile and Settings. The frame's structure: your figures first —
 * because every number on the Answer screen derives from them — then sign-in,
 * then reminders, then your data.
 *
 * The two switched-off features say so in words. Passkeys are merged and
 * return 503 without two Edge Function secrets; reminders compute nightly and
 * send nothing without an email key. A control that silently fails is how a
 * built feature gets forgotten and rebuilt — and a reminder that silently
 * never arrives is worse than no reminder feature, in a place where an
 * uncleared cheque is a criminal matter (C-1 / C-2, HAD-112 / HAD-113).
 */
export default async function YouPage() {
  const m = await getReadModel();
  const p = m.profile;

  const figures: [string, string][] = [
    ['Employment start', formatDate(p.employmentStart)],
    ['Expected last day', formatDate(p.expectedLastDay)],
    ['Basic salary', money(p.basicSalary)],
    ['Gross salary', money(p.grossSalary)],
    ['Unpaid leave taken', `${p.unpaidLeaveDays} ${p.unpaidLeaveDays === 1 ? 'day' : 'days'}`],
    ['Unused leave owed', `${p.unusedLeaveDays} ${p.unusedLeaveDays === 1 ? 'day' : 'days'}`],
  ];

  return (
    <>
      <PageHead title="You" sub="Your figures, sign-in, reminders, your data." />

      {m.isSeedData && (
        <Empty>
          These are the reference figures, not yours. <Link href="/start">Six answers</Link>{' '}
          replace them.
        </Empty>
      )}

      <Card
        title="Your figures"
        sub="Every number on the Answer screen is calculated from these six"
      >
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              {figures.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row" className="rowhead">
                    {label}
                  </th>
                  <td className="r tnum">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="legend">
          <span className="key">
            Change any of them on{' '}
            <Link className="banner-link" href="/profile">
              your profile
            </Link>{' '}
            — every figure moves with them. The rest of the profile lives there too.
          </span>
        </div>
      </Card>

      <Card title="Sign in">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead payee">
                  Password
                  <span className="sub">Changed from inside the app, with your current one</span>
                </th>
                <td className="r">
                  <Link className="banner-link" href="/settings">
                    Change
                  </Link>
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead payee">
                  Passkeys
                  <span className="sub">
                    Built and switched off — this deployment has not set the two secrets it needs.
                    Until then, sign-in is email and password
                  </span>
                </th>
                <td className="r">
                  <Badge tone="neutral">Unavailable</Badge>
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead payee">
                  Lock when idle
                  <span className="sub">Signs you out rather than pretending to lock</span>
                </th>
                <td className="r tnum">After {IDLE_LIMIT_MS / 60_000} minutes</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/*
        * Warning-styled by way of the basis panel's own component styling —
        * this is the one place the app must not imply a safety net it does not
        * provide.
        */}
      <Card title="Reminders">
        <div
          style={{
            border: '1px solid color-mix(in oklab, var(--warning) 55%, transparent)',
            background: 'color-mix(in oklab, var(--warning) 14%, transparent)',
            borderRadius: 11,
            padding: '13px 15px',
          }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 650 }}>Computed nightly. Not sent.</div>
          <p style={{ margin: '3px 0 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-2)' }}>
            Your cheque and school-fee reminders are worked out every night, but email sending is
            not configured on this deployment, so nothing reaches you. Do not rely on them yet —
            the{' '}
            <Link className="banner-link" href="/calendar">
              calendar
            </Link>{' '}
            is the source of truth for what is due.
          </p>
        </div>
        <div className="legend">
          <span className="key">
            Timing and channels are set in{' '}
            <Link className="banner-link" href="/settings">
              settings
            </Link>
            .
          </span>
        </div>
      </Card>

      <Card title="Your data">
        <div className="tbl-wrap" tabIndex={0}>
          <table>
            <tbody>
              <tr>
                <th scope="row" className="rowhead payee">
                  Export everything
                  <span className="sub">Every figure, as JSON, in a file you keep</span>
                </th>
                <td className="r">
                  <Link className="banner-link" href="/settings/export">
                    Download
                  </Link>
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead payee">
                  Import
                  <span className="sub">From a previous export</span>
                </th>
                <td className="r">
                  <Link className="banner-link" href="/settings">
                    From a file
                  </Link>
                </td>
              </tr>
              <tr>
                <th scope="row" className="rowhead payee">
                  Erase everything
                  <span className="sub">
                    The erasure is verified afterwards, and the check is shown to you
                  </span>
                </th>
                <td className="r">
                  <Link
                    className="banner-link"
                    href="/settings"
                    style={{ color: 'var(--critical-ink)' }}
                  >
                    Delete
                  </Link>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
