'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signOutIdle } from '@/app/auth/actions';
import {
  ACTIVITY_EVENTS,
  IDLE_STORAGE_KEY,
  WARN_BEFORE_MS,
  idleStatus,
  secondsLeft,
  type IdleState,
} from '@/lib/auth/idle';

/**
 * Idle auto-lock (US-41 / FR-K3).
 *
 * Rendered only when signed in — there is nothing to lock behind the §11
 * reference dataset, and a countdown over sample figures would be theatre.
 *
 * The timer is shared across tabs through `localStorage`. Without that, reading
 * the calendar in one tab would not stop another tab's timer, and the session
 * would end underneath a user who never stopped using the app.
 */

export function IdleLock() {
  const [state, setState] = useState<IdleState>('active');
  const [remaining, setRemaining] = useState(WARN_BEFORE_MS);
  // Prevents a second sign-out being fired while the first is in flight.
  const endingRef = useRef(false);

  const markActive = useCallback(() => {
    const now = Date.now();
    try {
      window.localStorage.setItem(IDLE_STORAGE_KEY, String(now));
    } catch {
      /*
       * Private mode, or storage disabled. The timer still works — it just
       * stops being shared between tabs, which degrades to per-tab locking
       * rather than to no locking at all. Silent because a console error here
       * would fail the e2e suite for a browser setting the user chose.
       */
    }
    setState('active');
  }, []);

  useEffect(() => {
    markActive();

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const tick = window.setInterval(() => {
      let last = 0;
      try {
        last = Number(window.localStorage.getItem(IDLE_STORAGE_KEY) ?? 0);
      } catch {
        last = 0;
      }
      // No stored timestamp at all (storage blocked) means this tab cannot
      // measure idleness, and guessing would sign somebody out at random.
      if (!last) return;

      const status = idleStatus(last, Date.now());
      setState(status.state);
      setRemaining(status.remainingMs);

      if (status.state === 'expired' && !endingRef.current) {
        endingRef.current = true;
        void signOutIdle();
      }
    }, 1000);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
      window.clearInterval(tick);
    };
  }, [markActive]);

  if (state !== 'warning') return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="idle-title"
      style={{
        position: 'fixed',
        insetInlineStart: 16,
        insetBlockEnd: 16,
        zIndex: 60,
        maxWidth: 380,
      }}
    >
      <div className="card" style={{ borderColor: 'var(--critical-ink)' }}>
        <h2 id="idle-title" style={{ fontSize: 15, marginTop: 0, color: 'var(--critical-ink)' }}>
          Signing you out in {secondsLeft(remaining)}s
        </h2>
        {/*
          Says what will actually happen, including the part that costs
          something. "Locking" would imply the session survives; it does not,
          and an unsaved form really is lost.
        */}
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', marginTop: 0 }}>
          This device has been idle for 15 minutes, so the session is ending. Anything you have
          typed and not saved will be lost. Your other devices stay signed in.
        </p>
        <button className="btn primary" type="button" onClick={markActive}>
          I&rsquo;m still here
        </button>
      </div>
    </div>
  );
}
