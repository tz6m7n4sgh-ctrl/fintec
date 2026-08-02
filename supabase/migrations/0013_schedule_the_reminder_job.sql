-- =====================================================================
-- 0013 — run the reminder job once a day, at Dubai midnight
--
-- ## Why the job lives in Supabase
--
-- It reads every user's payments, which needs the service-role key. That key
-- bypasses row-level security, and SEC-3 established that this project holds it
-- NOWHERE — not in the repository, not in GitHub secrets, not in the
-- deployment environment. Supabase injects it into an Edge Function at
-- runtime, so it exists only where it must. Running the same job from GitHub
-- Actions would have meant putting it in a CI secret store, which is exactly
-- the property this project has kept all along.
--
-- ## Why the credentials are in Vault rather than in this file
--
-- A migration is a file in a public repository. `net.http_post` needs a bearer
-- token to call the function, and hardcoding one here would put a credential in
-- git — the single thing `scripts/secret-guard.mjs` exists to prevent, in the
-- one file type it does not scan.
--
-- So they come from Vault, and the function below raises rather than proceeding
-- if they are missing. A scheduled job that silently does nothing is worse than
-- one that fails: `cron.job_run_details` records the exception, where a no-op
-- looks identical to "no reminders were due".
--
-- ## Setup this migration cannot do for you
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/send-reminders',
--                              'reminder_job_url');
--   select vault.create_secret('<service-role key>', 'reminder_job_token');
--
-- Both are set in the Supabase dashboard (Database → Vault) or by running the
-- above as an admin. Neither belongs in this repository.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

create or replace function public.trigger_reminder_job()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_url   text;
  job_token text;
  request_id bigint;
begin
  select decrypted_secret into job_url
    from vault.decrypted_secrets where name = 'reminder_job_url';
  select decrypted_secret into job_token
    from vault.decrypted_secrets where name = 'reminder_job_token';

  -- Loud, not silent. A missing secret must appear in cron.job_run_details as
  -- a failure; a job that quietly returns null is indistinguishable from a day
  -- on which no reminder was due.
  if job_url is null or job_token is null then
    raise exception
      'Reminder job is not configured: set the vault secrets reminder_job_url and reminder_job_token. No reminders were sent.';
  end if;

  select net.http_post(
    url     := job_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || job_token
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$$;

comment on function public.trigger_reminder_job is
  'Invokes the send-reminders Edge Function (US-16). Credentials come from '
  'Vault so no token is ever written to a migration in the repository.';

-- Nobody signs in as a role that should be able to fire the whole mailout.
-- `security definer` above means the grant is the only gate, so it is closed.
revoke all on function public.trigger_reminder_job() from public, anon, authenticated;

/*
 * 20:00 UTC is 00:00 Asia/Dubai. Written in UTC because pg_cron schedules in
 * the database's timezone and hardcoding a local hour would drift the day this
 * project is deployed to a differently-configured instance. The UAE observes no
 * daylight saving, so the offset is a constant +04:00 and this needs no
 * seasonal adjustment — unlike almost every other timezone this could have been.
 */
select cron.unschedule('send-reminders')
  where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule(
  'send-reminders',
  '0 20 * * *',
  $$select public.trigger_reminder_job()$$
);
