-- ---------------------------------------------------------------------------
-- SEC-1 — cross-tenant isolation, proven rather than inspected.
--
-- HAD-56 shipped RLS on all 13 tables and was verified by *reading the schema*.
-- This file is the thing that was missing: a test that fails when isolation
-- breaks. `0001_init.sql` generates 52 policies from a single loop, so one
-- mistake in that loop is a mistake in all of them at once.
--
-- Runs against a real Supabase database, not a stand-in. That is deliberate:
-- two defects on this project (a base-path mismatch and a missing-compression
-- TTI measurement) came from testing against a model of the host instead of
-- the host, and both produced plausible numbers that were believed.
--
-- NON-DESTRUCTIVE. Everything happens inside one transaction that is rolled
-- back at the end, including the deliberate breakages in phase F. Safe to run
-- against production, which is the only place the real policies exist.
--
--   npm run test:rls
--
-- Exits non-zero if any check fails. Deliberately contains no psql
-- meta-commands, so it runs unchanged through psql, the Supabase SQL editor,
-- or any other client — the harness should never be the reason a security
-- check could not be run.
-- ---------------------------------------------------------------------------

begin;

-- Two throwaway users. `aaaaaaaa…` is the attacker; `bbbbbbbb…` is the victim
-- whose rows must stay invisible and intact throughout.
insert into auth.users (id, instance_id, aud, role, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@sec1.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@sec1.test');

create temp table sec1 (
  seq     serial,
  phase   text,
  check_name    text,
  verdict text,   -- 'pass' | 'FAIL' | 'INCONCLUSIVE' | 'info'
  detail  text
) on commit drop;

-- Every table the policy loop in 0001_init.sql covers. Kept as a literal list
-- rather than read from pg_class on purpose: a new table that nobody added
-- here should be a visible omission, not silently excluded from the sweep.
create temp table sec1_tables (t text) on commit drop;
insert into sec1_tables values
  ('profiles'),('income_streams'),('budget_categories'),('debts'),('school_fees'),
  ('bank_accounts'),('scheduled_payments'),('statement_uploads'),('transactions'),
  ('category_rules'),('checklist_items'),('notification_prefs'),('notification_log');

-- Both temp tables outlive the role switches below, so anon and authenticated
-- must be able to reach them. Without these grants the later phases die with a
-- permission error that looks nothing like the thing being tested — a failure
-- mode that would read as "isolation broken" when it means "harness broken".
grant all on sec1, sec1_tables to anon, authenticated;
grant usage, select on sequence sec1_seq_seq to anon, authenticated;


-- ===========================================================================
-- Phase A — structural. Is the policy loop's output actually uniform?
-- ===========================================================================

insert into sec1 (phase, check_name, verdict, detail)
select 'A structure', 'every listed table exists with RLS enabled and forced',
       case when count(*) = (select count(*) from sec1_tables) then 'pass' else 'FAIL' end,
       count(*) || ' of ' || (select count(*) from sec1_tables)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in (select t from sec1_tables)
  and c.relrowsecurity and c.relforcerowsecurity;

-- `force` is the half that is easy to miss: without it the table owner — which
-- is what a service-role or migration connection acts as — skips RLS entirely.
insert into sec1 (phase, check_name, verdict, detail)
select 'A structure', 'four per-command policies on every table',
       case when count(*) = 0 then 'pass' else 'FAIL' end,
       coalesce(string_agg(relname || '=' || n_pol, ', '), 'all tables have exactly 4')
from (
  select c.relname, (select count(*) from pg_policy p where p.polrelid = c.oid) as n_pol
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (select t from sec1_tables)
) x
where n_pol <> 4;

-- One predicate shape across all 52. A second shape means someone hand-edited
-- a policy, which is exactly the change this file exists to catch.
insert into sec1 (phase, check_name, verdict, detail)
select 'A structure', 'single policy predicate shape across all 52 policies',
       case when count(*) = 1 then 'pass' else 'FAIL' end,
       count(*) || ' shape(s): ' || string_agg(expr, '  ||  ')
from (
  select distinct replace(pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid), ' ', '') as expr
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (select t from sec1_tables)
) y;


