import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTHeaderParameters } from 'jose';
import { createOwnerAuthentication, AuthenticationError, bearerToken, oauthFailureResponse } from '@weight-tracker/auth/server';
import { loadOAuthConfig, OAuthConfigurationError } from '@weight-tracker/config/server';
import type { VerifiedExternalIdentity } from '@weight-tracker/auth';

const env = {
  MCP_OAUTH_ISSUER: 'https://abcdefghijklmnopqrst.supabase.co/auth/v1',
  MCP_OAUTH_AUDIENCE: 'https://synthetic-tracker.vercel.app/mcp',
  MCP_OAUTH_CLIENT_ID: '00000000-0000-4000-8000-000000000002',
  MCP_OAUTH_SIGNING_ALGORITHM: 'RS256',
  MCP_OWNER_USER_ID: '00000000-0000-4000-8000-000000000001',
};
const config = loadOAuthConfig(env);
const pair = await generateKeyPair('RS256');
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const metadata = { issuer: config.issuer, jwks_uri: `${config.issuer}/.well-known/jwks.json` };
const claims = (): JWTPayload => {
  const now = Math.floor(Date.now() / 1000);
  return { iss: config.issuer, aud: config.audience, sub: config.ownerUserId, client_id: config.clientId,
    scope: 'openid email profile', role: 'authenticated', is_anonymous: false, session_id: '00000000-0000-4000-8000-000000000004', iat: now, exp: now + 300, jti: 'synthetic-operation' };
};
async function token(overrides: Record<string, unknown> = {}, header: JWTHeaderParameters = { alg: 'RS256', typ: 'JWT', kid: 'synthetic-key' }) {
  const payload = Object.fromEntries(Object.entries({ ...claims(), ...overrides }).filter(([, value]) => value !== undefined));
  return new SignJWT(payload).setProtectedHeader(header).sign(pair.privateKey);
}
function harness() {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.credentials, 'omit');
    assert(!init?.headers || !new Headers(init.headers).has('authorization'));
    if (url === `${config.issuer}/.well-known/openid-configuration`) return Response.json(metadata);
    if (url === metadata.jwks_uri) return Response.json({ keys: [publicKey] });
    throw new Error('Unexpected URL');
  };
  return { ...createOwnerAuthentication(config, fetcher), requests, fetcher };
}
function failure(code: string) {
  return (error: unknown) => error instanceof AuthenticationError && error.code === code &&
    error.message === 'Authentication or authorization failed.' && error.cause === undefined;
}

test('strict server configuration rejects missing, malformed, public and unsafe values without echoing input', () => {
  assert(Object.isFrozen(config));
  for (const override of [
    { MCP_OAUTH_ISSUER: undefined }, { MCP_OAUTH_ISSUER: 'http://localhost/' },
    { MCP_OAUTH_ISSUER: 'https://evil.example/' }, { MCP_OAUTH_ISSUER: 'https://tenant.auth0.com/extra' },
    { MCP_OAUTH_ISSUER: 'https://tenant.auth0.com.evil.example/' },
    { MCP_OAUTH_AUDIENCE: 'private-not-a-url' }, { MCP_OAUTH_AUDIENCE: undefined },
    { MCP_OAUTH_AUDIENCE: 'https://user:private@tracker.vercel.app/mcp' },
    { MCP_OAUTH_AUDIENCE: 'https://tracker.vercel.app/mcp?secret=private' },
    { MCP_OAUTH_CLIENT_ID: 'private\r\nInjected: true' }, { MCP_OWNER_USER_ID: 'private' },
    { MCP_OWNER_USER_ID: '' }, { MCP_OWNER_USER_ID: 'synthetic@clients' },
    { NEXT_PUBLIC_MCP_OWNER_SUBJECT: 'private' },
  ]) assert.throws(() => loadOAuthConfig({ ...env, ...override }), (error: unknown) =>
    error instanceof OAuthConfigurationError && error.message === 'Invalid server OAuth configuration.' && !JSON.stringify(error).includes('private'));
  assert.throws(() => createOwnerAuthentication({ ...config, issuer: 'https://evil.example/' }), OAuthConfigurationError);
});

