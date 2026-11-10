import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-4000-8000-000000000001';
const client = '00000000-0000-4000-8000-000000000002';
const resource = 'https://synthetic-tracker.vercel.app/mcp';
const claims = { sub: owner, client_id: client, aud: 'authenticated', role: 'authenticated', is_anonymous: false, scope: 'openid', session_id: '00000000-0000-4000-8000-000000000004', iat: 100, exp: 400 };

test('actual PostgreSQL hook preserves dashboard claims, binds approved client and refuses forged ownership', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role supabase_auth_admin;');
    await db.exec(readFileSync('supabase/migrations/202611100001_mcp_access_token_hook.sql', 'utf8'));
    async function invoke(value: object) {
      const response = await db.query<{ event: { claims: Record<string, unknown> } }>('select public.mcp_access_token_hook($1::jsonb) as event', [JSON.stringify(value)]);
      return response.rows[0]!.event;
    }
    const dashboard = { claims: { ...claims, client_id: undefined }, authentication_method: 'password', user_id: owner };
    assert.deepEqual(await invoke(dashboard), JSON.parse(JSON.stringify(dashboard)));
    await assert.rejects(invoke({ claims })); // missing operator settings fails closed for OAuth
    await db.query('insert into private.mcp_oauth_settings(client_id, owner_id, resource) values ($1,$2,$3)', [client, owner, resource]);
    // Actual CustomAccessTokenInput has claims.client_id, not a top-level client_id.
    for (const method of ['oauth_provider/authorization_code', 'token_refresh']) {
      for (const scope of ['openid email profile', undefined]) {
        const input = { metadata: { name: 'customize-access-token', uuid: '00000000-0000-4000-8000-000000000005', time: '2026-11-10T00:00:00Z' },
          claims: { ...claims, scope }, user_id: owner, authentication_method: method };
        const value = await invoke(input);
        assert.deepEqual(value, JSON.parse(JSON.stringify({ ...input, claims: { ...input.claims, aud: resource } })));
      }
    }
    // Spoofing a root field or user metadata cannot select another client or aud.
    const misleadingRoot = { claims, user_id: owner, client_id: 'unapproved-root', authentication_method: 'token_refresh' };
    assert.equal((await invoke(misleadingRoot)).claims.aud, resource);
    const dashboardSpoof = { claims: { ...claims, client_id: undefined, user_metadata: { client_id: client } }, client_id: client, user_id: owner };
    assert.deepEqual(await invoke(dashboardSpoof), JSON.parse(JSON.stringify(dashboardSpoof)));
    const unknown = { claims: { ...claims, client_id: '00000000-0000-4000-8000-000000000003' } };
    assert.deepEqual(await invoke(unknown), unknown);
    for (const override of [{ sub: '00000000-0000-4000-8000-000000000003' }, { role: 'service_role' }, { is_anonymous: true }, { is_anonymous: undefined }]) await assert.rejects(invoke({ claims: { ...claims, ...override } }));
    await assert.rejects(invoke({}));
    await db.exec('set role supabase_auth_admin;');
    assert.equal((await invoke({ claims })).claims.aud, resource);
    await assert.rejects(db.query('select * from private.mcp_oauth_settings'));
    await db.exec('reset role; set role anon;');
    await assert.rejects(invoke({ claims }));
    await db.exec('reset role; set role authenticated;');
    await assert.rejects(invoke({ claims }));
    await assert.rejects(db.query('select * from private.mcp_oauth_settings'));
  } finally { await db.close(); }
});
