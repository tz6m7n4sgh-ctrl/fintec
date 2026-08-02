-- ---------------------------------------------------------------------------
-- US-33 — a salary credit needs somewhere to record which stream it came from.
--
-- `proposeIncome()` shipped in PR #26 with tests, and its result was thrown
-- away: `transactions` had `matched_scheduled_payment_id` for debits and no
-- counterpart for credits. So the matcher correctly identified a salary and the
-- app had nowhere to put the answer.
--
-- Mirrors the payment column exactly, including `on delete set null`: deleting
-- an income stream must not delete the transactions attributed to it. The
-- ledger is a record of money that moved, and it stays true whether or not the
-- stream it came from still exists.
-- ---------------------------------------------------------------------------

alter table public.transactions
  add column if not exists matched_income_stream_id uuid
    references public.income_streams(id) on delete set null;

comment on column public.transactions.matched_income_stream_id is
  'Which income stream this credit came from (US-33). Attribution only — income reaches runway through income_streams (HAD-80), so a confirmed match here must never also feed that figure, or one fact would have two sources.';

/*
 * A transaction settles a payment or comes from an income stream, never both.
 * A debit cannot arrive from a salary and a credit cannot pay a cheque, so a
 * row claiming both is a parser or a UI that has confused direction — and the
 * consequence would be a payment marked paid by money coming *in*.
 */
alter table public.transactions
  drop constraint if exists transactions_one_match_kind;
alter table public.transactions
  add constraint transactions_one_match_kind
    check (matched_scheduled_payment_id is null or matched_income_stream_id is null);
