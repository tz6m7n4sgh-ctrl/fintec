import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * The landing point for a clicked email link (US-39 / FR-K1).
 *
 * Two shapes arrive here. A `token_hash` link is verified directly. A PKCE
 * `code` link is exchanged for a session, which works because a click keeps the
 * user in the browser that requested the email and therefore still holds the
 * code verifier.
 *
 * This is the convenient path, not the load-bearing one. Whether a link ever
 * reaches this route is decided by the project's allowed-redirect list — which
 * defaults to Site URL, which defaults to localhost — and that is dashboard
 * configuration this code cannot set. So the route is written to be useful when
 * it is reachable and irrelevant when it is not: the sign-in form accepts the
 * same link pasted in, which needs no redirect and no configuration.
 *
 * A failure sends the user back to /sign-in with the reason in the query
 * string rather than rendering a dead end, because "Token has expired" and
 * "Email link is invalid" call for different actions.
 */

/** Only same-origin paths. An open redirect on an auth route is a real one. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get('next'));

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent('Supabase is not configured for this deployment.')}`);
  }

  const tokenHash = searchParams.get('token_hash') ?? searchParams.get('token');
  const type = (searchParams.get('type') ?? 'email') as EmailOtpType;
  const code = searchParams.get('code');

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(
    `${origin}/sign-in?error=${encodeURIComponent('That link carried no sign-in token. Paste the link from your email into the code box instead.')}`,
  );
}