test('valid access token verifies cryptographically, maps exact owner and enforces operation scopes', async () => {
  const h = harness();
  const identity = await h.verifier.verify(await token({ aud: [config.audience, `${config.issuer}userinfo`] }));
  const principal = await h.resolver.resolve(identity);
  assert.equal(principal.userId, config.ownerUserId);
  assert.deepEqual(identity.scopes, ['tracker:read', 'entries:write', 'entries:delete', 'targets:write']);
  h.requireScopes(identity, ['entries:write']);
  assert(Object.isFrozen(identity));
  assert(Object.isFrozen(identity.scopes));
  assert(Object.isFrozen(principal));
  assert(!JSON.stringify(principal).includes('Bearer'));
  await h.verifier.verify(await token({ jti: undefined }));
  assert.equal(h.requests.length, 2, 'metadata and public keys are cached');
  const headers = new Headers({ authorization: `Bearer ${await token()}` });
  assert.equal((await h.authenticate(headers, ['tracker:read'])).userId, config.ownerUserId);
});

test('invalid JWTs fail closed: issuer, audience, type, lifetime, shape, signature and algorithm', async t => {
  const h = harness();
  const now = Math.floor(Date.now() / 1000);
  const invalid: Record<string, Record<string, unknown>> = {
    issuer: { iss: 'https://untrusted.auth0.com/' }, audience: { aud: `${config.audience}/` },
    'ID token audience': { aud: config.clientId }, expired: { iat: now - 400, exp: now - 1 },
    'not yet valid': { nbf: now + 30 }, 'future issued': { iat: now + 30 },
    'long lifetime': { exp: now + 601 }, 'inverted lifetime': { exp: now - 1 },
    'missing expiry': { exp: undefined }, 'missing issued-at': { iat: undefined },
    'fractional expiry': { exp: now + 300.5 }, 'missing client': { client_id: undefined, azp: config.clientId },
    'missing subject': { sub: undefined }, 'missing session': { session_id: undefined }, 'anonymous': { is_anonymous: true }, 'service role': { role: 'service_role' },
    'scope array': { scope: ['tracker:read'] }, 'missing scopes': { scope: undefined },
    'newline scope': { scope: 'tracker:read\nentries:write' },
  };
  for (const [name, overrides] of Object.entries(invalid)) await t.test(name, async () => {
    await assert.rejects(h.verifier.verify(await token(overrides)), failure('invalid_token'));
  });
  for (const header of [
    { alg: 'RS256', typ: 'at+jwt', kid: 'synthetic-key' },
    { alg: 'RS256', kid: 'synthetic-key' },
    { alg: 'RS256', typ: 'JWT' },
    { alg: 'RS256', typ: 'JWT', kid: 'synthetic-key', jku: 'https://evil.example/keys' },
    { alg: 'RS256', typ: 'JWT', kid: 'synthetic-key', jwk: publicKey },
  ]) await assert.rejects(h.verifier.verify(await token({}, header)), failure('invalid_token'));
  const wrongPair = await generateKeyPair('RS256');
  const forged = await new SignJWT(claims()).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-key' }).sign(wrongPair.privateKey);
  await assert.rejects(h.verifier.verify(forged), failure('invalid_token'));
  const hmac = await new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', typ: 'JWT', kid: 'synthetic-key' }).sign(new Uint8Array(32));
  for (const value of [hmac, 'invalid', 'a.b.c', 'a'.repeat(16_385), 'eyJhbGciOiJub25lIn0.e30.']) {
    await assert.rejects(h.verifier.verify(value), failure('invalid_token'));
  }
  assert.deepEqual(new Set(h.requests), new Set([`${config.issuer}/.well-known/openid-configuration`, metadata.jwks_uri]));
});

