-- =====================================================================
-- 0011 — a recurring cheque must be reminded every time it comes round
--
-- `notification_log` shipped with:
--
--   create unique index notification_log_once
--     on public.notification_log (user_id, scheduled_payment_id, channel, lead_days)
--     where scheduled_payment_id is not null;
--
-- The comment above it read "a given reminder is sent once per channel per
-- lead time (idempotent job)", and that is exactly what it enforced — once,
-- ever, for the lifetime of the payment row.
--
-- A recurring payment is ONE row. `pay-rent-q4` in the reference profile is a
-- quarterly rent cheque: one row, `recurrence: 'quarterly'`, four due dates a
-- year. Under the original index the October reminder would insert, and the
-- January, April and July ones would collide with it and be skipped as
-- already-sent.
--
-- So the app would have reminded the user once about the largest cheque they
-- write, and then gone quiet — while the log showed a successful send and the
-- job reported nothing wrong. A bounced cheque in the UAE carries civil and
-- potential criminal consequences (R-5); this is the failure the whole feature
-- exists to prevent, built into the thing meant to guarantee it.
--
-- The fix is to key the log by *occurrence* rather than by row. `lead_days`
-- alone cannot stand in for the date: two different occurrences of the same
-- series share both the payment id and the lead time, and differ only in when
-- they fall due.
--
-- Safe to apply as written: nothing has ever written to this table, in any
-- deployment, because no sender exists yet. `lib/engine/reminders.ts` computes
-- the schedule and `reminderKey()` is the application-side half of this key —
-- a test there fails if either half is reverted.
-- =====================================================================

alter table public.notification_log
  add column if not exists due_date date;

comment on column public.notification_log.due_date is
  'The occurrence this reminder was about. A recurring payment is one row with '
  'many due dates, so the row id alone cannot identify what was sent.';

drop index if exists public.notification_log_once;

-- A reminder is sent once per occurrence, per channel, per lead time.
create unique index notification_log_once
  on public.notification_log (user_id, scheduled_payment_id, due_date, channel, lead_days)
  where scheduled_payment_id is not null;

-- Without this, a null `due_date` would slip past the index entirely: nulls are
-- distinct in a unique index, so every send with a missing date would insert
-- happily and the idempotence guarantee would quietly not apply to it.
alter table public.notification_log
  add constraint notification_log_payment_needs_due_date
  check (scheduled_payment_id is null or due_date is not null);
