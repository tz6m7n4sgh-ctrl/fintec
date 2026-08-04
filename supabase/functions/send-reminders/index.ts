import { createClient } from 'jsr:@supabase/supabase-js@2';
/*
 * `npm:web-push` rather than a hand-rolled VAPID JWT + aes128gcm encryptor:
 * the payload encryption (RFC 8291) is exactly the kind of code that can be
 * subtly wrong while looking right, and this is the library the project's own
 * docs already lean on (`npx web-push generate-vapid-keys` in .env.example).
 * It uses node:crypto, which the Supabase Edge runtime's Node compatibility
 * layer provides.
 */
import webpush from 'npm:web-push@3.6.7';
import { todayInDubai } from './_engine/dates.ts';
import { applySettlement } from './_engine/settle.ts';
import {
  DEFAULT_LEAD_DAYS,
  dueOn,
  reminderKey,
  remindersWithin,
  type Reminder,
} from './_engine/reminders.ts';
import type { ScheduledPayment } from './_engine/types.ts';

/**
 * The daily reminder job (US-16 / FR-B2 / BR-4 / R-5 / HAD-13).
 *
 * ## Why it runs here rather than in GitHub Actions
 *
 * It has to read every user's payments, which needs the service-role key. That
 * key bypasses row-level security, and SEC-3 established that this project
 * holds it *nowhere* — not in the repo, not in CI, not in the deployment
 * environment. Inside an Edge Function Supabase injects it at runtime, so it
 * exists only where it must and never travels through a repository or a CI
 * secret store. That is the whole reason for this file's location.
 *
 * ## What it does not do
 *
 * Deliver on a channel whose keys are absent. Without `RESEND_API_KEY` no
 * email goes out; without the VAPID pair (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` +
 * `VAPID_PRIVATE_KEY`) no push goes out. Either way the job still computes the
 * day's reminders, reports how many it *would* have sent, and writes nothing —
 * because logging a send that did not happen is worse than not sending: the
 * unique index would then refuse the real one tomorrow, and the user would be
 * silently un-remindable about a cheque, forever.
 *
 * ## Web push (HAD-30 + HAD-113)
 *
 * Delivered here, to the `push` handler in `public/sw.js`, for each user whose
 * `notification_prefs` row has `push_enabled` and a stored subscription. It
 * carries the same copy as the email and is logged under `channel: 'push'`
 * with the same send-once semantics, so neither channel can double-send. Push
 * is per device and best-effort — a subscription the push service reports gone
 * (404/410) is deleted, which flips `push_enabled` off, the invariant Settings
 * maintains: the flag *means* a subscription exists. Email remains the
 * guaranteed channel; push is the tap on the shoulder.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface PrefsRow {
  user_id: string;
  email_enabled: boolean;
  push_enabled: boolean;
  lead_days: number[] | null;
  /** jsonb; shape is proven by `asPushSubscription`, never assumed. */
  push_subscription: unknown;
}

/** What Settings stores in `notification_prefs.push_subscription` — see `toStored()` in `lib/settings/push.ts`. */
interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface Outcome {
  day: string;
  usersConsidered: number;
  remindersDue: number;
  /** Email — the guaranteed channel. */
  sent: number;
  alreadySent: number;
  failed: number;
  /** Web push — best-effort, per stored subscription. */
  pushSent: number;
  pushAlreadySent: number;
  pushFailed: number;
  /** Subscriptions the push service reported gone (404/410), deleted here. */
  deadSubscriptionsRemoved: number;
  /** Present when no email could be delivered, naming why. */
  notDelivered?: string;
  /** Present when no push could be delivered, naming why. */
  pushNotDelivered?: string;
  errors: string[];
}

