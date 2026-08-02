-- ---------------------------------------------------------------------------
-- HAD-76 — `storage_path` holds the object key, and the database says so.
--
-- The storage policies in 0002 key on the first path segment:
--
--   (storage.foldername(name))[1] = auth.uid()::text
--
-- so the object key must be `<uid>/<file>`. Prefix it with the bucket name and
-- segment 1 becomes the literal 'statements', which equals no uid, and every
-- read and write is refused for everybody — the owner included.
--
-- It fails closed, so this was never an exposure. It fails *silently and
-- universally*, which is worse to diagnose: the natural conclusion is "the
-- storage policies are broken", and they are not.
--
-- The wrong convention had already spread from a comment into the seed data
-- and into the SEC-1 probe before anything was built on it. Documentation was
-- evidently not enough, so this makes the wrong value unstorable.
-- ---------------------------------------------------------------------------

comment on column public.statement_uploads.storage_path is
  'Object key inside the `statements` bucket: `<uid>/<file>`. NOT bucket-qualified — pass this value straight to supabase.storage.from(''statements''), and see 0002 for why a `statements/` prefix breaks every policy.';

-- Namespaced by the owning user, matching what the storage policy demands.
-- Deeper nesting (`<uid>/2026/jan.pdf`) still satisfies this; only the first
-- segment is pinned, which is the only segment the policy reads.
--
-- This is the load-bearing half: a row can no longer point at an object that
-- storage would refuse, so the table and the bucket cannot disagree about where
-- a file lives.
alter table public.statement_uploads
  drop constraint if exists statement_uploads_path_is_object_key;
alter table public.statement_uploads
  add constraint statement_uploads_path_is_object_key
    check (storage_path like user_id::text || '/%');
