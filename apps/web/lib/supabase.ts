import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseWebConfig } from '@weight-tracker/config/server';

export async function supabaseServer(config: SupabaseWebConfig, writable = false) {
  const jar = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        // The proxy refreshes cookies before Server Components render.
        if (writable) for (const { name, value, options } of values) jar.set(name, value, options);
      },
    },
  });
}
