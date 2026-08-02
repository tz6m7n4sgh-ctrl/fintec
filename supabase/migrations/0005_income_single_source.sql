-- ---------------------------------------------------------------------------
-- HAD-80 — one source for "how much income keeps arriving".
--
-- `profiles.monthly_side_income` and `income_streams` both answered that
-- question, and only the first reached `runway()`. They agreed for exactly one
-- reason: both were zero in the §11 reference data. Once US-27 made streams
-- editable the two could diverge in practice — add a 5,000 freelance stream,
-- see it in the table, watch runway not move.
--
-- Option A on the issue, and the reason it wins: `income_streams` already
-- carries everything the single number did *and* a date window, so
-- `incomeAfterLastDay()` can answer "what still arrives once the salary stops"
-- rather than trusting the user to have subtracted the salary themselves.
-- Keeping the column as a fallback was option C; that is still two sources,
-- with a precedence rule nobody can see on screen.
--
-- The column is dropped rather than left inert. An unused column that once
-- drove a headline figure is an invitation to wire it back up.
-- ---------------------------------------------------------------------------

-- Anyone who had entered a side-income figure keeps it — as the stream it
-- should always have been. Without this the drop silently zeroes their runway
-- input, which is the conservative direction but still a number changing
-- underneath them with no record of why.
--
-- `end_date` is deliberately null: a side income the user expected to continue
-- during the job search does not stop on a known date. `start_date` likewise —
-- the figure was always "what arrives from now on".
insert into public.income_streams (user_id, name, amount, frequency, active)
select p.id,
       'Side income',
       p.monthly_side_income,
       'monthly',
       true
from public.profiles p
where p.monthly_side_income > 0
  and not exists (
    -- Idempotence. Re-running the migration must not give anybody two copies of
    -- their side income, which would overstate runway rather than understate it.
    select 1 from public.income_streams s
    where s.user_id = p.id and s.name = 'Side income'
  );

alter table public.profiles drop column if exists monthly_side_income;
