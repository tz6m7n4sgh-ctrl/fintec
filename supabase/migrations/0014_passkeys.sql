-- =====================================================================
-- 0014 — WebAuthn passkeys (US-40 / FR-K2 / BR-8 / R-4)
--
-- Two tables, and the second one is the security of the first.
--
-- ## Why challenges are stored rather than signed
--
-- A WebAuthn ceremony is: server issues a random challenge, authenticator
-- signs it, server checks the signature covers *that* challenge. If the
-- challenge can be replayed, a captured assertion signs in forever.
--
-- A signed/stateless challenge (an HMAC of a timestamp) is replayable until it
-- expires — there is nothing to consume. So challenges are rows, and verifying
-- deletes the row. One use, and the delete is the proof it was unused.
--
-- ## Why the challenge table has no RLS policy at all
--
-- It is written and read only by the Edge Function under the service-role key,
-- during a ceremony where the user is by definition **not signed in** — there
-- is no `auth.uid()` to key a policy to. RLS is enabled with no policies, which
-- denies every ordinary client outright. That is the intended state, not an
-- oversight: nothing but the function should ever see a challenge.
-- =====================================================================

create table public.passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- The authenticator's own id for this credential, base64url. Unique
  -- globally, not per user: the same physical key must not be registrable
  -- twice, and a collision across accounts would let one user's assertion be
  -- checked against another's public key.
  credential_id text not null unique,
  public_key    text not null,

  /*
   * The authenticator's signature counter. It must strictly increase; a value
   * that goes backwards means the credential has been cloned, and that is the
   * one thing a passkey is supposed to make impossible. Some authenticators
   * (notably Apple's) always report 0, which is why the check is "not lower"
   * rather than "higher" — see verifyAssertion in the Edge Function.
   */
  counter       bigint not null default 0,

  -- So the user can tell two passkeys apart when revoking one.
  device_label  text not null default '',
  transports    text[] not null default '{}',

  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.passkeys is
  'WebAuthn credentials (US-40). A passkey is never the sole factor — email and '
  'password sign-in always remains as recovery (R-4).';

create index passkeys_user on public.passkeys (user_id);

alter table public.passkeys enable row level security;
alter table public.passkeys force row level security;

/*
 * The user owns their own passkeys and nothing else.
 *
 * No update policy, deliberately. The only mutable column is `counter`, and it
 * is written by the Edge Function during authentication — when the user is not
 * signed in and has no `auth.uid()`. Letting a signed-in client update it would
 * let somebody rewind their own counter and disable clone detection on their
 * own credential, which is the one check this table exists to support.
 */
create policy passkeys_select_own on public.passkeys
  for select using ((select auth.uid()) = user_id);

create policy passkeys_insert_own on public.passkeys
  for insert with check ((select auth.uid()) = user_id);

create policy passkeys_delete_own on public.passkeys
  for delete using ((select auth.uid()) = user_id);

create trigger set_updated_at before update on public.passkeys
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Single-use challenges
-- ---------------------------------------------------------------------

create table public.webauthn_challenges (
  id           uuid primary key default gen_random_uuid(),
  challenge    text not null unique,
  -- Null during authentication: a discoverable credential does not name its
  -- user until the authenticator answers.
  user_id      uuid references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('registration', 'authentication')),
  /*
   * Two minutes. Long enough for a user to find their fingerprint reader,
   * short enough that a challenge captured in transit is worthless by the time
   * anyone could use it.
   */
  expires_at   timestamptz not null default now() + interval '2 minutes',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.webauthn_challenges is
  'Single-use WebAuthn challenges. Consumed by deletion during verification, so '
  'a replayed assertion finds nothing to match against.';

create index webauthn_challenges_expiry on public.webauthn_challenges (expires_at);

-- Enabled with NO policies: every ordinary client is denied. Only the Edge
-- Function, under service-role, ever touches this table. See the header.
alter table public.webauthn_challenges enable row level security;

create trigger set_updated_at before update on public.webauthn_challenges
  for each row execute function public.set_updated_at();

/*
 * Expired challenges are rubbish, and rubbish that accumulates in a table
 * keyed on a unique random string eventually collides with nothing but still
 * costs an index. Cleared on every issue rather than by a scheduled job — one
 * fewer moving part, and the volume is per-sign-in.
 */
create or replace function public.purge_expired_webauthn_challenges()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.webauthn_challenges where expires_at < now();
$$;

revoke all on function public.purge_expired_webauthn_challenges() from public, anon, authenticated;
