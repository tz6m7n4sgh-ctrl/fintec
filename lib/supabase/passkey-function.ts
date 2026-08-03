import 'server-only';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

/**
 * The one way the app talks to the passkey Edge Function.
 *
 * ## Why the browser never calls it directly
 *
 * The obvious shape is for the client component to `fetch` the function itself:
 * it already has to call `navigator.credentials`, and the publishable key is in
 * the bundle anyway. The reason it does not is the sign-in step's reply, which
 * contains an access token and a refresh token. Returning those to client
 * JavaScript would mean the session existing in a variable — reachable by any
 * script on the page, and by anything that ever gets injected onto it — before
 * being handed back to a server action to store.
 *
 * Going through the server instead means the tokens travel Edge Function →
 * server action → `Set-Cookie`, on the response the browser is already
 * receiving. They never enter the page at all. The browser's half of the
 * ceremony is exactly the part that must happen there and nothing more: the
 * options in, the authenticator's answer out.
 *
 * `server-only` makes that structural. Importing this from a client component
 * fails the build rather than shipping the round trip to the browser.
 */

const ENDPOINT = `${SUPABASE_URL}/functions/v1/passkeys`;

export interface FunctionCall {
  step: 'register-options' | 'register-verify' | 'signin-options' | 'signin-verify';
  /** The browser's half of the ceremony, passed through unread. */
  response?: unknown;
  challenge?: string;
  /**
   * The signed-in user's access token, for the registration steps.
   *
   * The function resolves the user from this token and takes the user id from
   * nowhere else. Sending an id in the body instead would make the whole
   * function an "issue me a session as anyone" endpoint, so there is
   * deliberately no field for one.
   */
  accessToken?: string;
}

export interface FunctionReply<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * The message shown when the function itself is unreachable or unconfigured.
 *
 * Named rather than generic because these are the two states a deployment sits
 * in before anyone has set `PASSKEY_RP_ID` and `PASSKEY_ORIGINS`, and "passkey
 * sign-in failed" would send the user to retry a thing that cannot work yet.
 */
export const PASSKEYS_UNAVAILABLE =
  'Passkey sign-in is not available on this deployment yet. Use your email and password.';

export async function callPasskeyFunction<T>({
  step,
  response,
  challenge,
  accessToken,
}: FunctionCall): Promise<FunctionReply<T>> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        /*
         * Both headers. `apikey` identifies the project to the gateway; the
         * bearer is what `verify_jwt` checks. For registration that bearer is
         * the user's own access token, which is how the function learns who is
         * asking without being told.
         */
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${accessToken ?? SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ step, response, challenge }),
      // No caching, ever. A cached challenge is a replayable one.
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, error: PASSKEYS_UNAVAILABLE };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /*
     * The gateway returns plain text for its own rejections — a bad key, a
     * missing function. Falling through with a null payload turns that into the
     * "not available" message below rather than a parse error the user cannot
     * act on.
     */
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : PASSKEYS_UNAVAILABLE;
    return { ok: false, status: res.status, error: message };
  }

  return { ok: true, status: res.status, data: payload as T };
}
