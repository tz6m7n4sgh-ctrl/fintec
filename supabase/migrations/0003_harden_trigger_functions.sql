-- These are trigger / event-trigger functions. Postgres fires them; clients never
-- call them, so nothing needs EXECUTE. Revoking closes the /rest/v1/rpc surface
-- flagged by the Supabase security linter (lints 0028/0029).
--
-- Verified after applying: the updated_at trigger still fires (a trigger does not
-- consult EXECUTE grants at fire time), and the security advisor reports zero lints.
--
-- rls_auto_enable() is a pre-existing event trigger in this project that
-- auto-enables RLS on newly created public tables. It is left in place — it is a
-- guardrail, not a liability — but its RPC exposure is revoked too.
revoke all on function public.set_updated_at() from anon, authenticated, public;
revoke all on function public.rls_auto_enable() from anon, authenticated, public;

comment on function public.set_updated_at is
  'Trigger function maintaining updated_at. Not callable via RPC by design.';
