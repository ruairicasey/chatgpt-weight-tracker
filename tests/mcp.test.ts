import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/client';
import { createMcpExperiment, createMcpGateway } from '@weight-tracker/mcp/server';
import { loadMcpExperimentConfig, OAuthConfigurationError } from '@weight-tracker/config/server';
import { fixture, rpc, toolCall } from './helpers/mcp.js';

test('activation requires complete config, exact opt-in and a future deadline of at most 24h', () => {
  const h = fixture();
  for (const override of [
    { MCP_EXPERIMENT_ENABLED: undefined }, { MCP_EXPERIMENT_ENABLED: 'TRUE' },
    { MCP_EXPERIMENT_EXPIRES_AT: undefined }, { MCP_EXPERIMENT_EXPIRES_AT: 'invalid' },
    { MCP_EXPERIMENT_EXPIRES_AT: '2026-11-10T12:00:00+99:99' },
    { MCP_EXPERIMENT_EXPIRES_AT: new Date(Date.now() - 1).toISOString() },
    { MCP_EXPERIMENT_EXPIRES_AT: new Date(Date.now() + 86_401_000).toISOString() },
    { MCP_OWNER_SUBJECT: undefined }, { NEXT_PUBLIC_MCP_EXPERIMENT_ENABLED: 'true' },
  ]) assert.throws(() => loadMcpExperimentConfig({ ...h.env, ...override }), OAuthConfigurationError);
  assert(loadMcpExperimentConfig(h.env).expiresAt > Date.now());
});

test('protected resource metadata is canonical, minimal and unauthenticated, and expires', async t => {
  const h = fixture();
  const response = h.app.metadata();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { resource: h.env.MCP_OAUTH_AUDIENCE, authorization_servers: [h.env.MCP_OAUTH_ISSUER],
    scopes_supported: ['tracker:read', 'entries:write'], bearer_methods_supported: ['header'], resource_name: 'Synthetic MCP connectivity experiment' });
  assert.equal(h.fetches(), 0);
  t.mock.method(Date, 'now', () => Date.parse(h.env.MCP_EXPERIMENT_EXPIRES_AT) + 1);
  assert.equal(h.app.metadata().status, 503);
  assert.equal((await h.app.fetch(h.request({}))).status, 503);
});

test('gateway checks every request configuration and discards state after disablement or owner changes', async () => {
  const h = fixture();
  let env: Record<string, string | undefined> = { ...h.env, MCP_EXPERIMENT_ENABLED: undefined };
  const gateway = createMcpGateway(() => env, h.fetcher);
  assert.equal(gateway.metadata().status, 503);
  assert.equal((await gateway.fetch(h.request({}))).status, 503);
  assert.equal(h.fetches(), 0);
  env = { ...h.env };
  assert.equal(gateway.metadata().status, 200);
  const bearer = await h.token();
  await gateway.fetch(h.request(toolCall('write_probe', { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() }), bearer));
  env.MCP_OWNER_SUBJECT = undefined;
  assert.equal((await gateway.fetch(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), bearer))).status, 503);
  env = { ...h.env };
  const read = await rpc(await gateway.fetch(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), bearer)));
  assert.equal((read.result as { structuredContent: { found: boolean } }).structuredContent.found, false);
  env.MCP_OWNER_SUBJECT = 'auth0|another-approved-owner';
  assert.equal((await gateway.fetch(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), bearer))).status, 403);
});

test('anonymous, invalid, expired, wrong audience/client/owner and missing scopes never reach tools', async () => {
  const h = fixture();
  const operation = toolCall('write_probe', { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() });
  for (const [bearer, status, error] of [
    [undefined, 401, 'missing_token'], ['synthetic-invalid', 401, 'invalid_token'],
    [await h.token({ exp: Math.floor(Date.now() / 1000) - 1 }), 401, 'invalid_token'],
    [await h.token({ aud: 'https://other.vercel.app/mcp' }), 401, 'invalid_token'],
    [await h.token({ client_id: 'unapproved' }), 403, 'access_denied'],
    [await h.token({ sub: 'auth0|unapproved' }), 403, 'access_denied'],
    [await h.token({ scope: 'openid' }), 403, 'insufficient_scope'],
  ] as const) {
    const response = await h.app.fetch(h.request(operation, bearer));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (status === 401 || error === 'insufficient_scope') assert.match(response.headers.get('www-authenticate') ?? '', /resource_metadata="https:\/\/synthetic-probe.vercel.app\/\.well-known\/oauth-protected-resource\/mcp"/);
  }
  const read = await rpc(await h.app.fetch(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), await h.token())));
  assert.equal((read.result as { structuredContent: { found: boolean } }).structuredContent.found, false);
});

