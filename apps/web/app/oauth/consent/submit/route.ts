import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { readForm, executeConsentDecision, requireSameOrigin } from '@weight-tracker/auth/consent';
import { supabaseServer } from '../../../../lib/supabase';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  let config;
  try { config = loadSupabaseWebConfig(process.env); }
  catch { return Response.json({ error: 'AUTHENTICATION_NOT_CONFIGURED' }, { status: 503 }); }
  try {
    requireSameOrigin(request.headers.get('origin'), config);
    const form = await readForm(request);
    const client = await supabaseServer(config, true);
    const destination = await executeConsentDecision({ origin: request.headers.get('origin'), id: form.get('authorization_id'), decision: form.get('decision') }, config, {
      async owner() {
        const { data, error } = await client.auth.getUser();
        if (error) throw new Error('Access denied');
        return data.user;
      },
      async details(id) {
        const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
        if (error) throw new Error('Unavailable');
        return data;
      },
      async decide(id, decision) {
        const result = decision === 'approve'
          ? await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
          : await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
        if (result.error || !result.data) throw new Error('Unavailable');
        return result.data.redirect_url;
      },
    });
    return Response.redirect(destination, 303);
  } catch { return Response.json({ error: 'ACCESS_DENIED' }, { status: 403, headers: { 'Cache-Control': 'no-store' } }); }
}
