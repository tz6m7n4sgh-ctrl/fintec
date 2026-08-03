import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  authenticationOptions,
  deviceLabelFor,
  challengeIsFresh,
  registrationOptions,
  relyingPartyFrom,
  verifyAssertion,
  verifyRegistration,
  type RelyingParty,
} from './_shared/passkeys.ts';

/**
 * The WebAuthn ceremony, and the one thing in this project that can mint a
 * session (US-40 / FR-K2 / R-4 / HAD-6).
 *
 * ## Why it is here and not in the Next app
 *
 * Sign-in with a passkey has to happen while the user is signed *out*. There is
 * no `auth.uid()`, so row-level security has nothing to key on, and the
 * challenge table therefore has RLS enabled with no policies at all — every
 * ordinary client is denied outright. Only the service-role key can read it,
 * and SEC-3 established that this project keeps that key nowhere: not in the
 * repository, not in CI, not in the deployment environment. Inside an Edge
 * Function Supabase injects it at runtime. That is the whole reason for this
 * file's location, and it is the same reasoning as `send-reminders`.
 *
 * ## What this function is
 *
 * It is an account-takeover primitive with four locks on it. It can issue a
 * session for any user id, so the only thing standing between a caller and
 * somebody else's finances is that the user id is never taken from the caller:
 *
 *   1. `signin-verify` looks the credential up by the id the *authenticator*
 *      returned, and uses that row's `user_id`. The request body has no field
 *      that names an account, so there is nothing to tamper with.
 *   2. The challenge is consumed by `delete … returning`, which is atomic. Two
 *      concurrent attempts to spend one challenge — a replay racing the
 *      original — cannot both find a row.
 *   3. Origin and RP ID come from `PASSKEY_RP_ID` / `PASSKEY_ORIGINS`. Reading
 *      them from the request's `Origin` header would be convenient, would work
 *      in every test, and would let any website relay a ceremony.
 *   4. The signature counter must move forward. See `counterAccepted`.
 *
 * `verify_jwt` stays on, so Supabase's gateway checks the bearer before any of
 * this runs. For the two sign-in steps that bearer is the publishable key,
 * which is public by design and proves nothing — the ceremony is the proof. For
 * the two registration steps the bearer must be a real user's access token, and
 * the user id comes from resolving it, never from the body.
 *
 * ## How a session is minted
 *
 * `admin.generateLink({ type: 'magiclink' })` produces a hashed token without
 * sending anything, and exchanging it through `verifyOtp` yields a normal
 * session. It is roundabout, and the alternative is worse: signing a JWT by
 * hand would mean this function holding the project's JWT secret and
 * reimplementing claims that Supabase changes on its own schedule. This way the
 * auth server issues the session, exactly as it does for a password sign-in.
 *
 * The tokens are returned to the caller — which is `app/auth/passkey-actions.ts`
 * on the server, never the browser. They go into the session cookie on the
 * response the browser is already receiving, so they never enter client
 * JavaScript at all.
 */

type Step = 'register-options' | 'register-verify' | 'signin-options' | 'signin-verify';

