import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_EVENTS,
  IDLE_LIMIT_MS,
  WARN_BEFORE_MS,
  idleStatus,
  secondsLeft,
} from './idle';

/**
 * US-41. The boundaries are the whole test: an off-by-one either signs someone
 * out a minute early, or leaves the app open on a screen of salary figures for
 * a minute longer than it promised.
 */

const T0 = 1_000_000;
const at = (msSinceActivity: number) => idleStatus(T0, T0 + msSinceActivity);

describe('idleStatus', () => {
  it('is active immediately after activity', () => {
    expect(at(0)).toEqual({ state: 'active', remainingMs: IDLE_LIMIT_MS });
  });

  it('is still active one millisecond before the warning', () => {
    const justBefore = IDLE_LIMIT_MS - WARN_BEFORE_MS - 1;
    expect(at(justBefore).state).toBe('active');
  });

  it('warns exactly one minute before the end', () => {
    // The warning is subtracted from the limit, not added to it: the session
    // ends at fifteen minutes and the warning appears at fourteen.
    const atWarning = IDLE_LIMIT_MS - WARN_BEFORE_MS;
    const s = at(atWarning);
    expect(s.state).toBe('warning');
    expect(s.remainingMs).toBe(WARN_BEFORE_MS);
  });

  it('stays in warning until the moment it expires', () => {
    expect(at(IDLE_LIMIT_MS - 1).state).toBe('warning');
  });

  it('expires at exactly the limit, not after it', () => {
    expect(at(IDLE_LIMIT_MS)).toEqual({ state: 'expired', remainingMs: 0 });
  });

  it('stays expired afterwards rather than wrapping', () => {
    expect(at(IDLE_LIMIT_MS * 3)).toEqual({ state: 'expired', remainingMs: 0 });
  });

  it('treats a future timestamp as active rather than expired', () => {
    /*
     * A negative elapsed time means the stored timestamp is ahead of now — a
     * clock correction, or another tab writing while this one was suspended.
     * The failure this feature guards is an unattended screen; signing somebody
     * out because their laptop woke up with a corrected clock is not that, and
     * it would be indistinguishable from the feature working.
     */
    expect(idleStatus(T0 + 60_000, T0)).toEqual({ state: 'active', remainingMs: IDLE_LIMIT_MS });
  });

  it('uses the fifteen minutes US-41 specifies', () => {
    expect(IDLE_LIMIT_MS).toBe(15 * 60 * 1000);
  });
});

describe('secondsLeft', () => {
  it('rounds up, so a live countdown never reads zero', () => {
    // Rounding down would show "0 seconds" for a whole second while the session
    // was still open — a countdown contradicting itself.
    expect(secondsLeft(1)).toBe(1);
    expect(secondsLeft(1001)).toBe(2);
  });

  it('reads zero only once there is nothing left', () => {
    expect(secondsLeft(0)).toBe(0);
  });

  it('never goes negative', () => {
    expect(secondsLeft(-5_000)).toBe(0);
  });
});

describe('ACTIVITY_EVENTS', () => {
  it('covers touch and scroll, not just mouse and keyboard', () => {
    /*
     * A phone reading the calendar produces neither a mouse event nor a
     * keystroke. Timing that user out mid-read would be the feature misfiring
     * on the device it is most needed on.
     */
    expect(ACTIVITY_EVENTS).toContain('touchstart');
    expect(ACTIVITY_EVENTS).toContain('scroll');
  });

  it('counts returning to a backgrounded tab as activity', () => {
    // Otherwise switching away for fifteen minutes and coming back reads as
    // absence, and the session dies in the moment the user returns to it.
    expect(ACTIVITY_EVENTS).toContain('visibilitychange');
  });
});
