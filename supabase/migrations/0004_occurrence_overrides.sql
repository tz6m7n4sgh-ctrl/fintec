-- ---------------------------------------------------------------------------
-- US-22 / OQ-4 — single-occurrence overrides on a recurring payment.
--
-- The decision on record (HAD-63): editing one occurrence **detaches** it into a
-- standalone payment and leaves the series intact. Not a per-occurrence
-- exception table, not a materialised occurrence per row — the least machinery
-- that survives the real case, which is one month's rent cheque differing.
--
-- Two columns carry it:
--
--   series_id      the recurring payment this row was detached from
--   detached_date  the occurrence date in that series this row replaces
--
-- `detached_date` is separate from `due_date` on purpose. Detaching an
-- occurrence and then moving it — "the March cheque, but on the 20th" — is the
-- normal case, and without a stable record of *which* occurrence was replaced,
-- the series would keep generating the original date and the payment would
-- appear twice. That is the R-5 failure mode: a cheque counted twice is a
-- wrong runway, a cheque counted zero times is a bounced cheque.
-- ---------------------------------------------------------------------------

alter table public.scheduled_payments
  add column if not exists series_id uuid
    references public.scheduled_payments(id) on delete cascade,
  add column if not exists detached_date date;

-- Both or neither. A row claiming to replace an occurrence without saying which
-- one, or naming a date without a series, is not a state the expansion can act
-- on — and silently ignoring it would drop or duplicate a payment.
alter table public.scheduled_payments
  drop constraint if exists scheduled_detach_needs_both;
alter table public.scheduled_payments
  add constraint scheduled_detach_needs_both
    check ((series_id is null) = (detached_date is null));

-- A detached row is a standalone payment, so it must not itself recur. Two
-- levels of recurrence would make "which occurrence does this replace"
-- unanswerable.
alter table public.scheduled_payments
  drop constraint if exists scheduled_detached_is_one_off;
alter table public.scheduled_payments
  add constraint scheduled_detached_is_one_off
    check (series_id is null or recurrence = 'none');

-- One override per occurrence. Without this, two detached rows for the same
-- date would both render and the user would see the payment twice — the
-- double-count this whole model exists to avoid.
create unique index if not exists scheduled_one_override_per_occurrence
  on public.scheduled_payments (series_id, detached_date)
  where series_id is not null;

-- The expansion looks up overrides by series, on every render of the calendar,
-- the schedule and the projection.
create index if not exists scheduled_payments_series
  on public.scheduled_payments (user_id, series_id)
  where series_id is not null;

comment on column public.scheduled_payments.series_id is
  'The recurring payment this row was detached from (US-22 / OQ-4). Null for an ordinary payment.';
comment on column public.scheduled_payments.detached_date is
  'Which occurrence of series_id this row replaces. Stays fixed when due_date moves, so the series knows to skip it.';
