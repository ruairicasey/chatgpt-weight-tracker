import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSupabaseWebConfig } from '@weight-tracker/config/server';
import { authorizationId, consentRedirect, executeConsentDecision, loginDestination, readForm, requireConsentDetails, requireSameOrigin, requireWebOwner } from '@weight-tracker/auth/consent';

const env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic000000000000',
  APP_ORIGIN: 'https://synthetic-tracker.vercel.app',
  MCP_OAUTH_ISSUER: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
  MCP_OAUTH_AUDIENCE: 'https://synthetic-tracker.vercel.app/mcp',
  MCP_OWNER_USER_ID: '00000000-0000-4000-8000-000000000001',
  MCP_OAUTH_CLIENT_ID: '00000000-0000-4000-8000-000000000002',
  CHATGPT_OAUTH_REDIRECT_URI: 'https://chatgpt.com/connector/oauth/synthetic',
};
const config = loadSupabaseWebConfig(env);
const id = 'synthetic-authorization';
const details = { authorization_id: id, client: { id: config.clientId }, user: { id: config.ownerId }, redirect_uri: config.callbackUri, scope: 'openid email profile' };

test('web configuration requires canonical Supabase, callback and resource without activating MCP', () => {
  assert.equal(loadSupabaseWebConfig(env).origin, env.APP_ORIGIN);
  for (const overrides of [
    { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic' }, { SUPABASE_URL: 'http://localhost:54321' }, { SUPABASE_PUBLISHABLE_KEY: 'service-role-key' },
    { MCP_OAUTH_ISSUER: 'https://other.supabase.co/auth/v1' }, { APP_ORIGIN: 'https://example.com/' }, { APP_ORIGIN: 'not-a-url' }, { CHATGPT_OAUTH_REDIRECT_URI: 'not-a-url' }, { CHATGPT_OAUTH_REDIRECT_URI: 'https://user:secret@chatgpt.com/connector/oauth/synthetic' },
    { MCP_OAUTH_AUDIENCE: 'https://other.vercel.app/mcp' }, { CHATGPT_OAUTH_REDIRECT_URI: 'https://chatgpt.com.evil.example/callback' },
    { CHATGPT_OAUTH_REDIRECT_URI: 'https://chatgpt.com/connector/oauth/synthetic?redirect=evil' },
  ]) assert.throws(() => loadSupabaseWebConfig({ ...env, ...overrides }));
});

test('consent requires exact owner, approved client, authorization ID and callback; OIDC is not CRUD permission', () => {
  requireWebOwner({ id: config.ownerId, is_anonymous: false }, config);
  requireConsentDetails(details, config, id);
  for (const user of [null, { id: config.ownerId, is_anonymous: true }, { id: config.ownerId }, { id: 'other', is_anonymous: false }]) assert.throws(() => requireWebOwner(user, config));
  for (const override of [
    { client: { id: 'other' } }, { user: { id: 'other' } }, { authorization_id: 'other' },
    { redirect_uri: 'https://evil.example' }, { scope: 'tracker:read entries:write' }, { scope: ['openid'] },
  ]) assert.throws(() => requireConsentDetails({ ...details, ...override }, config, id));
  // An already-consented redirect does not authorize a fresh approval POST.
  assert.throws(() => requireConsentDetails({ redirect_url: config.callbackUri }, config, id));
});

test('CSRF, open redirects, duplicate IDs and injected authorization IDs are rejected', () => {
  requireSameOrigin(config.origin, config);
  for (const origin of [null, 'null', 'https://evil.example', `${config.origin}.evil.example`]) assert.throws(() => requireSameOrigin(origin, config));
  assert.equal(consentRedirect(`${config.callbackUri}?code=synthetic&state=synthetic`, config), `${config.callbackUri}?code=synthetic&state=synthetic`);
  for (const url of ['//evil.example', 'javascript:alert(1)', 'https://chatgpt.com@evil.example', `${config.callbackUri}/extra`, `${config.callbackUri}#fragment`, 'https://chatgpt.com/connector/oauth/other']) assert.throws(() => consentRedirect(url, config));
  for (const value of [undefined, ['one', 'two'], '../../evil', '<script>', 'x'.repeat(129)]) assert.throws(() => authorizationId(value));
  assert.equal(loginDestination(id), `/oauth/consent?authorization_id=${id}`);
  assert.throws(() => loginDestination('https://evil.example'));
});


test('approval and denial revalidate provider identity/details before mutating consent', async () => {
  for (const decision of ['approve', 'deny'] as const) {
    const calls: string[] = [];
    const result = await executeConsentDecision({ origin: config.origin, id, decision }, config, {
      async owner() { calls.push('owner'); return { id: config.ownerId, is_anonymous: false }; },
      async details(value) { assert.equal(value, id); calls.push('details'); return details; },
      async decide(value, action) { assert.equal(value, id); assert.equal(action, decision); calls.push(action); return `${config.callbackUri}?state=synthetic`; },
    });
    assert.equal(result, `${config.callbackUri}?state=synthetic`);
    assert.deepEqual(calls, ['owner', 'details', decision]);
  }
  for (const bad of ['origin', 'owner', 'client', 'decision', 'provider-error']) {
    let mutations = 0;
    await assert.rejects(executeConsentDecision({ origin: bad === 'origin' ? 'https://evil.example' : config.origin, id, decision: bad === 'decision' ? 'yes' : 'approve' }, config, {
      async owner() { return { id: bad === 'owner' ? 'other' : config.ownerId, is_anonymous: false }; },
      async details() { if (bad === 'provider-error') throw new Error('Unavailable'); return bad === 'client' ? { ...details, client: { id: 'other' } } : details; },
      async decide() { mutations++; return config.callbackUri; },
    }));
    assert.equal(mutations, 0);
  }
});


test('form parsing bounds streamed bodies, rejects duplicates and checks media type', async () => {
  const request = (body: string, type = 'application/x-www-form-urlencoded') => new Request('https://synthetic.example', { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await readForm(request('decision=approve'))).get('decision'), 'approve');
  await assert.rejects(readForm(request('decision=approve&decision=deny')));
  await assert.rejects(readForm(request('x=' + 'x'.repeat(16_384))));
  await assert.rejects(readForm(request('{}', 'application/json')));
  await assert.rejects(readForm(request('x=1', 'application/x-www-form-urlencoded-evil')));
});