-- ===========================================================================
-- Phase B — seed one row per table for each user, as a privileged role.
-- ===========================================================================

do $seed$
declare u uuid; cat uuid;
begin
  foreach u in array array['aaaaaaaa-0000-4000-8000-000000000001'::uuid,
                           'bbbbbbbb-0000-4000-8000-000000000002'::uuid]
  loop
    insert into public.profiles (user_id) values (u);
    insert into public.notification_prefs (user_id) values (u);
    insert into public.bank_accounts (user_id, bank_name) values (u, 'Probe Bank');
    insert into public.budget_categories (user_id, name) values (u, 'Probe Category') returning id into cat;
    insert into public.category_rules (user_id, keyword, category_id) values (u, 'probe', cat);
    insert into public.checklist_items (user_id, title) values (u, 'Probe item');
    insert into public.income_streams (user_id, name) values (u, 'Probe salary');
    insert into public.notification_log (user_id, channel) values (u, 'email');
    insert into public.debts (user_id, type, name) values (u, 'mortgage', 'Probe mortgage');
    insert into public.school_fees (user_id, child, school, term, due_date)
      values (u, 'Probe child', 'Probe school', 'Probe term', date '2026-09-01');
    -- included_in_budget must be false here: the G-1 companion constraint
    -- requires an in-budget payment to name its budget line, and a seed that
    -- trips a check constraint would look like an RLS failure.
    insert into public.scheduled_payments (user_id, due_date, payee, type, included_in_budget)
      values (u, date '2026-09-01', 'Probe payee', 'cheque', false);
    insert into public.statement_uploads (user_id, file_name, storage_path, file_type)
      values (u, 'probe.pdf', 'statements/' || u::text || '/probe.pdf', 'pdf');
    insert into public.transactions (user_id, date, amount, direction, dedupe_hash)
      values (u, date '2026-08-01', 1234.56, 'debit', 'probe-' || u::text);
  end loop;
end
$seed$;


-- ===========================================================================
-- Phase C — read isolation, as user A, across all 13 tables.
--
-- The assertion is that B's row is INVISIBLE, not that A's row is visible.
-- "I can see my own data" passes with RLS switched off entirely, which is why
-- it is not the test.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

do $read$
declare r record; total int; mine int;
begin
  for r in select t from sec1_tables order by t loop
    execute format('select count(*), count(*) filter (where user_id = auth.uid()) from public.%I', r.t)
      into total, mine;
    insert into sec1 (phase, check_name, verdict, detail) values (
      'C read', r.t,
      case when total = 1 and mine = 1 then 'pass'
           when total > mine then 'FAIL'
           else 'INCONCLUSIVE' end,
      case when total = 1 and mine = 1 then 'B''s row invisible'
           when total > mine then 'LEAK — ' || (total - mine) || ' of B''s row(s) visible'
           else 'expected 1 own row, saw ' || total || ' total / ' || mine || ' own' end);
  end loop;
end
$read$;


-- ===========================================================================
-- Phase D — write isolation, as user A, across all 13 tables.
--
-- Four distinct policies, four distinct failure modes:
--   insert  — can A create a row owned by B?              (WITH CHECK)
--   donate  — can A reassign its own row to B?            (WITH CHECK on update)
--   update  — can A modify B's row?                       (USING on update)
--   delete  — can A remove B's row?                       (USING on delete)
--
-- update and delete fail as a silent 0-row no-op rather than an error. That
-- distinction matters: to a caller checking only for an exception, a no-op
-- reads as success.
-- ===========================================================================

do $write$
declare
  r record;
  cols text;
  sel  text;
  n int;
  b constant text := 'bbbbbbbb-0000-4000-8000-000000000002';
