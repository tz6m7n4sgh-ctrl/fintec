import { DEFAULT_LEAD_DAYS } from '@/lib/engine/reminders';

/**
 * Notification preferences (US-44 / FR-I2 / D3).
 *
 * Pure, and in `lib/` rather than beside the action, because a `'use server'`
 * module may only export async functions — and because the parsing below is
 * the part worth testing without a database.
 */

export interface NotificationPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  /** Days before a due date, largest first. */
  leadDays: number[];
}

/**
 * What a user gets before they have chosen anything.
 *
 * Email on, push off, `[7, 2]` — matching `notification_prefs`'s own column
 * defaults, so a row created by the database and a row created here are the
 * same row. Push defaults off because it cannot be enabled without a browser
 * permission prompt, and a stored `true` that no browser has agreed to is a
 * preference the app cannot honour.
 */
export const DEFAULT_PREFS: NotificationPrefs = {
  emailEnabled: true,
  pushEnabled: false,
  leadDays: [...DEFAULT_LEAD_DAYS],
};

/** Lead times a user may pick. Bounded so the UI is a fixed set of checkboxes. */
export const LEAD_DAY_CHOICES = [14, 7, 3, 2, 1] as const;

/**
 * Email cannot be turned off.
 *
 * US-44's third criterion, and it is a real constraint rather than a nag: push
 * is best-effort by construction — it needs a browser permission, a live
 * subscription, and on iOS an installed PWA — so if email could also be off,
 * the app would be able to reach a state where a cheque worth AED 45,000 falls
 * due and nothing anywhere is obliged to say so.
 *
 * The setting is therefore absent from the form rather than present-and-
 * disabled. A greyed-out switch invites the question "why can't I?"; saying it
 * in a sentence answers it.
 */
export const EMAIL_IS_MANDATORY = true;

export interface ParseResult {
  ok: boolean;
  prefs: NotificationPrefs;
  error?: string;
}

/**
 * Reads a submitted form into preferences.
 *
 * Rejects an empty lead-day selection rather than saving it. "No reminders at
 * all" is a legitimate thing to want and an illegitimate thing to arrive at by
 * unticking boxes one at a time without noticing — so it needs its own explicit
 * control, which this app does not have yet. Until it does, the honest answer
 * is to refuse and say why.
 */
export function parsePrefs(form: {
  push: boolean;
  leadDays: readonly string[];
}): ParseResult {
  const chosen = form.leadDays
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && (LEAD_DAY_CHOICES as readonly number[]).includes(n))
    .sort((a, b) => b - a);

  if (chosen.length === 0) {
    return {
      ok: false,
      prefs: DEFAULT_PREFS,
      error:
        'Choose at least one reminder time. Nothing has been changed — to stop reminders entirely, turn them off rather than clearing every lead time.',
    };
  }

  return {
    ok: true,
    prefs: {
      // Not read from the form at all. See EMAIL_IS_MANDATORY: a value the form
      // can carry is a value a crafted form can set.
      emailEnabled: true,
      pushEnabled: form.push,
      leadDays: chosen,
    },
  };
}

/** Reads a database row, falling back field by field rather than wholesale. */
export function prefsFromRow(row: {
  email_enabled?: boolean | null;
  push_enabled?: boolean | null;
  lead_days?: number[] | null;
} | null): NotificationPrefs {
  if (!row) return DEFAULT_PREFS;

  const lead = (row.lead_days ?? []).filter((n) => Number.isInteger(n) && n > 0);

  return {
    // Always true. A row that somehow holds `false` is not honoured — see
    // EMAIL_IS_MANDATORY — and reading it as written would let a stale row
    // silence the one guaranteed channel.
    emailEnabled: true,
    pushEnabled: row.push_enabled ?? false,
    /*
     * An empty array falls back to the default rather than meaning "none".
     * `lead_days integer[] not null default '{7,2}'` permits `{}`, and a row
     * that arrived empty through some path the UI does not offer would silently
     * produce no reminders at all — the failure mode this whole feature exists
     * to prevent, reached by a column being empty.
     */
    leadDays: lead.length > 0 ? [...lead].sort((a, b) => b - a) : [...DEFAULT_LEAD_DAYS],
  };
}
