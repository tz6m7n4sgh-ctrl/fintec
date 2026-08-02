-- Private bucket for uploaded bank statements (NFR-1). Never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'statements', 'statements', false, 26214400,
  array['application/pdf','text/csv','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are namespaced by user id. The object key is `<uid>/<file>` — the
-- path *inside* the bucket, which never repeats the bucket name. In Supabase
-- Storage `bucket_id` and `name` are separate columns.
--
-- This comment previously said `statements/<uid>/<file>`, and that was not a
-- typo with no consequence (HAD-76). Each policy below tests the first path
-- segment against auth.uid():
--
--   <uid>/payslip.pdf              foldername[1] = <uid>          matches
--   statements/<uid>/payslip.pdf   foldername[1] = 'statements'   never matches
--
-- With the bucket name prefixed, every select, insert, update and delete is
-- refused — for every user, including the owner. It fails closed, so nothing
-- leaks; it fails *silently and universally*, and the obvious diagnosis points
-- at these policies, which are correct. The bug would be in the caller, taught
-- by this comment.
--
-- `statement_uploads.storage_path` stores the same object key, and 0006 adds a
-- constraint so a row cannot name an object the policy would refuse.
create policy statements_select on storage.objects
  for select to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy statements_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy statements_update on storage.objects
  for update to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy statements_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'statements' and (storage.foldername(name))[1] = (select auth.uid())::text);
