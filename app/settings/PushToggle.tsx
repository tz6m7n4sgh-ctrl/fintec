'use client';

import { useEffect, useState } from 'react';
import { savePushSubscription } from './push-actions';
import {
  VAPID_PUBLIC_KEY,
  isPushConfigured,
  pushSupport,
  toStored,
  vapidKeyToBytes,
  type PushSupport,
} from '@/lib/settings/push';

/**
 * Enabling web push on this device (US-47 / US-44).
 *
 * Per-device, not per-account, and the copy says so — a subscription belongs to
 * one browser on one machine. Someone who enables it on their laptop and then
 * assumes their phone is covered has drawn exactly the wrong conclusion about
 * the channel that warns them about a cheque.
 *
 * The support check runs in an effect rather than at render because every input
 * to it — `navigator`, `window.matchMedia` — exists only in the browser, and
 * this component is server-rendered first. Rendering a button and then
 * discovering it cannot work would be the "looks live, does nothing" defect
 * again.
 */

export function PushToggle({ enabled }: { enabled: boolean }) {
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nav = window.navigator;
    setSupport(
      pushSupport({
        configured: isPushConfigured(),
        hasServiceWorker: 'serviceWorker' in nav,
        hasPushManager: 'PushManager' in window,
        hasNotification: 'Notification' in window,
        // iOS reports installed PWAs through a non-standard property; the
        // media query is what every other platform answers.
        standalone:
          window.matchMedia('(display-mode: standalone)').matches ||
          (nav as unknown as { standalone?: boolean }).standalone === true,
        isIos: /iPad|iPhone|iPod/.test(nav.userAgent),
      }),
    );
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        /*
         * "Denied" is a browser-level decision this app cannot undo, and a
         * retry button would just be refused again without a prompt. Naming
         * where to change it is the only useful thing to say.
         */
        setError(
          permission === 'denied'
            ? 'Your browser is blocking notifications for this site. Change it in the site settings — the padlock in the address bar — and try again.'
            : 'Notification permission was not granted, so nothing was changed.',
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        // Required by every engine: a subscription without it can be delivered
        // to by anyone holding the endpoint.
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToBytes(VAPID_PUBLIC_KEY),
      });

      const stored = toStored(sub);
      if (!stored) {
        setError('This browser returned an incomplete subscription, so nothing was saved.');
        return;
      }

      const result = await savePushSubscription(stored);
      if (!result.ok) {
        setError(result.error ?? 'Could not save the subscription.');
        return;
      }
      setOn(true);
    } catch (e) {
      setError(`Could not enable push: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      /*
       * Unsubscribed in the browser *and* cleared in the database. Doing only
       * the second leaves the browser holding a live subscription the app has
       * forgotten — and the push service would keep accepting sends to it.
       */
      if (sub) await sub.unsubscribe();
      const result = await savePushSubscription(null);
      if (!result.ok) {
        setError(result.error ?? 'Could not clear the subscription.');
        return;
      }
      setOn(false);
    } catch (e) {
      setError(`Could not turn push off: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Nothing until the browser has been asked. A button that renders and then
  // disappears is worse than one that arrives a frame late.
  if (support === null) return null;

  if (!support.ok) {
    return (
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 4 }}>
        <b>Push is not available here.</b> {support.reason}
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <div role="alert" style={{ color: 'var(--critical-ink)', marginBottom: 10, fontSize: 13 }}>
          <b>✕ {error}</b>
        </div>
      ) : null}

      {on ? (
        <>
          <p role="status" style={{ fontSize: 13, lineHeight: 1.55, marginTop: 0 }}>
            <b>✓ Push is on for this device.</b> Only this one — a subscription belongs to a single
            browser, so enable it again anywhere else you want reminders.
          </p>
          <button className="btn" type="button" onClick={disable} disabled={busy}>
            {busy ? 'Turning off…' : 'Turn off push on this device'}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, marginTop: 0 }}>
            Push is per device. Enabling it here covers this browser only, and it is best-effort —
            email remains the channel that is guaranteed to reach you.
          </p>
          <button className="btn" type="button" onClick={enable} disabled={busy}>
            {busy ? 'Asking…' : 'Enable push on this device'}
          </button>
        </>
      )}
    </div>
  );
}