for (const protocolVersion of ['2025-03-26', '2025-06-18', '2025-11-25']) test(`stateless initialize, discovery, execution and finite SSE work for ${protocolVersion}`, { timeout: 10_000 }, async () => {
  const h = fixture();
  const bearer = await h.token();
  const init = await h.app.fetch(h.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'synthetic-test', version: '1' } } }, bearer));
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('mcp-session-id'), null);
  assert.equal(((await rpc(init)).result as { protocolVersion: string }).protocolVersion, protocolVersion);
  const headers = { 'MCP-Protocol-Version': protocolVersion };
  const list = await rpc(await h.app.fetch(h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, bearer, headers)));
  const tools = (list.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean }; _meta: unknown }> }).tools;
  assert.deepEqual(tools.map(tool => tool.name), ['read_probe', 'write_probe']);
  assert.equal(tools[0]?.annotations.readOnlyHint, true);
  assert.equal(tools[1]?.annotations.readOnlyHint, false);
  assert.deepEqual(tools[1]?._meta, { securitySchemes: [{ type: 'oauth2', scopes: ['entries:write'] }] });
  const write = await rpc(await h.app.fetch(h.request(toolCall('write_probe', { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() }), bearer, headers)));
  assert.equal((write.result as { structuredContent: { outcome: string } }).structuredContent.outcome, 'created');
});

for (const mode of ['legacy', 'auto'] as const) test(`official v2 client ${mode} connects and calls tools using the Fetch handler`, { timeout: 10_000 }, async t => {
  const h = fixture();
  const bearer = await h.token();
  const client = new Client({ name: 'synthetic-sdk-client', version: '1' }, { versionNegotiation: { mode } });
  const transport = new StreamableHTTPClientTransport(new URL(h.env.MCP_OAUTH_AUDIENCE), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
    fetch: async (input, init) => h.app.fetch(new Request(input, init)),
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
  assert.equal((await client.listTools()).tools.length, 2);
  const result = await client.callTool({ name: 'read_probe', arguments: { slot: 'synthetic-1' } });
  assert.equal((result.structuredContent as { found: boolean }).found, false);
  const write = await client.callTool({ name: 'write_probe', arguments: { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() } });
  assert.equal((write.structuredContent as { outcome: string }).outcome, 'created');
});

test('modern discovery and protocol envelopes are verified by the SDK; unsupported/mismatched versions fail', async () => {
  const h = fixture();
  const bearer = await h.token();
  const modern = { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'synthetic-modern-client', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {},
  } } };
  const headers = { 'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': 'server/discover' };
  const discovery = await h.app.fetch(h.request(modern, bearer, headers));
  assert.equal(discovery.status, 200);
  const body = await rpc(discovery);
  assert(body.result);
  assert.equal(discovery.headers.get('content-type')?.split(';')[0], 'application/json');
  assert.equal((await h.app.fetch(h.request(modern, bearer, { ...headers, 'MCP-Protocol-Version': '2025-11-25' }))).status, 400);
  assert.equal((await h.app.fetch(h.request(modern, bearer, { ...headers, 'MCP-Protocol-Version': '2099-01-01' }))).status, 400);
  assert.equal((await h.app.fetch(h.request({ jsonrpc: '2.0', id: 1, method: 'ping' }, bearer, { 'MCP-Protocol-Version': '2026-07-28', 'MCP-Method': 'ping' }))).status, 400);
});

test('all ten fixed slots are bounded and occupied slots cannot silently replace records or receipts', async () => {
  const h = fixture();
  const bearer = await h.token();
  for (let i = 1; i <= 10; i++) {
    const response = await rpc(await h.app.fetch(h.request(toolCall('write_probe', { slot: `synthetic-${i}`, value: 'alpha', operationKey: randomUUID() }), bearer)));
    assert.equal((response.result as { structuredContent: { outcome: string } }).structuredContent.outcome, 'created');
  }
  const occupied = await rpc(await h.app.fetch(h.request(toolCall('write_probe', { slot: 'synthetic-1', value: 'beta', operationKey: randomUUID() }), bearer)));
  assert.equal((occupied.result as { structuredContent: { error: string } }).structuredContent.error, 'SLOT_OCCUPIED');
});

