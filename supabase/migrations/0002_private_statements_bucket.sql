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

-- Objects are namespaced by user id: statements/<uid>/<file>. Each policy checks
-- the first path segment against auth.uid(), so one user can never read,
-- overwrite or delete another user's statement files.
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