begin
  for r in select t from sec1_tables order by t loop

    -- Build an insert that clones A's own row but stamps B as the owner.
    -- Column list is derived rather than hardcoded so a new column cannot
    -- quietly drop a table out of this phase.
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
           string_agg(case when column_name = 'user_id' then quote_literal(b) || '::uuid'
                           else quote_ident(column_name) end, ', ' order by ordinal_position)
      into cols, sel
    from information_schema.columns
    where table_schema = 'public' and table_name = r.t
      and column_name not in ('id', 'created_at', 'updated_at');

    -- 1. insert a row owned by B
    begin
      execute format('insert into public.%I (%s) select %s from public.%I where user_id = auth.uid()',
                     r.t, cols, sel, r.t);
      get diagnostics n = row_count;
      insert into sec1 (phase, check_name, verdict, detail)
        values ('D insert', r.t, 'FAIL', 'A planted ' || n || ' row(s) into B''s account');
    exception
      when insufficient_privilege then   -- 42501, the RLS refusal
        insert into sec1 (phase, check_name, verdict, detail)
          values ('D insert', r.t, 'pass', 'refused by WITH CHECK');
      when others then
        -- Anything else (a unique index, a check constraint) means this table
        -- was never actually tested. Reported as INCONCLUSIVE rather than
        -- counted as a pass — a refusal for the wrong reason is not a proof.
        insert into sec1 (phase, check_name, verdict, detail)
          values ('D insert', r.t, 'INCONCLUSIVE',
                  'blocked by ' || sqlstate || ' (' || sqlerrm || '), not by RLS');
    end;

    -- 2. donate A's own row to B
    begin
      execute format('update public.%I set user_id = %L::uuid where user_id = auth.uid()', r.t, b);
      get diagnostics n = row_count;
      insert into sec1 (phase, check_name, verdict, detail)
        values ('D donate', r.t,
                case when n = 0 then 'pass' else 'FAIL' end,
                case when n = 0 then 'no rows reassigned'
                     else 'A pushed ' || n || ' row(s) into B''s account' end);
    exception when insufficient_privilege then
      insert into sec1 (phase, check_name, verdict, detail)
        values ('D donate', r.t, 'pass', 'refused by WITH CHECK');
    end;

    -- 3. update B's row
    execute format('update public.%I set updated_at = now() where user_id = %L::uuid', r.t, b);
    get diagnostics n = row_count;
    insert into sec1 (phase, check_name, verdict, detail)
      values ('D update', r.t, case when n = 0 then 'pass' else 'FAIL' end, n || ' row(s) affected');

    -- 4. delete B's row
    execute format('delete from public.%I where user_id = %L::uuid', r.t, b);
    get diagnostics n = row_count;
    insert into sec1 (phase, check_name, verdict, detail)
      values ('D delete', r.t, case when n = 0 then 'pass' else 'FAIL' end, n || ' row(s) affected');

  end loop;
end
$write$;

reset role;

-- B must still have exactly one row in every table. If phase D deleted or
-- stole anything, this is where it shows up as damage rather than as a count.
do $survive$
declare r record; n int; bad text := '';
begin
  for r in select t from sec1_tables order by t loop
    execute format('select count(*) from public.%I where user_id = %L::uuid',
                   r.t, 'bbbbbbbb-0000-4000-8000-000000000002') into n;
    if n <> 1 then bad := bad || r.t || '=' || n || ' '; end if;
  end loop;
  insert into sec1 (phase, check_name, verdict, detail)
    values ('D survival', 'B''s rows intact after every attempt',
            case when bad = '' then 'pass' else 'FAIL' end,
            case when bad = '' then 'all 13 tables still hold B''s row' else bad end);
end
$survive$;


-- ===========================================================================
-- Phase E — the anon role.
--
-- Signed out, the app deliberately renders the §11 reference dataset. A leak
-- here would therefore be invisible in the UI: real figures would look exactly
-- like the seed. This is the one phase whose failure a human could not spot.
-- ===========================================================================

set local role anon;

do $anon$
declare r record; n int; total int := 0; leaked text := '';
begin
  for r in select t from sec1_tables order by t loop
    execute format('select count(*) from public.%I', r.t) into n;
    total := total + n;
    if n > 0 then leaked := leaked || r.t || '(' || n || ') '; end if;
  end loop;
  insert into sec1 (phase, check_name, verdict, detail)
    values ('E anon', 'rows readable while signed out',
            case when total = 0 then 'pass' else 'FAIL' end,
            case when total = 0 then '0 rows across all 13 tables' else 'LEAK: ' || leaked end);