interface Body {
  step?: Step;
  response?: unknown;
  challenge?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** The message a caller sees. Deliberately not the internal one. */
const fail = (message: string, status: number) => json({ error: message }, status);

function admin(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not available.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function relyingParty(): RelyingParty {
  return relyingPartyFrom({
    rpId: Deno.env.get('PASSKEY_RP_ID'),
    origins: Deno.env.get('PASSKEY_ORIGINS'),
  });
}

/**
 * Who is calling, from the bearer token — or null.
 *
 * The publishable key is a valid project JWT and resolves to no user, which is
 * exactly the distinction the registration steps need: it gets a caller through
 * the gateway and no further.
 */
async function callerFrom(supabase: SupabaseClient, req: Request) {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

/**
 * Spends a challenge, returning the row if it was unspent and unexpired.
 *
 * Deleting *is* the check. Reading first and deleting after would leave a
 * window in which the same challenge could be verified twice, and the whole
 * point of storing challenges rather than signing them is that they can be
 * consumed exactly once.
 */
async function consumeChallenge(
  supabase: SupabaseClient,
  challenge: string,
  kind: 'registration' | 'authentication',
) {
  const { data, error } = await supabase
    .from('webauthn_challenges')
    .delete()
    .eq('challenge', challenge)
    .eq('kind', kind)
    .select('user_id, expires_at')
    .maybeSingle();

  if (error) throw new Error(`Could not consume the challenge: ${error.message}`);
  if (!data) return null;
  if (!challengeIsFresh(data.expires_at as string, new Date())) return null;
  return data as { user_id: string | null; expires_at: string };
}

async function issueChallenge(
  supabase: SupabaseClient,
  challenge: string,
  kind: 'registration' | 'authentication',
  userId: string | null,
) {
  // Cheaper than a scheduled job and it runs exactly as often as it is needed.
  await supabase.rpc('purge_expired_webauthn_challenges');

  const { error } = await supabase
    .from('webauthn_challenges')
    .insert({ challenge, kind, user_id: userId });

  if (error) throw new Error(`Could not store the challenge: ${error.message}`);
}

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */

async function registerOptions(supabase: SupabaseClient, userId: string, email: string) {
  const { data: existing, error } = await supabase
    .from('passkeys')
    .select('credential_id, transports')
    // Service-role bypasses RLS, so this filter is the boundary rather than a
    // belt-and-braces repeat of one. Without it the exclude list would leak
    // every credential id in the table.
    .eq('user_id', userId);

  if (error) throw new Error(`Could not read existing passkeys: ${error.message}`);

  const options = await registrationOptions({
    rp: relyingParty(),
    userId,
    userName: email,
    existing: (existing ?? []).map((row) => ({
      credentialId: row.credential_id as string,
      transports: (row.transports ?? []) as string[],
    })),
  });

  await issueChallenge(supabase, options.challenge, 'registration', userId);
  return json({ options });
}

async function registerVerify(
  supabase: SupabaseClient,
  userId: string,
  body: Body,
) {
  if (!body.challenge || !body.response) return fail('Malformed request.', 400);

  const consumed = await consumeChallenge(supabase, body.challenge, 'registration');
  if (!consumed) return fail('That registration has expired. Start again.', 400);

  /*
   * The challenge was issued to a specific signed-in user. If the token now
   * presenting it belongs to somebody else, this is a session mixed up with
   * another — refuse rather than attach the credential to whichever of the two
   * happens to be holding the request.
   */
  if (consumed.user_id !== userId) return fail('That registration has expired. Start again.', 400);

  const credential = await verifyRegistration({
    rp: relyingParty(),
    userId,
    response: body.response as never,
    expectedChallenge: body.challenge,
  });

  const { error } = await supabase.from('passkeys').insert({
    user_id: userId,
    credential_id: credential.credentialId,
    public_key: credential.publicKey,
    counter: credential.counter,
    transports: credential.transports,
    device_label: deviceLabelFor(credential.transports),
  });

  if (error) {
    // 23505 is the unique index on credential_id. The authenticator was asked
    // to exclude what the user already has, so reaching this means a second
    // account tried to claim the same credential — or the browser ignored the
    // exclude list, which some do.
    if (error.code === '23505') return fail('That passkey is already registered.', 409);
    throw new Error(`Could not save the passkey: ${error.message}`);
  }

  return json({ label: deviceLabelFor(credential.transports) });
}

async function signinOptions(supabase: SupabaseClient) {
  const options = await authenticationOptions(relyingParty());
  // No user id: a discoverable credential does not name its owner until the
  // authenticator answers, and asking for one here would be an enumeration
  // oracle. See `authenticationOptions`.
  await issueChallenge(supabase, options.challenge, 'authentication', null);
  return json({ options });
}

async function signinVerify(supabase: SupabaseClient, body: Body) {
  if (!body.challenge || !body.response) return fail('Malformed request.', 400);

  const consumed = await consumeChallenge(supabase, body.challenge, 'authentication');
  if (!consumed) return fail('That sign-in attempt has expired. Try again.', 400);

  const response = body.response as { id?: string };
  const credentialId = typeof response.id === 'string' ? response.id : '';
  if (!credentialId) return fail('Malformed request.', 400);

  const { data: row, error: lookupError } = await supabase
    .from('passkeys')
    .select('id, user_id, credential_id, public_key, counter, transports')
    .eq('credential_id', credentialId)
    .maybeSingle();

  if (lookupError) throw new Error(`Could not read the passkey: ${lookupError.message}`);
  /*
   * Same wording as an expired challenge, and the same status. Distinguishing
   * "no such credential" from "wrong challenge" would tell a caller which of
   * their guesses was closer, and the honest user sees neither case.
   */
  if (!row) return fail('That passkey is not registered on this account.', 401);

  const assertion = await verifyAssertion({
    rp: relyingParty(),
    response: body.response as never,
    expectedChallenge: body.challenge,
    credential: {
      credentialId: row.credential_id as string,
      publicKey: row.public_key as string,
      counter: Number(row.counter),
      transports: (row.transports ?? []) as string[],
      userId: row.user_id as string,
    },
  });

  /*
   * Written before the session is minted. A crash between the two would
   * otherwise leave the counter behind the authenticator's, and the next real
   * sign-in would look like a replay — the clone alarm firing at the only
   * person it was built to protect.
   */
  const { error: counterError } = await supabase
    .from('passkeys')
    .update({ counter: assertion.newCounter, last_used_at: new Date().toISOString() })
    .eq('id', row.id as string);

  if (counterError) throw new Error(`Could not record the sign-in: ${counterError.message}`);

  const session = await mintSession(supabase, assertion.userId);
  return json(session);
}

/**
 * Issues a real session for a user id, without sending any email.
 *
 * Everything above this line exists to make sure `userId` is the right one.
 */
async function mintSession(supabase: SupabaseClient, userId: string) {
  /*
   * Either key works for the exchange, and which one exists depends on when the
   * project was created: older projects inject the legacy `SUPABASE_ANON_KEY`
   * JWT, newer ones the `sb_publishable_…` form. Both are public by design, so
   * reading whichever is present is not a widening of anything.
   */
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!anonKey || !url) {
    throw new Error('Neither SUPABASE_ANON_KEY nor SUPABASE_PUBLISHABLE_KEY is available.');
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData.user?.email) {
    throw new Error(`Could not resolve the account: ${userError?.message ?? 'no email'}`);
  }

  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: userData.user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    throw new Error(`Could not issue a session: ${linkError?.message ?? 'no token'}`);
  }

  // Exchanged through an anonymous client so the auth server mints the session
  // the same way it does for a password sign-in.
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError || !verified.session) {
    throw new Error(`Could not issue a session: ${verifyError?.message ?? 'no session'}`);
  }