test('unapproved client/owner and forged or foreign identity objects cannot authorize', async () => {
  const h = harness();
  await assert.rejects(h.verifier.verify(await token({ client_id: 'other-client' })), failure('access_denied'));
  await assert.rejects(h.authenticate(new Headers({ authorization: `Bearer ${await token({ sub: '00000000-0000-4000-8000-000000000003' })}` }), ['tracker:read']), failure('access_denied'));
  const identity = await h.verifier.verify(await token());
  const forged = { ...identity } as VerifiedExternalIdentity;
  await assert.rejects(h.resolver.resolve(forged), failure('access_denied'));
  assert.throws(() => h.requireScopes(forged, ['tracker:read']), failure('access_denied'));
  await assert.rejects(harness().resolver.resolve(identity), failure('access_denied'));
});

test('full owner permissions are internal policy, not unsupported OAuth scopes', async () => {
  const h = harness();
  const identity = await h.verifier.verify(await token({ scope: 'openid', permissions: [] }));
  for (const scope of ['tracker:read', 'entries:write', 'entries:delete', 'targets:write'] as const) h.requireScopes(identity, [scope]);
  assert.throws(() => h.requireScopes(identity, []), failure('access_denied'));
  assert.throws(() => h.requireScopes(identity, ['unknown:admin' as never]), failure('access_denied'));
  await assert.rejects(h.verifier.verify(await token({ scope: 'email profile' })), failure('insufficient_scope'));
  await assert.rejects(h.verifier.verify(await token({ aud: 'authenticated', client_id: undefined })), failure('invalid_token'));
});

test('metadata issuer/key URL mismatch, network failures and malformed/oversized JWKS deny access', async () => {
  for (const response of [
    Response.json({ ...metadata, issuer: 'https://evil.example/' }),
    Response.json({ ...metadata, jwks_uri: 'https://evil.example/keys' }),
    Response.json(null), Response.json({}), new Response('', { status: 503 }),
    Response.json({ secret: 'x'.repeat(70_000) }),
  ]) {
    let calls = 0;
    const h = createOwnerAuthentication(config, async () => { calls++; return response; });
    await assert.rejects(h.verifier.verify(await token()), failure('temporarily_unavailable'));
    await assert.rejects(h.verifier.verify(await token()), failure('temporarily_unavailable'));
    assert.equal(calls, 1, 'bad discovery is not followed; retries are bounded');
  }
  for (const body of [
    { keys: [] }, { keys: [{ ...publicKey, d: 'private' }] },
    { keys: [{ ...publicKey, n: 'short' }] },
    { keys: [{ ...publicKey, n: Buffer.alloc(256, 1).toString('base64url') }] },
    { keys: [publicKey, publicKey] },
  ]) {
    const h = createOwnerAuthentication(config, async input => Response.json(String(input).endsWith('openid-configuration') ? metadata : body));
    await assert.rejects(h.verifier.verify(await token()), failure('temporarily_unavailable'));
  }
  const h = createOwnerAuthentication(config, async () => { throw new Error('sensitive provider error'); });
  await assert.rejects(h.verifier.verify(await token()), failure('temporarily_unavailable'));
});

test('unknown key IDs and concurrent requests cannot amplify JWKS network requests', async () => {
  const h = harness();
  const good = await token();
  await Promise.all(Array.from({ length: 10 }, () => h.verifier.verify(good)));
  assert.equal(h.requests.length, 2);
  for (let i = 0; i < 5; i++) {
    const unknown = await token({}, { alg: 'RS256', typ: 'JWT', kid: `unknown-${i}` });
    await assert.rejects(h.verifier.verify(unknown), failure('invalid_token'));
  }
  assert.equal(h.requests.length, 2);
});