end
$anon$;

reset role;


-- ===========================================================================
-- Phase F — private storage. Bank statements are the most sensitive thing the
-- app will ever hold, and they live outside the 13 tables.
--
-- The object `name` is the path *inside* the bucket, so it is `<uid>/file.pdf`
-- and never `statements/<uid>/file.pdf`. That matters: with the bucket name
-- prefixed, `(storage.foldername(name))[1]` is the literal 'statements' and
-- every policy silently stops matching. The first version of this phase made
-- exactly that mistake and every check "passed" — because the object was
-- invisible to everyone, not just to A.
--
-- Hence the CONTROL check below. Without it, a policy that refuses all writes
-- is indistinguishable from a policy that refuses the right ones.
-- ===========================================================================

insert into storage.objects (bucket_id, name, owner)
values ('statements', 'bbbbbbbb-0000-4000-8000-000000000002/payslip.pdf',
        'bbbbbbbb-0000-4000-8000-000000000002');

insert into sec1 (phase, check_name, verdict, detail)
select 'F storage', 'statements bucket is private',
       case when not public then 'pass' else 'FAIL' end, 'public=' || public::text
from storage.buckets where id = 'statements';

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

insert into sec1 (phase, check_name, verdict, detail)
select 'F storage', 'A can list B''s statement files',
       case when count(*) = 0 then 'pass' else 'FAIL' end,
       count(*) || ' object(s) visible to A'
from storage.objects where bucket_id = 'statements';

do $storage$
begin
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('statements', 'aaaaaaaa-0000-4000-8000-000000000001/mine.pdf',
            'aaaaaaaa-0000-4000-8000-000000000001');
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'CONTROL — A can write to its own folder', 'pass',
              'accepted, so the policy is matching rather than refusing everyone');
  exception when others then
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'CONTROL — A can write to its own folder', 'FAIL',
              'refused ' || sqlstate || ' — the policy blocks every user, so the '
              'isolation results below prove nothing');
  end;

  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('statements', 'bbbbbbbb-0000-4000-8000-000000000002/planted.pdf',
            'aaaaaaaa-0000-4000-8000-000000000001');
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'A can write into B''s folder', 'FAIL', 'insert succeeded');
  exception when insufficient_privilege then
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'A can write into B''s folder', 'pass', 'refused by policy');
  end;

  -- A `../` in the key never escapes: foldername() splits on '/', so segment 1
  -- is still A's uid whatever follows it.
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('statements',
            'aaaaaaaa-0000-4000-8000-000000000001/../bbbbbbbb-0000-4000-8000-000000000002/x.pdf',
            'aaaaaaaa-0000-4000-8000-000000000001');
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'traversal-shaped key stays in A''s namespace', 'pass',
              'accepted, but segment 1 is still A''s uid');
  exception when insufficient_privilege then
    insert into sec1 (phase, check_name, verdict, detail)
      values ('F storage', 'traversal-shaped key stays in A''s namespace', 'pass', 'refused by policy');
  end;

  update storage.objects set owner = 'aaaaaaaa-0000-4000-8000-000000000001'
    where name = 'bbbbbbbb-0000-4000-8000-000000000002/payslip.pdf';
  insert into sec1 (phase, check_name, verdict, detail)
  select 'F storage', 'A can overwrite B''s file',
         case when count(*) = 0 then 'pass' else 'FAIL' end, count(*) || ' row(s) updated'
  from storage.objects
  where owner = 'aaaaaaaa-0000-4000-8000-000000000001' and name like 'bbbbbbbb%';
end
$storage$;

reset role;

-- Not covered here, deliberately: deleting another user's object. A trigger
-- (storage.protect_delete) refuses direct DELETE on storage.objects and tells
-- you to use the Storage API, so a SQL-level probe would prove nothing about
-- the delete policy. That case belongs to the API-level pass in HAD-68.
insert into sec1 (phase, check_name, verdict, detail) values
  ('F storage', 'delete isolation', 'info',
   'not testable from SQL — storage.protect_delete blocks direct DELETE; covered by HAD-68');


