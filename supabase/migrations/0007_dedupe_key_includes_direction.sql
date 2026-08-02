-- ---------------------------------------------------------------------------
-- US-29 — the dedupe key includes direction, and the schema now says so.
--
-- `0001_init.sql` described `transactions.dedupe_hash` as:
--
--   Dedupe key: hash of (account, date, amount, normalised description).
--
-- That omission is a defect rather than a wording slip. A card charge and its
-- same-day reversal share account, date, amount and description, and differ
-- only in direction. Hash them together and the refund is rejected by
-- `transactions_dedupe` as a duplicate of the charge — the money comes back to
-- the account and the ledger never says why.
--
-- Which is the worse of the two failure directions, and the reason this is
-- worth a migration for one comment. A missed duplicate shows a transaction
-- twice in the review inbox, where a human rejects it — the inbox exists for
-- that. A false duplicate is silent: nothing appears, nothing warns, and the
-- ledger is quietly short. Nobody reconciles a statement they were never shown.
--
-- The hash itself is computed in `lib/ingestion/dedupe.ts`, which is also where
-- the normalisation rules and their justification live. This comment is the
-- database's copy of the contract; the constant that has to match it is there.
-- ---------------------------------------------------------------------------

comment on column public.transactions.dedupe_hash is
  'SHA-256 of (bank_account_id, date, amount to 2dp, direction, whitespace- and case-normalised description). Direction is load-bearing: without it a charge and its same-day reversal collide and the reversal is silently dropped. Computed by lib/ingestion/dedupe.ts — the two must agree or a re-parse duplicates everything.';

comment on index public.transactions_dedupe is
  'US-30: re-uploading the same statement creates zero new transactions. Partial on is_duplicate = false so a row can be *marked* duplicate and kept — a run that reports "12 rows, 3 already seen" is honest, one that reports 9 looks like three rows went missing.';