test('key rotation refreshes after cooldown and cached identities expire without reuse', async t => {
  const realNow = Date.now;
  let instant = realNow();
  t.mock.method(Date, 'now', () => instant);
  const replacement = await generateKeyPair('RS256');
  const replacementJwk = { ...await exportJWK(replacement.publicKey), kid: 'rotated', alg: 'RS256', use: 'sig' };
  let rotated = false;
  let calls = 0;
  const h = createOwnerAuthentication(config, async input => {
    calls++;
    return Response.json(String(input).endsWith('openid-configuration') ? metadata : { keys: rotated ? [replacementJwk] : [publicKey] });
  });
  const identity = await h.verifier.verify(await token({ exp: Math.floor(instant / 1000) + 1 }));
  const rotatedToken = await new SignJWT(claims()).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'rotated' }).sign(replacement.privateKey);
  instant += 31_000;
  rotated = true;
  await h.verifier.verify(rotatedToken);
  assert.equal(calls, 4);
  await assert.rejects(h.resolver.resolve(identity), failure('access_denied'));
  assert.throws(() => h.requireScopes(identity, ['tracker:read']), failure('access_denied'));
});

test('expired JWKS cache is never used when refresh is unavailable', async t => {
  let instant = Date.now();
  t.mock.method(Date, 'now', () => instant);
  const fixture = harness();
  let available = true;
  const h = createOwnerAuthentication(config, async (input, init) => {
    if (!available) throw new Error('Unavailable');
    return fixture.fetcher(input, init);
  });
  const signed = await token({ exp: Math.floor(instant / 1000) + 600 });
  await h.verifier.verify(signed);
  instant += 301_000;
  available = false;
  await assert.rejects(h.verifier.verify(signed), failure('temporarily_unavailable'));
});

test('bearer parser and OAuth responses are generic, uncached and injection-safe', async () => {
  assert.throws(() => bearerToken(new Headers()), failure('missing_token'));
  for (const value of ['Basic secret', 'Bearer secret', 'Bearer a.b.c, Bearer d.e.f', 'Bearer  a.b.c']) {
    assert.throws(() => bearerToken(new Headers({ authorization: value })), failure('invalid_token'));
  }
  for (const [code, status] of [['missing_token', 401], ['invalid_token', 401], ['insufficient_scope', 403], ['access_denied', 403], ['temporarily_unavailable', 503]] as const) {
    const response = oauthFailureResponse(new AuthenticationError(code), config, ['entries:write']);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const challenge = response.headers.get('www-authenticate');
    if (status === 401 || code === 'insufficient_scope') {
      assert(challenge?.includes('resource_metadata="https://synthetic-tracker.vercel.app/.well-known/oauth-protected-resource/mcp"'));
      assert(challenge?.includes('scope="openid"'));
    } else assert.equal(challenge, null);
    assert.deepEqual(await response.json(), { error: code });
  }
  const response = oauthFailureResponse(new Error('sensitive token'), config, ['tracker:read']);
  assert.deepEqual(await response.json(), { error: 'temporarily_unavailable' });
});


test('Supabase ES256 profile validates with P-256 JWKS and rejects algorithm confusion', async () => {
  const es = await generateKeyPair('ES256');
  const key = { ...await exportJWK(es.publicKey), kid: 'es-key', alg: 'ES256', use: 'sig' };
  const esConfig = { ...config, signingAlgorithm: 'ES256' as const };
  const h = createOwnerAuthentication(esConfig, async input => Response.json(String(input).endsWith('openid-configuration') ? metadata : { keys: [key] }));
  const signed = await new SignJWT(claims()).setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'es-key' }).sign(es.privateKey);
  assert.equal((await h.verifier.verify(signed)).subject, config.ownerUserId);
  await assert.rejects(h.verifier.verify(await token()), failure('invalid_token'));
  const invalid = createOwnerAuthentication(esConfig, async input => Response.json(String(input).endsWith('openid-configuration') ? metadata : { keys: [{ ...key, crv: 'P-384' }] }));
  await assert.rejects(invalid.verifier.verify(signed), failure('temporarily_unavailable'));
});