function admin() {
  /*
   * Both injected by the platform. Read rather than defaulted: a missing
   * service-role key must stop the job, not silently fall back to the anon key
   * and return zero reminders for everybody while reporting success.
   */
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available.');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function sendEmail(to: string, reminder: Reminder, apiKey: string, from: string) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `Fund your account — ${reminder.payee}, ${reminder.leadDays} days`,
      text: [
        reminder.message,
        '',
        'A bounced cheque in the UAE carries civil and potential criminal consequences,',
        'so this reminder is sent whether or not you have opened the app.',
      ].join('\n'),
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

/**
 * Narrows the `push_subscription` jsonb to what the sender needs, or null.
 *
 * Re-checked here even though Settings writes the same shape, because a jsonb
 * column proves nothing about its contents and `sendNotification` given a
 * half-formed subscription fails with a message about the library's internals
 * rather than about the row.
 */
function asPushSubscription(v: unknown): StoredPushSubscription | null {
  const s = v as StoredPushSubscription | null;
  if (
    typeof s?.endpoint === 'string' &&
    s.endpoint.length > 0 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string'
  ) {
    return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
  }
  return null;
}

interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

async function sendPush(sub: StoredPushSubscription, reminder: Reminder, vapid: VapidDetails) {
  /*
   * The payload is what the `push` handler in `public/sw.js` reads: `title`,
   * `body`, `tag`. Title and body are the email's subject and message — the
   * copy US-16 specifies, written once by the engine and composed nowhere
   * else. The email's extra paragraph about bounced-cheque consequences is
   * deliberately not here: a notification body is glanced at on a lock screen,
   * and the sentence that matters is the one naming the account, the amount
   * and the date.
   *
   * The tag is the reminder key, so a retried send replaces its predecessor on
   * screen while distinct reminders (two cheques, or 7-day then 2-day) stack.
   */
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: sub.keys },
    JSON.stringify({
      title: `Fund your account — ${reminder.payee}, ${reminder.leadDays} days`,
      body: reminder.message,
      tag: reminderKey(reminder, 'push'),
    }),
    {
      vapidDetails: vapid,
      // A funding reminder for *today's* lead time is stale by tomorrow —
      // tomorrow's run sends the next one. Don't let the push service hold it
      // longer than the day it is about.
      TTL: 60 * 60 * 24,
    },
  );
}