-- ===========================================================================
-- Phase G — negative controls. Does this file actually detect a break?
--
-- A green test that cannot go red proves nothing. The first version of this
-- phase dropped a policy and asserted a leak — which never fires, because a
-- table with RLS enabled and NO policy denies everything. Dropping a policy
-- makes the database *more* restrictive. The two scenarios below are the real
-- failure modes.
--
-- Both are explicitly reverted and the revert is asserted, on top of the outer
-- rollback. Two independent guarantees, because this is the one place in the
-- repo that deliberately switches protection off.
-- ===========================================================================

-- G1 — RLS switched off on a table.
alter table public.debts disable row level security;
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
insert into sec1 (phase, check_name, verdict, detail)
select 'G control', 'detects RLS disabled on a table',
       case when count(*) > (select count(*) from public.debts where user_id = auth.uid())
            then 'pass' else 'FAIL' end,
       'A sees ' || count(*) || ' row(s) when RLS is off (expected: more than its own)'
from public.debts;
reset role;
alter table public.debts enable row level security;

-- G2 — a policy predicate weakened to `using (true)`. This is the shape a
-- careless edit to the loop produces, and the one that reads as correct.
drop policy debts_select on public.debts;
create policy debts_select on public.debts for select to authenticated using (true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
insert into sec1 (phase, check_name, verdict, detail)
select 'G control', 'detects a policy weakened to using(true)',
       case when count(*) > 1 then 'pass' else 'FAIL' end,
       'A sees ' || count(*) || ' row(s) through the weakened policy (expected: 2)'
from public.debts;
reset role;

-- Restore it. The outer rollback would undo this anyway, but relying on that
-- would mean the file leaves the schema weakened for anyone who runs the
-- phases individually — and "the cleanup is implicit" is not a property worth
-- having in the one file that exists to prove the policies are intact.
drop policy debts_select on public.debts;
create policy debts_select on public.debts for select to authenticated
  using ((select auth.uid()) = user_id);

insert into sec1 (phase, check_name, verdict, detail)
select 'G control', 'schema restored after both controls',
       case when count(*) = 4 then 'pass' else 'FAIL' end,
       count(*) || ' policies on debts, RLS enabled=' ||
       (select c.relrowsecurity::text from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'debts')
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'debts';


-- ===========================================================================
-- Report, then fail the run if anything is not a pass.
-- ===========================================================================

select phase, check_name, verdict, detail from sec1 order by seq;

select
  count(*) filter (where verdict = 'pass')         as passed,
  count(*) filter (where verdict = 'FAIL')         as failed,
  count(*) filter (where verdict = 'INCONCLUSIVE') as inconclusive
from sec1;

do $verdict$
declare
  n_fail int;
  n_inc  int;
  msg    text;   -- not `detail`: that is also a column of sec1, and plpgsql
                 -- resolves the ambiguity by refusing to run.
begin
  select count(*) filter (where verdict = 'FAIL'),
         count(*) filter (where verdict = 'INCONCLUSIVE')
    into n_fail, n_inc from sec1;

  if n_fail > 0 then
    select string_agg(phase || ' / ' || check_name || ': ' || sec1.detail, E'\n  ')
      into msg from sec1 where verdict = 'FAIL';
    raise exception E'SEC-1 FAILED — % check(s) did not hold:\n  %', n_fail, msg;
  end if;

  -- Inconclusive is not success. A table that could not be exercised is a
  -- table with no evidence behind it, and silence there is how this project
  -- has been wrong before.
  if n_inc > 0 then
    select string_agg(phase || ' / ' || check_name || ': ' || sec1.detail, E'\n  ')
      into msg from sec1 where verdict = 'INCONCLUSIVE';
    raise exception E'SEC-1 INCONCLUSIVE — % check(s) proved nothing:\n  %', n_inc, msg;
  end if;

  raise notice 'SEC-1 passed: cross-tenant isolation holds, and the probe is proven able to detect a break.';
end
$verdict$;

rollback;
