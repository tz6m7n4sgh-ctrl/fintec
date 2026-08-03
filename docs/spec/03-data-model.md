# Data model

Postgres, on Supabase. **26 migrations in `supabase/migrations/`, applied in order — read those, not a diagram of them.** This document covers the shape and the parts whose reasoning is not obvious from the SQL.

## The fifteen tables

| Table | Holds |
| --- | --- |
| `profiles` | One row per user. Employment dates, basic/gross salary, leave, notice, ILOE status, savings, dependents, visa grace |
| `income_streams` | Salary and side income, with start/end dates and a frequency |
| `debts` | Loans and mortgage, feeding the budget as a computed row |
| `school_fees` | Term fees, expanded into scheduled payments rather than stored twice |
| `scheduled_payments` | Recurring obligations — rent cheques, instalments — with a first due date and a step in months |
| `budget_categories` | Current and survival amounts per category |
| `category_rules` | Keyword rules that categorise a transaction, with a priority |
| `bank_accounts` | Bank, last four digits, and a saved `parser_config` for repeat statement uploads |
| `statement_uploads` | One per uploaded file: storage path, status, transaction count, and a `processing_log` |
| `transactions` | The ledger. Every row carries a `dedupe_hash` and a `review_status` |
| `checklist_items` | Per-user `done` state for the action plan, keyed by `seed_key` |
| `notification_prefs` | Lead days and channel preferences, one row per user |
| `notification_log` | Send-once record, per occurrence per channel |
| `passkeys` | WebAuthn credentials |
| `webauthn_challenges` | Single-use ceremony challenges |

## Row-level security

**Enabled *and forced* on every table.** Forced matters: without it the table owner bypasses its own policies.

The standard shape is four policies per table, all keyed to `(select auth.uid()) = user_id`. Two tables deviate deliberately:

**`passkeys` has no update policy.** The only mutable column is the signature counter, written by an Edge Function during authentication when there is no `auth.uid()`. A signed-in client able to update it could rewind their own counter and disable clone detection on their own credential — the one check the table exists to support.

**`webauthn_challenges` has RLS enabled and *no policies at all*.** That denies every ordinary client outright. It is written and read only by the Edge Function under service-role, during a ceremony where the user is by definition not signed in, so there is no `auth.uid()` for a policy to key on. This is the intended state, not an oversight.

> **When reimplementing:** application code must **not** add a redundant `user_id` filter to a query RLS already scopes. See invariant I-2 — a redundant filter makes a broken policy produce correct results.

## Constraints that carry meaning

These are not defensive noise; each one prevents a specific defect.

**`profiles_gross_gte_basic`** — gross includes allowances, so it is always the larger figure. Catches a transposition that would otherwise silently reduce the settlement.

**`profiles_employment_before_exit`** — an exit before the start date produces negative service and a negative gratuity.

**`upload_failed_needs_message`** — a `failed` upload cannot exist without a sentence explaining why. Enforced by the database because a status without a reason is a screen that says "something went wrong".

**`statement_uploads_path_is_object_key`** — `storage_path` must begin with the owner's uid. The storage policy matches on the first path segment, so a path prefixed with the bucket name matches no uid and every operation is refused *including the owner's*. This constraint exists because that mistake was made.

**`transactions_dedupe`** — unique on `(user_id, dedupe_hash)`, **partial on `is_duplicate = false`**. Partial so a row can be *marked* duplicate without blocking inserts.

## The two indexes whose shape is the feature

**`transactions_dedupe`** — the hash covers account, date, amount, **direction** and normalised description. `direction` is load-bearing: a card charge and its same-day reversal share everything else, and without direction the refund hashes as a duplicate of the charge and silently disappears. Migration 0007 corrects a schema comment that omitted it.

**`notification_log`** — unique on `(user_id, scheduled_payment_id, due_date, channel, lead_days)`, plus a partial unique on `(user_id, deadline_key)` for derived rows.

Both halves were defects:

- Without `due_date`, a **quarterly rent cheque would have been reminded once, ever** — for the largest cheque most people write. Migration 0011.
- The index was partial on `scheduled_payment_id is not null`, which a **school-fee** reminder cannot satisfy (derived rows carry a `fee:<uuid>` sentinel), so every fee reminder would have re-sent on every run. Migration 0012.

Neither would have raised an error. Both would have looked like the feature working.

## Storage

One private bucket, `statements`. Object keys are **`<uid>/<uuid>.<ext>`** — never `statements/<uid>/…`.

`bucket_id` and `name` are separate columns in Supabase Storage, so prefixing the bucket name makes `foldername(name)[1]` the literal string `statements`, which matches no uid, and every read and write is refused for every user including the owner.

No user-supplied text ever reaches the key. The filename the user recognises lives in `file_name`, where it is data rather than a path.

## Columns that were dead and now are not

Worth naming, because each was defined in migration 0001 and then referenced by nothing for weeks — the schema described a feature the app did not have:

| Column | Now used by |
| --- | --- |
| `transactions.dedupe_hash` | The ingestion engine. It was `not null` with a unique index and nothing computed it — **any insert would have failed** |
| `statement_uploads.processing_log` | The parser, surfaced per file |
| `bank_accounts.parser_config` | Saved column mapping, carrying a date order forward between uploads |
| `category_rules` | Keyword categorisation |
| `notification_prefs` | Reminder preferences |

A reimplementation should treat an unreferenced column as a defect to investigate, not as harmless.

## Scheduled work

`pg_cron` runs the reminder job at **20:00 UTC — midnight in Dubai**, calling `public.trigger_reminder_job()`, which reads its URL and token from Vault and **raises if either is absent**.

Raising rather than returning quietly is deliberate: `cron.job_run_details` records an exception, whereas a silent no-op is indistinguishable from "no reminders were due".
