import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { loadSupabaseWebConfig } from '@weight-tracker/config/server';

/** Refresh dashboard cookies in a writable response before rendering owner pages. */
export async function proxy(request: NextRequest) {
  let settings;
  try { settings = loadSupabaseWebConfig(process.env); } catch { return NextResponse.next(); }
  let response = NextResponse.next({ request });
  const client = createServerClient(settings.supabaseUrl, settings.publishableKey, {
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  try { await client.auth.getUser(); } catch { /* The owner page still fails closed. */ }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/login', '/oauth/consent'] };
