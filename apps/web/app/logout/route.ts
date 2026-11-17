import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { requireSameOrigin } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../lib/supabase';

export const runtime = 'nodejs';

/** Same-origin POST only, so other sites cannot sign the owner out. Clears this browser's session. */
export async function POST(request: Request) {
  let config;
  try { config = loadSupabaseWebConfig(process.env); }
  catch { return Response.json({ error: 'AUTHENTICATION_NOT_CONFIGURED' }, { status: 503 }); }
  try { requireSameOrigin(request.headers.get('origin'), config); }
  catch { return Response.json({ error: 'ACCESS_DENIED' }, { status: 403 }); }
  try {
    const client = await supabaseServer(config, true);
    await client.auth.signOut({ scope: 'local' });
  } catch { /* Fall through: the login page is shown either way. */ }
  return Response.redirect(new URL('/login', config.origin), 303);
}