test('temporary writes replay within one instance, conflict safely and disappear on restart/TTL', async t => {
  const h = fixture();
  const bearer = await h.token();
  const args = { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() };
  async function call(app: typeof h.app, name: string, args: Record<string, unknown>) {
    const body = await rpc(await app.fetch(h.request(toolCall(name, args), bearer)));
    return (body.result as { structuredContent: Record<string, unknown>; isError?: boolean });
  }
  const created = (await call(h.app, 'write_probe', args)).structuredContent;
  const replay = (await call(h.app, 'write_probe', args)).structuredContent;
  assert.equal(created.outcome, 'created');
  assert.equal(created.durable, false);
  assert.equal(replay.outcome, 'replayed');
  assert.deepEqual(created.record, replay.record);
  assert.equal(created.instanceId, replay.instanceId);
  const read = (await call(h.app, 'read_probe', { slot: args.slot })).structuredContent;
  assert.deepEqual(read.record, created.record);
  const conflict = await call(h.app, 'write_probe', { ...args, value: 'beta' });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.error, 'IDEMPOTENCY_CONFLICT');
  const restarted = (await call(createMcpExperiment(h.env, h.fetcher), 'read_probe', { slot: args.slot })).structuredContent;
  assert.equal(restarted.found, false);
  assert.notEqual(restarted.instanceId, created.instanceId);
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: now + 601_000 });
  // Fresh synthetic access token after TTL; storage expiry is independent of OAuth expiry.
  const fresh = await h.token();
  const afterTtl = await rpc(await h.app.fetch(h.request(toolCall('read_probe', { slot: args.slot }), fresh)));
  assert.equal((afterTtl.result as { structuredContent: { found: boolean } }).structuredContent.found, false);
});

test('per-tool scope challenges and concurrent requests never inherit another request identity', async () => {
  const h = fixture();
  const readOnly = await h.token({ scope: 'tracker:read' });
  const writeOnly = await h.token({ scope: 'entries:write' });
  const args = { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID() };
  const bodies = await Promise.all([writeOnly, readOnly, undefined, await h.token({ sub: 'auth0|other' })].map(bearer => h.app.fetch(h.request(toolCall('write_probe', args), bearer))));
  assert.deepEqual(bodies.map(response => response.status), [200, 200, 401, 403]);
  const permitted = (await rpc(bodies[0]!)).result as { structuredContent: { outcome: string } };
  assert.equal(permitted.structuredContent.outcome, 'created');
  const denied = (await rpc(bodies[1]!)).result as { isError: boolean; _meta: Record<string, string[]> };
  assert.equal(denied.isError, true);
  assert.match(denied._meta['mcp/www_authenticate']?.[0] ?? '', /error="insufficient_scope"/);
  assert.match(denied._meta['mcp/www_authenticate']?.[0] ?? '', /scope="entries:write"/);
  const deniedRead = await rpc(await h.app.fetch(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), writeOnly)));
  assert.equal((deniedRead.result as { isError: boolean }).isError, true);
});

test('strict synthetic schemas reject forged ownership, arbitrary data and receipt fields', async () => {
  const h = fixture();
  const bearer = await h.token();
  for (const extra of [ { userId: h.env.MCP_OWNER_USER_ID }, { receipt: 'forged' }, { value: 'private-arbitrary-payload' }, { slot: 'custom-slot' } ]) {
    const response = await rpc(await h.app.fetch(h.request(toolCall('write_probe', { slot: 'synthetic-1', value: 'alpha', operationKey: randomUUID(), ...extra }), bearer)));
    assert(response.error || (response.result as { isError?: boolean } | undefined)?.isError);
    assert(!JSON.stringify(response).includes('private-arbitrary-payload'));
    assert(!JSON.stringify(response).includes(h.env.MCP_OWNER_USER_ID));
    assert(!JSON.stringify(response).includes(h.env.MCP_OWNER_SUBJECT));
  }
});

test('method, host/origin, media type, body size, batches and request-rate limits are enforced', async () => {
  const h = fixture();
  const bearer = await h.token();
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Host: 'evil.example' }]) {
    assert.equal((await h.app.fetch(h.request(ping, bearer, headers))).status, 403);
  }
  assert.equal((await h.app.fetch(new Request('https://evil.example/mcp', { headers: { Authorization: `Bearer ${bearer}` } }))).status, 403);
  for (const method of ['GET', 'DELETE']) assert.equal((await h.app.fetch(new Request(h.env.MCP_OAUTH_AUDIENCE, { method, headers: { Authorization: `Bearer ${bearer}` } }))).status, 405);
  assert.equal((await h.app.fetch(h.request(ping, bearer, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await h.app.fetch(h.request({ ...ping, padding: 'x'.repeat(17_000) }, bearer))).status, 413);
  assert.equal((await h.app.fetch(h.request([ping], bearer))).status, 400);
  assert.equal((await h.app.fetch(h.request({ ...ping, method: 'subscriptions/listen' }, bearer))).status, 400);
  const limited = fixture();
  for (let i = 0; i < 120; i++) assert.equal((await limited.app.fetch(limited.request(ping))).status, 401);
  const response = await limited.app.fetch(limited.request(ping));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});