  return {
    accessToken: verified.session.access_token,
    refreshToken: verified.session.refresh_token,
    email: userData.user.email,
  };
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('Method not allowed.', 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return fail('Malformed request.', 400);
  }

  let supabase: SupabaseClient;
  try {
    supabase = admin();
    // Fails fast and loudly on a deployment that never set its origins, rather
    // than at the point where a user has already been asked for a fingerprint.
    relyingParty();
  } catch (error) {
    console.error(error);
    return fail('Passkeys are not configured on this deployment.', 503);
  }

  try {
    switch (body.step) {
      case 'signin-options':
        return await signinOptions(supabase);
      case 'signin-verify':
        return await signinVerify(supabase, body);
      case 'register-options':
      case 'register-verify': {
        const caller = await callerFrom(supabase, req);
        if (!caller?.email) return fail('Sign in before adding a passkey.', 401);
        return body.step === 'register-options'
          ? await registerOptions(supabase, caller.id, caller.email)
          : await registerVerify(supabase, caller.id, body);
      }
      default:
        return fail('Malformed request.', 400);
    }
  } catch (error) {
    /*
     * The full reason goes to the function log; the caller gets the sentence.
     * A verification failure that explains *which* check failed is a tutorial
     * on how to pass it.
     */
    console.error(body.step, error);
    const message = error instanceof Error ? error.message : 'Something went wrong.';
    // The cloned-credential message is the exception: it is the one failure the
    // user must act on, and it names an action rather than a mechanism.
    const cloned = message.includes('may have been cloned');
    return fail(cloned ? message : 'That passkey could not be verified.', cloned ? 409 : 401);
  }
});
