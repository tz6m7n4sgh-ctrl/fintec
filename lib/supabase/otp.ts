import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Turns whatever arrives in the sign-in box into something verifyOtp accepts.
 *
 * This exists because of a mismatch nobody can fix from application code.
 * Supabase decides between a six-digit code and a magic link by reading the
 * *email template*: `{{ .Token }}` sends a code, `{{ .ConfirmationURL }}` sends
 * a link. The stock template uses ConfirmationURL, so a project that nobody has
 * customised sends a link — while this app's form asks for a code. The code and
 * the link are the same grant in two encodings, so rather than demand a
 * dashboard change, the box accepts either.
 *
 * The link matters more than it looks. Clicking it depends on `redirect_to`
 * being in the project's allowed-redirect list, which defaults to Site URL,
 * which defaults to localhost — so on a fresh project the link lands nowhere.
 * Pasting it here never redirects at all: the token hash is verified directly
 * against the auth server. That is what makes sign-in work with a project whose
 * URL configuration has never been touched.
 */

export type ParsedOtp =
  | { kind: 'code'; token: string }
  | { kind: 'hash'; tokenHash: string; type: EmailOtpType }
  | { kind: 'exchange'; code: string };

/** The types Supabase will put in a `type=` query parameter for email links. */
const EMAIL_OTP_TYPES: readonly string[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function asEmailOtpType(raw: string | null): EmailOtpType {
  // 'email' is the right default: it is what verifyOtp expects for the
  // sign-in-or-sign-up flow this app uses, and an unrecognised value would be
  // rejected by the auth server with a far less obvious message.
  return raw && EMAIL_OTP_TYPES.includes(raw) ? (raw as EmailOtpType) : 'email';
}

/**
 * Accepts a six-digit code, a Supabase verify URL, or an /auth/confirm URL.
 *
 * Returns null when the input is neither — an empty box, or a half-pasted
 * link — so the caller can say so rather than send a doomed request.
 */
export function parseOtpInput(input: string): ParsedOtp | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A bare code. Supabase codes are six digits, but the length is not pinned
  // here — a project configured for a different length should still work, and
  // an outright wrong code is the auth server's call to make, not this
  // function's.
  if (/^\d{4,10}$/.test(trimmed)) return { kind: 'code', token: trimmed };

  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const params = url.searchParams;

  /*
   * Two shapes, because the two templates in Supabase's own docs disagree.
   * The stock ConfirmationURL uses `token`; the recommended custom template
   * uses `token_hash`. Both carry the same hashed value.
   */
  const tokenHash = params.get('token_hash') ?? params.get('token');
  if (tokenHash) {
    return { kind: 'hash', tokenHash, type: asEmailOtpType(params.get('type')) };
  }

  /*
   * A PKCE `?code=` URL — what the user is holding *after* they clicked.
   *
   * Clicking sends the token hash through Supabase's /verify, which consumes it
   * and redirects to `redirect_to`. That value comes from Site URL, which
   * defaults to http://localhost:3000, so on a fresh project a click lands on a
   * dead address carrying a perfectly good auth code the user cannot spend.
   *
   * This was originally rejected here, on the grounds that exchanging a code
   * needs the verifier the *requesting* browser stored, so pasting it into a
   * different browser cannot work. That reasoning was right and the conclusion
   * was wrong: the overwhelmingly common case is the same browser, where it
   * works fine, and the cross-browser case fails with a specific message the
   * caller can explain. Refusing outright turned a recoverable situation into a
   * dead end and made every misdirected click cost a fresh email.
   */
  const code = params.get('code');
  if (code) return { kind: 'exchange', code };

  return null;
}
