-- ---------------------------------------------------------------------------
-- US-31 support / §8 — the action plan can be ticked (HAD-85).
--
-- `checklist_items` was loaded and rendered and written by nothing, so the plan
-- showed whatever `done` state the seed set and no item could ever be ticked
-- off. For a screen whose whole purpose is "here is what you must not miss",
-- that is close to useless: the user tracks it elsewhere and the app stops
-- reflecting reality.
--
-- ## Why only the done state is stored
--
-- The table was designed for per-user rows carrying their own title and detail.
-- Storing them that way is the obvious move and it is wrong here, for a reason
-- specific to what this checklist *is*.
--
-- The items are the §8 action plan — legal and procedural steps, not user
-- content. `ck-7` reads "Claim ILOE at iloe.ae — HARD DEADLINE". If a user's
-- copy were frozen at first sign-in, a later correction to that wording, or to
-- the deadline behind it, would never reach them. They would keep seeing the
-- 2026 text about a rule that had changed, on the screen that exists to stop
-- them missing a statutory deadline.
--
-- So the list stays derived from `SEED_CHECKLIST` and travels with the app.
-- Only the boolean is per-user, keyed by the item's stable identifier.
-- ---------------------------------------------------------------------------

alter table public.checklist_items
  add column if not exists seed_key text;

comment on column public.checklist_items.seed_key is
  'Stable identifier of the §8 checklist item this row records the done state for (e.g. ck-7). The item text lives in SEED_CHECKLIST and travels with the app, so a corrected deadline reaches every user; only `done` is per-user.';

-- `title` was `not null`, which forced a row to carry text it no longer owns.
alter table public.checklist_items
  alter column title drop not null;

-- One done-state per item per user. Without this a double-click could create
-- two rows for one item and which one wins would depend on row order — the
-- user ticks something off and it comes back.
create unique index if not exists checklist_items_one_per_seed_key
  on public.checklist_items (user_id, seed_key)
  where seed_key is not null;
