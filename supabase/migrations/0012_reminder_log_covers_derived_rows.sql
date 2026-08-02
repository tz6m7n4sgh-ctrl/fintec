-- =====================================================================
-- 0012 — the send-once guarantee must cover school-fee reminders too
--
-- 0011 fixed the index so a recurring cheque is reminded every quarter
-- rather than once. It left a hole that only shows up now that a sender
-- exists.
--
-- The index is partial:
--
--   where scheduled_payment_id is not null
--
-- and a school-fee reminder cannot fill that column. School-fee terms are
-- *derived* rows (HAD-81): they carry a `fee:<uuid>` sentinel id, deliberately
-- not a uuid, so that anything trying to write one fails loudly. The column is
-- `uuid references scheduled_payments(id)` and would reject it.
--
-- So every school-fee reminder would have been logged with a null
-- scheduled_payment_id, fallen outside the partial index, and been sent again
-- on every run of the job. School fees are termly and large, and the reminder
-- is the same one three days running — which is precisely how a person learns
-- to filter this sender to spam, taking the cheque reminders with it.
--
-- Those rows use `deadline_key` instead, which holds the application's
-- `reminderKey()` — payment id, due date, channel and lead time in one string.
-- This gives them their own index over that column.
--
-- The check at the end closes the remaining gap: a row with neither column set
-- is covered by no index at all, and would be re-sent forever.
-- =====================================================================

-- A derived reminder is sent once per key.
create unique index if not exists notification_log_once_derived
  on public.notification_log (user_id, deadline_key)
  where deadline_key is not null;

comment on column public.notification_log.deadline_key is
  'Idempotency key for reminders about rows with no uuid of their own — '
  'school-fee terms, which are derived and carry a `fee:<uuid>` sentinel id. '
  'Holds reminderKey() from lib/engine/reminders.ts.';

-- Neither column set means no index applies, and a reminder outside every
-- index is one that sends again on every run.
alter table public.notification_log
  add constraint notification_log_needs_an_identity
  check (scheduled_payment_id is not null or deadline_key is not null);