Deno.serve(async (req) => {
  /*
   * pg_cron calls this with the anon key in the Authorization header and the
   * function is deployed with `--no-verify-jwt` off, so Supabase checks the
   * token before this runs. The extra shared-secret check below is for the case
   * where the function is exposed publicly: anyone with the anon key (which is
   * in the client bundle by design) could otherwise trigger the whole mailout.
   */
  const expected = Deno.env.get('REMINDER_JOB_SECRET');
  if (expected && req.headers.get('x-reminder-secret') !== expected) {
    return new Response('Forbidden', { status: 403 });
  }

  const day = todayInDubai();
  const outcome: Outcome = {
    day,
    usersConsidered: 0,
    remindersDue: 0,
    sent: 0,
    alreadySent: 0,
    failed: 0,
    pushSent: 0,
    pushAlreadySent: 0,
    pushFailed: 0,
    deadSubscriptionsRemoved: 0,
    errors: [],
  };

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('REMINDER_FROM') ?? 'Fintec <reminders@example.invalid>';

  /*
   * The pair the rest of the project already names: the public half is what
   * Settings hands to `pushManager.subscribe()` (NEXT_PUBLIC_, it ships in the
   * client bundle by design), the private half lives only in Edge Function
   * secrets. Both or neither — one without the other cannot sign a VAPID JWT
   * any push service will accept, so it is treated as "push not configured"
   * rather than half-tried.
   */
  const vapidPublicKey = Deno.env.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapid: VapidDetails | null =
    vapidPublicKey && vapidPrivateKey
      ? {
          // The VAPID subject is the sender's contact address, and this job
          // already has exactly one of those: the same identity the email
          // goes out under. Stated once, not configured twice.
          subject: `mailto:${from.match(/<([^>]+)>/)?.[1] ?? from}`,
          publicKey: vapidPublicKey,
          privateKey: vapidPrivateKey,
        }
      : null;

  let supabase;
  try {
    supabase = admin();
  } catch (e) {
    return Response.json({ ...outcome, errors: [String(e)] }, { status: 500 });
  }

  const { data: prefsRows, error: prefsError } = await supabase
    .from('notification_prefs')
    .select('user_id, email_enabled, push_enabled, lead_days, push_subscription');

  if (prefsError) {
    return Response.json({ ...outcome, errors: [prefsError.message] }, { status: 500 });
  }

  /*
   * Everyone with payments gets reminders, not only everyone with a prefs row.
   *
   * A user who has never opened Settings has no row — the column defaults only
   * apply to a row that exists. Driving the loop off `notification_prefs` would
   * have meant the people least engaged with the app, who most need telling,
   * were the ones it never told.
   */
  const { data: owners, error: ownersError } = await supabase
    .from('scheduled_payments')
    .select('user_id');

  if (ownersError) {
    return Response.json({ ...outcome, errors: [ownersError.message] }, { status: 500 });
  }

  const prefsByUser = new Map((prefsRows ?? []).map((p: PrefsRow) => [p.user_id, p]));
  const userIds = [...new Set((owners ?? []).map((r: { user_id: string }) => r.user_id))];
  outcome.usersConsidered = userIds.length;

  for (const userId of userIds) {
    const prefs = prefsByUser.get(userId);
    const leadDays =
      prefs?.lead_days && prefs.lead_days.length > 0 ? prefs.lead_days : [...DEFAULT_LEAD_DAYS];

    const [{ data: payments, error: payError }, { data: fees }, { data: txns }] = await Promise.all([
      supabase.from('scheduled_payments').select('*').eq('user_id', userId),
      supabase.from('school_fees').select('*').eq('user_id', userId),
      supabase.from('transactions').select('*').eq('user_id', userId),
    ]);

    /*
     * `.eq('user_id', …)` is required here and forbidden everywhere else in
     * this codebase. Elsewhere RLS is the boundary and a redundant filter would
     * mask a broken policy; here the service-role key bypasses RLS entirely, so
     * this filter *is* the boundary. Dropping it would email one user another
     * user's cheques.
     */
    if (payError) {
      outcome.errors.push(`${userId}: ${payError.message}`);
      continue;
    }

    const rows: ScheduledPayment[] = (payments ?? []).map((p) => ({
      id: p.id,
      dueDate: p.due_date,
      payee: p.payee,
      purpose: p.purpose ?? '',
      amount: Number(p.amount),
      /*
       * `account_label`, not `account`. The column is named the former and the
       * domain type the latter — `lib/data/repository.ts:194` does the same
       * mapping. Reading `p.account` here compiled fine, returned undefined for
       * every row, and produced "Fund your account with AED 18,000" on every
       * reminder instead of naming the bank the money has to be in.
       *
       * Which is the whole point of the message. Found by running this against
       * the real schema rather than by reading it.
       */
      account: p.account_label ?? '',
      type: p.type,
      recurrence: p.recurrence,
      includedInBudget: p.included_in_budget,
      seriesId: p.series_id ?? undefined,
      detachedDate: p.detached_date ?? undefined,
      status: p.status,
    }));

    const feeObligations: ScheduledPayment[] = (fees ?? [])
      .filter((f) => !f.paid)
      .map((f) => ({
        id: `fee:${f.id}`,
        dueDate: f.due_date,
        payee: `${f.school} school`,
        purpose: `School fees — ${f.term}`,
        amount: Number(f.amount),
        account: '',
        type: f.paid_by_cheque ? ('cheque' as const) : ('transfer' as const),
        recurrence: 'none' as const,
        includedInBudget: true,
        derivedFrom: 'schoolFees' as const,
        status: 'upcoming' as const,
      }));

    // Settlement applied exactly as the app applies it, so a cheque a confirmed
    // transaction has already cleared produces no reminder here either.
    const settled = applySettlement(
      [...rows, ...feeObligations],
      (txns ?? []).map((t) => ({
        matchedScheduledPaymentId: t.matched_scheduled_payment_id ?? undefined,
        reviewStatus: t.review_status,
        isDuplicate: t.is_duplicate ?? false,
      })),
    );

    const today = dueOn(remindersWithin(settled, day, leadDays), day);
    outcome.remindersDue += today.length;
    if (today.length === 0) continue;

    // Email — the guaranteed channel. Counted above even when the key is
    // absent; see notDelivered below.
    if (apiKey) {
      const { data: userRes } = await supabase.auth.admin.getUserById(userId);
      const email = userRes?.user?.email;
      if (!email) {
        // Reported, but not a reason to skip push below — a passkey-only
        // account with a subscribed device still has one working channel.
        outcome.errors.push(`${userId}: no email address on the account`);
      } else {
        for (const reminder of today) {
          const key = reminderKey(reminder, 'email');
          /*
           * Send first, then log. The other order is tempting — claim the key,
           * then send — and it is wrong in the direction that matters: a crash
           * between the two would leave a logged reminder nobody received, and
           * the unique index would refuse to retry it. A duplicate email is an
           * annoyance; a silently skipped cheque reminder is the failure this
           * feature exists to prevent.
           */
          try {
            await sendEmail(email, reminder, apiKey, from);
          } catch (e) {
            outcome.failed += 1;
            outcome.errors.push(`${key}: ${String(e)}`);
            continue;
          }

          const { error: logError } = await supabase.from('notification_log').insert({
            user_id: userId,
            // Derived rows carry a `fee:` sentinel that is not a uuid; the
            // column would reject it, so the log records the deadline key
            // instead.
            scheduled_payment_id: reminder.paymentId.startsWith('fee:') ? null : reminder.paymentId,
            deadline_key: reminder.paymentId.startsWith('fee:') ? key : null,
            due_date: reminder.dueDate,
            channel: 'email',
            lead_days: reminder.leadDays,
          });

          if (logError) {
            // 23505 is the send-once index doing its job on a retry of a day
            // that already ran. Not an error, and not a second email either.
            if (logError.code === '23505') outcome.alreadySent += 1;
            else outcome.errors.push(`${key}: logged send failed: ${logError.message}`);
            continue;
          }

          outcome.sent += 1;
        }
      }
    }

    // Push — best-effort, only where this user enabled it on a device. Same
    // counted-but-not-sent dry run as email when the VAPID pair is absent; see
    // pushNotDelivered below.
    if (vapid && prefs?.push_enabled) {
      const sub = asPushSubscription(prefs.push_subscription);
      if (!sub) {
        // `push_enabled` means a subscription exists — Settings maintains that
        // invariant — so a row where it doesn't is data corruption worth
        // naming, not a preference to respect quietly.
        outcome.errors.push(`${userId}: push_enabled but the stored subscription is unusable`);
        continue;
      }

      for (const reminder of today) {
        const key = reminderKey(reminder, 'push');
        // Send first, then log — the same order as email, for the same reason.
        try {
          await sendPush(sub, reminder, vapid);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            /*
             * The push service says this subscription no longer exists — the
             * browser unsubscribed, or the user cleared site data. Deleting it
             * also flips `push_enabled` off, which is Settings' own invariant
             * (the flag is derived from the subscription's existence), so the
             * next visit to Settings shows push honestly off instead of
             * claiming a channel that cannot deliver. Not counted as a
             * failure: the remediation is complete, and email above still
             * carried the reminder.
             */
            const { error: pruneError } = await supabase
              .from('notification_prefs')
              .update({ push_enabled: false, push_subscription: null })
              .eq('user_id', userId);
            if (pruneError) {
              outcome.errors.push(
                `${userId}: dead push subscription could not be removed: ${pruneError.message}`,
              );
            } else {
              outcome.deadSubscriptionsRemoved += 1;
            }
            break; // every remaining push today targets the same dead endpoint
          }
          outcome.pushFailed += 1;
          const body = (e as { body?: string }).body;
          outcome.errors.push(`${key}: WebPush ${status ?? '?'}: ${body || String(e)}`);
          continue;
        }

        const { error: logError } = await supabase.from('notification_log').insert({
          user_id: userId,
          // Same fee-sentinel split as email. The key embeds the channel, so
          // the derived-row index (0012, `user_id + deadline_key`) cannot
          // collide across channels.
          scheduled_payment_id: reminder.paymentId.startsWith('fee:') ? null : reminder.paymentId,
          deadline_key: reminder.paymentId.startsWith('fee:') ? key : null,
          due_date: reminder.dueDate,
          channel: 'push',
          lead_days: reminder.leadDays,
        });

        if (logError) {
          if (logError.code === '23505') outcome.pushAlreadySent += 1;
          else outcome.errors.push(`${key}: logged send failed: ${logError.message}`);
          continue;
        }

        outcome.pushSent += 1;
      }
    }
  }

  if (!apiKey) {
    outcome.notDelivered =
      'RESEND_API_KEY is not set, so no email was sent and none was logged. ' +
      'Logging an unsent reminder would make the send-once index refuse the real one.';
  }

  if (!vapid) {
    outcome.pushNotDelivered =
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not both set, so no push was ' +
      'sent and none was logged — the same reasoning as notDelivered.';
  }

  return Response.json(outcome, { status: outcome.errors.length > 0 ? 207 : 200 });
});
