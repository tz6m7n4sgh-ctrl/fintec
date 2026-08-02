/**
 * Rules for the email and password fields, kept pure and separate.
 *
 * Two reasons this is not inlined into the server action. The browser and the
 * server must agree on what a valid password is — a form that accepts eight
 * characters and a server that demands ten is a bug the user experiences as
 * randomness — and these rules are the one part of the auth flow that can be
 * unit-tested without an auth server.
 *
 * What is deliberately NOT here: any judgement about whether the credentials
 * are *correct*. That is the auth server's call. This only rejects input that
 * could never be right, so a doomed request is not sent.
 */

/**
 * Supabase's own default minimum is 6. Eight is used here because this app
 * stores salary, savings and debt figures, and because the usual mitigation for
 * a weak password — a reset link to the registered mailbox — deliberately does
 * not exist in this build.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * bcrypt hashes at most 72 bytes and silently discards the rest. Left
 * unchecked, a 100-character passphrase would work, and so would the first 72
 * bytes of it typed alone — the user would have a weaker password than they
 * think and no way to find out. Rejecting is better than truncating quietly.
 *
 * Bytes, not characters: an emoji or an Arabic character is several bytes, so a
 * character count would let a short-looking password past the limit.
 */
export const PASSWORD_MAX_BYTES = 72;

/** Lowercased and trimmed. Supabase stores addresses lowercased; matching that
 *  here stops "Danial@x.com" and "danial@x.com" reading as different accounts. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Returns an error sentence, or null when the address could plausibly be real.
 *
 * The pattern is deliberately loose. Email grammar is far more permissive than
 * any regex people actually write, and a strict one mostly succeeds at
 * rejecting valid addresses. This catches the shapes that are definitely not an
 * address and leaves the rest to the auth server.
 */
export function validateEmail(raw: string): string | null {
  const email = normaliseEmail(raw);
  if (!email) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'That does not look like an email address.';
  }
  return null;
}

/** Returns an error sentence, or null when the password is usable. */
export function validatePassword(raw: string): string | null {
  if (!raw) return 'Enter a password.';
  if (raw.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (byteLength(raw) > PASSWORD_MAX_BYTES) {
    return `Password is too long — it must be under ${PASSWORD_MAX_BYTES} bytes. Long passphrases with emoji or non-Latin characters hit this sooner than they look.`;
  }
  return null;
}

/**
 * The whole sign-up form in one call.
 *
 * `confirm` is checked last on purpose: telling someone their two passwords do
 * not match, and then telling them on the next attempt that the password was
 * too short anyway, is two round trips for one mistake.
 */
export function validateSignUp(
  email: string,
  password: string,
  confirm: string,
): string | null {
  return (
    validateEmail(email) ??
    validatePassword(password) ??
    (password !== confirm ? 'The two passwords do not match.' : null)
  );
}

/**
 * The sign-in form. Only shape is checked — length rules are not applied to an
 * existing password, because an account created before the rules changed must
 * still be able to get in and change it.
 */
export function validateSignIn(email: string, password: string): string | null {
  return validateEmail(email) ?? (password ? null : 'Enter your password.');
}
