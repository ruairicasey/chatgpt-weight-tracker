import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, rpc, toolCall } from './helpers/mcp.js';

test('App Router exports use the gated, authenticated gateway for MCP and both metadata paths', async t => {
  const h = fixture();
  const previous = Object.fromEntries(Object.keys(h.env).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, h.env);
  // Intercept before route modules construct their gateway. No hosted issuer exists.
  t.mock.method(globalThis, 'fetch', h.fetcher);
  const route = await import('../apps/web/app/mcp/route.js');
  const metadata = await import('../apps/web/app/.well-known/oauth-protected-resource/mcp/route.js');
  const rootMetadata = await import('../apps/web/app/.well-known/oauth-protected-resource/route.js');
  assert.equal(metadata.GET().status, 200);
  assert.deepEqual(await rootMetadata.GET().json(), await metadata.GET().json());
  assert.equal((await route.POST(h.request(toolCall('read_probe', { slot: 'synthetic-1' })))).status, 401);
  const body = await rpc(await route.POST(h.request(toolCall('read_probe', { slot: 'synthetic-1' }), await h.token())));
  assert.equal((body.result as { structuredContent: { found: boolean } }).structuredContent.found, false);
  process.env.MCP_EXPERIMENT_ENABLED = 'false';
  assert.equal((await route.POST(h.request({}))).status, 503);
  assert.equal(metadata.GET().status, 503);
});
