import { redirect } from 'next/navigation';
import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { authorizationId, consentRedirect, requireConsentDetails, requireWebOwner } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';
export default async function Consent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let config;
  try { config = loadSupabaseWebConfig(process.env); }
  catch { return <main><h1>Connection unavailable</h1><p>Authentication is not configured.</p></main>; }
  const params = await searchParams;
  let id;
  try { id = authorizationId(params.authorization_id); }
  catch { return <main><h1>Invalid authorization request</h1></main>; }
  const client = await supabaseServer(config);
  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) redirect(`/login?authorization_id=${id}`);
  try { requireWebOwner(user, config); }
  catch { return <main><h1>Access denied</h1></main>; }
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <main><h1>Authorization request unavailable</h1><p>Restart the connection from ChatGPT.</p></main>;
  let previousRedirect: string | undefined;
  try {
    if ('redirect_url' in data) previousRedirect = consentRedirect(data.redirect_url, config);
    else requireConsentDetails(data, config, id);
  } catch { return <main><h1>Access denied</h1></main>; }
  // Supabase returns a redirect when prior consent already covers this request.
  // The callback is pinned here; /mcp independently checks the approved client.
  if (previousRedirect) redirect(previousRedirect);
  return <main className="mx-auto max-w-lg space-y-5 p-8">
    <h1 className="text-2xl font-semibold">Connect ChatGPT to your tracker</h1>
    <p>This connection authorizes ChatGPT to read, create, correct and delete your tracker records as the owner.</p>
    <p>The current experiment exposes synthetic read/write probes only. It stores no tracker records.</p>
    <p>Requested identity scopes: {'scope' in data ? data.scope : ''}.</p>
    <p>Supabase’s identity scopes do not limit these application permissions. You can revoke the connection in Supabase.</p>
    <form action="/oauth/consent/submit" method="post" className="flex gap-4">
      <input type="hidden" name="authorization_id" value={id} />
      <button className="rounded bg-slate-900 p-3 text-white" name="decision" value="approve">Approve connection</button>
      <button className="rounded border p-3" name="decision" value="deny">Deny</button>
    </form>
  </main>;
}
