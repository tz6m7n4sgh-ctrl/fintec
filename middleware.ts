import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isSupabaseConfigured } from '@/lib/supabase/config';

/**
 * Refreshes the Supabase session on every request.
 *
 * Server components cannot write cookies, so without this the access token
 * would expire and the user would be silently signed out mid-session — on a
 * screen showing legal deadlines, that is a bad way to find out. The middleware
 * is the one place that can both read the request cookies and write refreshed
 * ones onto the response.
 *
 * It deliberately does NOT gate access to the screens. Signed out, the app
 * still renders the §11 reference dataset behind its "Seeded data" banner,
 * which is what makes it viewable at all today. Access control for real rows is
 * row-level security, keyed to auth.uid() — a redirect here would be a UI
 * convenience, not the boundary.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() is what triggers the refresh. The result is unused here
  // on purpose — the pages read it themselves.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the icon — refreshing a session on a
     * stylesheet request is pure overhead.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)',
  ],
};
