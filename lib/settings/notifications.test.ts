import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  LEAD_DAY_CHOICES,
  parsePrefs,
  prefsFromRow,
} from './notifications';
import { DEFAULT_LEAD_DAYS } from '@/lib/engine/reminders';

/**
 * US-44. The criterion that shapes this file is the third one — *"email cannot
 * be disabled for hard legal deadlines"* — because the way to get it wrong is
 * to render a disabled checkbox and still read the field on the server.
 *
 * The other property defended here: no path may produce a user with zero
 * reminder times. Push is best-effort by construction, so "email off" or "no
 * lead days" would both be states in which a AED 45,000 cheque falls due and
 * nothing anywhere is obliged to say so.
 */

describe('email cannot be turned off', () => {
  it('is on by default', () => {
    expect(DEFAULT_PREFS.emailEnabled).toBe(true);
  });

  it('stays on however the form is submitted', () => {
    // The form does not carry an email field at all, so this asserts the shape
    // rather than a branch — which is the point. A field the form can carry is
    // a field a crafted form can set.
    expect(parsePrefs({ leadDays: ['7'] }).prefs.emailEnabled).toBe(true);
  });

  it('stays on even if a stored row says otherwise', () => {
    // A row can hold `false` — the column allows it and an earlier version of
    // this app could have written it. Reading it as written would let a stale
    // row silence the only guaranteed channel.
    expect(prefsFromRow({ email_enabled: false, push_enabled: true, lead_days: [7] }).emailEnabled)
      .toBe(true);
  });
});

describe('parsePrefs', () => {
  it('keeps the chosen lead days, largest first', () => {
    const r = parsePrefs({ leadDays: ['2', '14', '7'] });
    expect(r.ok).toBe(true);
    expect(r.prefs.leadDays).toEqual([14, 7, 2]);
  });

  it('never turns push on, whatever the form says', () => {
    /*
     * Push is derived from whether a subscription exists (`push-actions.ts`),
     * never typed in. A form field that could set `push_enabled` produces an
     * app that believes it can reach somebody it cannot — on the channel that
     * warns about bounced cheques — and it would look enabled on screen while
     * no browser anywhere held a subscription.
     */
    expect(parsePrefs({ leadDays: ['7'] }).prefs.pushEnabled).toBe(false);
  });

  it('drops values that are not offered', () => {
    // Anything outside LEAD_DAY_CHOICES came from a hand-edited form, not the
    // UI. Silently accepting 400 would schedule a reminder more than a year
    // ahead of a cheque.
    expect(parsePrefs({ leadDays: ['7', '400', 'x'] }).prefs.leadDays).toEqual([7]);
  });

  it('refuses an empty selection rather than saving it', () => {
    /*
     * "No reminders at all" is a legitimate thing to want and an illegitimate
     * thing to reach by unticking boxes one at a time without noticing. Saving
     * it would leave someone believing they are covered.
     */
    const r = parsePrefs({ leadDays: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Nothing has been changed');
  });

  it('refuses a selection that is entirely invalid', () => {
    expect(parsePrefs({ leadDays: ['999'] }).ok).toBe(false);
  });

  it('offers the schema defaults among its choices', () => {
    // A default the UI cannot express would be unreachable once changed.
    for (const d of DEFAULT_LEAD_DAYS) {
      expect(LEAD_DAY_CHOICES as readonly number[]).toContain(d);
    }
  });
});

describe('prefsFromRow', () => {
  it('falls back completely when there is no row', () => {
    expect(prefsFromRow(null)).toEqual(DEFAULT_PREFS);
  });

  it('falls back on an empty lead_days array rather than meaning "none"', () => {
    /*
     * `lead_days integer[] not null default '{7,2}'` permits `{}`. A row that
     * arrived empty through a path the UI does not offer would otherwise
     * produce no reminders at all — the exact failure this feature prevents,
     * reached by a column being empty.
     */
    expect(prefsFromRow({ lead_days: [] }).leadDays).toEqual([...DEFAULT_LEAD_DAYS]);
  });

  it('sorts stored lead days largest first', () => {
    expect(prefsFromRow({ lead_days: [2, 7] }).leadDays).toEqual([7, 2]);
  });

  it('drops nonsense stored values', () => {
    expect(prefsFromRow({ lead_days: [7, 0, -3] }).leadDays).toEqual([7]);
  });

  it('defaults push off when the column is null', () => {
    // Push cannot work without a browser permission this app has not asked
    // for, so `true` would be a preference it cannot honour.
    expect(prefsFromRow({ push_enabled: null }).pushEnabled).toBe(false);
  });
});
