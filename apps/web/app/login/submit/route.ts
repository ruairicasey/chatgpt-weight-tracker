import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { readForm, loginDestination, requireSameOrigin, requireWebOwner } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../../lib/supabase';

export const runtime = 'nodejs';
let windowStart = Date.now();
let attempts = 0;
export async function POST(request: Request) {
  let config;
  try { config = loadSupabaseWebConfig(process.env); }
  catch { return Response.json({ error: 'AUTHENTICATION_NOT_CONFIGURED' }, { status: 503 }); }
  try { requireSameOrigin(request.headers.get('origin'), config); }
  catch { return Response.json({ error: 'ACCESS_DENIED' }, { status: 403 }); }
  if (Date.now() - windowStart >= 60_000) { attempts = 0; windowStart = Date.now(); }
  if (++attempts > 20) return Response.json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '60' } });
  let destination = '/login';
  try {
    const form = await readForm(request);
    destination = loginDestination(form.get('authorization_id'));
    const email = form.get('email') ?? '';
    const password = form.get('password') ?? '';
    if (!email || email.length > 254 || !password || password.length > 256) throw new Error('Invalid input');
    const client = await supabaseServer(config, true);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Sign-in failed');
    try { requireWebOwner(data.user, config); }
    catch { await client.auth.signOut({ scope: 'local' }); throw new Error('Access denied'); }
    return Response.redirect(new URL(destination, config.origin), 303);
  } catch {
    const url = new URL('/login', config.origin);
    if (destination.startsWith('/oauth/consent?')) url.searchParams.set('authorization_id', new URL(destination, config.origin).searchParams.get('authorization_id')!);
    url.searchParams.set('error', '1');
    return Response.redirect(url, 303);
  }
}
