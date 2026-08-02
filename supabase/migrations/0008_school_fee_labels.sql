-- ---------------------------------------------------------------------------
-- US-20 — a school-fee term must be identifiable.
--
-- A dated fee with blank labels is storable today and unusable everywhere it
-- lands: `schoolFeeObligations()` renders the payee as "` school`" and the
-- purpose as "School fees — " (HAD-81), so a cheque appears on the calendar
-- naming nobody. For an obligation whose whole risk is a bounced cheque, "you
-- owe 12,000 to someone on the 12th" is barely better than not showing it.
--
-- Validation stays at the persistence boundary so every writer gets the same
-- rule — the editor, a future import, a hand-written insert. `app/loans/
-- actions.ts` translates these constraint names into sentences.
--
-- Codex proposed this in PR #14 with bare `add constraint`. Rewritten to the
-- drop-then-add form 0004 established, so re-running a migration is not an
-- error — the repo's migrations are expected to be replayable against a fresh
-- project, and one that fails halfway leaves the schema in a state nobody
-- described.
-- ---------------------------------------------------------------------------

alter table public.school_fees
  drop constraint if exists school_fees_child_check;
alter table public.school_fees
  add constraint school_fees_child_check check (length(trim(child)) > 0);

alter table public.school_fees
  drop constraint if exists school_fees_school_check;
alter table public.school_fees
  add constraint school_fees_school_check check (length(trim(school)) > 0);

alter table public.school_fees
  drop constraint if exists school_fees_term_check;
alter table public.school_fees
  add constraint school_fees_term_check check (length(trim(term)) > 0);

/*
 * The defaults have to go with the constraints.
 *
 * `child`, `school` and `term` were `not null default ''`, and '' now fails the
 * checks above — so the defaults describe a row the table refuses to store.
 * Leaving them is a trap: `insert into school_fees (user_id, due_date)` looks
 * like it should work, reads as supported, and fails. That is precisely how the
 * SEC-1 probe came to be written the wrong way.
 *
 * Dropping the default makes the omission a missing-column error at the point
 * of the mistake, rather than a check violation two layers away.
 */
alter table public.school_fees
  alter column child drop default,
  alter column school drop default,
  alter column term drop default;
