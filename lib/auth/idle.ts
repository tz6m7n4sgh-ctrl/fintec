/**
 * Idle auto-lock (US-41 / FR-K3 / HAD-7).
 *
 * ## Why this signs out rather than "locking"
 *
 * The obvious implementation is an overlay: keep the session, cover the screen,
 * ask for a password to dismiss it. It looks like the feature and is not one.
 *
 * By the time the overlay appears the figures are already in the DOM, the
 * session cookie is still valid, and both survive the overlay being removed
 * from devtools or never rendering at all on a broken build. Someone who picks
 * up an unattended laptop gets past it; the app just told its owner they were
 * protected.
 *
 * So idle expiry ends the session for real. The cost is honest — an unsaved
 * form is lost, and signing back in takes a password — and the warning below
 * exists so it is never a surprise.
 *
 * ## Locally, not everywhere
 *
 * Walking away from a laptop says nothing about the phone in your pocket.
 * `signOutIdle()` uses `scope: 'local'`, unlike the deliberate global revoke
 * behind the "Sign out everywhere" button.
 */

/** Fifteen minutes, from US-41. */
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

/**
 * How long the warning is on screen before the session ends.
 *
 * Sixty seconds is enough to notice and move the mouse, and short enough that
 * it is not a second idle period of its own. It is subtracted from the limit
 * rather than added to it: the session ends at fifteen minutes, and the warning
 * appears at fourteen.
 */
export const WARN_BEFORE_MS = 60 * 1000;

/** Where the last-activity timestamp is shared between tabs. */
export const IDLE_STORAGE_KEY = 'fintec:last-activity';

export type IdleState = 'active' | 'warning' | 'expired';

export interface IdleStatus {
  state: IdleState;
  /** Milliseconds until the session ends. Zero once expired. */
  remainingMs: number;
}

/**
 * What the timer should be showing, given when the user last did something.
 *
 * Pure and clock-injected so the boundaries are testable — an off-by-one here
 * either signs somebody out a minute early or leaves the app open on a screen
 * of salary figures for a minute longer than promised.
 */
export function idleStatus(lastActivityMs: number, nowMs: number): IdleStatus {
  const elapsed = nowMs - lastActivityMs;

  /*
   * A negative elapsed time means the stored timestamp is in the future —
   * a clock change, or another tab writing while this one was suspended.
   * Treated as active rather than expired: the failure this feature guards is
   * an unattended screen, and signing somebody out because their laptop woke up
   * with a corrected clock is not that.
   */
  if (elapsed < 0) return { state: 'active', remainingMs: IDLE_LIMIT_MS };

  const remainingMs = Math.max(0, IDLE_LIMIT_MS - elapsed);

  if (remainingMs === 0) return { state: 'expired', remainingMs: 0 };
  if (remainingMs <= WARN_BEFORE_MS) return { state: 'warning', remainingMs };
  return { state: 'active', remainingMs };
}

/** Whole seconds left, for a countdown that never shows "0" while still live. */
export function secondsLeft(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * The events that count as being present.
 *
 * `scroll` and `touchstart` matter as much as `mousemove` — a phone reading the
 * calendar produces neither a mouse event nor a keystroke, and timing that user
 * out mid-read would be the feature misfiring on the device it is most needed
 * on. `visibilitychange` is here so returning to a backgrounded tab counts as
 * activity rather than as fifteen minutes of absence.
 */
export const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'visibilitychange',
] as const;
