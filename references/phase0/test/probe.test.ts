import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createProbeApp, type ProbeEvent } from '../src/probe.js';

class ProbeClient extends Client {
  override async callTool(...args: Parameters<Client['callTool']>) {
    return CallToolResultSchema.parse(await super.callTool(...args));
  }
}

async function harness(t: TestContext, options: Parameters<typeof createProbeApp>[0] = {}) {
  const events: ProbeEvent[] = [];
  const probe = createProbeApp({ onEvent: event => events.push(event), ...options });
  const listener = probe.app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  assert(address && typeof address !== 'string');
  const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
  t.after(async () => {
    probe.clear();
    listener.closeAllConnections();
    await new Promise<void>(resolve => listener.close(() => resolve()));
  });
  async function connect() {
    const client = new ProbeClient({ name: 'phase0-test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(url));
    t.after(() => client.close());
    return client;
  }
  return { ...probe, url, events, connect };
}

test('advertises exactly two noauth tools with honest read/write annotations', async t => {
  const h = await harness(t);
  const client = await h.connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['read_probe', 'write_probe']);
  for (const tool of tools) {
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: 'noauth' }]);
    assert.equal(tool.annotations?.readOnlyHint, tool.name === 'read_probe');
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, true);
    assert.equal(tool.annotations?.openWorldHint, false);
  }
});

test('writes real shared state visible to an independent MCP client', async t => {
  const h = await harness(t);
  const first = await h.connect();
  const read = () => first.callTool({ name: 'read_probe', arguments: { key: 'plus-probe-001' } });
  assert.equal((await read()).structuredContent?.found, false);
  const write = await first.callTool({ name: 'write_probe', arguments: { key: 'plus-probe-001', value: 'synthetic-apple' } });
  assert.equal(write.isError, undefined);
  const saved = write.structuredContent!;
  assert.equal(saved.outcome, 'created');
  assert.equal(saved.instanceId, h.instanceId);
  assert.match(String(saved.receipt), /^[0-9a-f-]{36}$/);
  await first.close();
  const second = await h.connect();
  const reread = await second.callTool({ name: 'read_probe', arguments: { key: 'plus-probe-001' } });
  assert.deepEqual(reread.structuredContent, {
    instanceId: h.instanceId, key: 'plus-probe-001', found: true,
    value: 'synthetic-apple', receipt: saved.receipt,
  });
  assert.equal(h.events.filter(event => event.outcome === 'created').length, 1);
});

test('concurrent retries create one record/receipt; conflicting reuse cannot overwrite', async t => {
  const h = await harness(t);
  const clients = await Promise.all([h.connect(), h.connect()]);
  const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => clients[i % 2]!.callTool({
    name: 'write_probe', arguments: { key: 'plus-probe-002', value: 'synthetic-apple' },
  })));
  assert.equal(new Set(writes.map(result => result.structuredContent?.receipt)).size, 1);
  assert.equal(writes.filter(result => result.structuredContent?.outcome === 'created').length, 1);
  assert(writes.every(result => result.structuredContent?.recordCount === 1));
  const conflict = await clients[0]!.callTool({ name: 'write_probe', arguments: { key: 'plus-probe-002', value: 'synthetic-banana' } });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent?.error, 'idempotency_conflict');
  const read = await clients[1]!.callTool({ name: 'read_probe', arguments: { key: 'plus-probe-002' } });
  assert.equal(read.structuredContent?.value, 'synthetic-apple');
  assert.equal(read.structuredContent?.receipt, writes[0]!.structuredContent?.receipt);
});

test('rejects non-synthetic keys/values and unexpected fields before mutation', async t => {
  const h = await harness(t);
  const client = await h.connect();
  for (const args of [
    { key: 'private-note', value: 'synthetic-apple' },
    { key: 'plus-probe-001', value: 'anything-else' },
    { key: 'plus-probe-001', value: 'synthetic-apple', userId: 'other' },
    { key: 'plus-probe-010', value: 'synthetic-apple' },
    { key: 'plus-probe-001' },
  ]) {
    const response = await client.callTool({ name: 'write_probe', arguments: args });
    assert.equal(response.isError, true);
  }
  assert.equal(h.events.length, 0);
  const read = await client.callTool({ name: 'read_probe', arguments: { key: 'plus-probe-001' } });
  assert.equal(read.structuredContent?.found, false);
});

test('limits bodies and rejects untrusted hosts/origins, malformed JSON and unsupported routes', async t => {
  const h = await harness(t);
  const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(h.url, { headers: { Host: 'evil.example' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(h.url, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(h.url)).status, 405);
  assert.equal((await fetch(new URL('/unrelated', h.url))).status, 404);
  assert.equal((await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(h.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(5000) }) })).status, 413);
  assert.equal(h.events.length, 0);
});

test('global rate limit resists spoofed forwarded IPs and resets after a minute', async t => {
  let clock = 0;
  const h = await harness(t, { now: () => clock, requestsPerMinute: 2 });
  assert.equal((await fetch(h.url)).status, 405);
  assert.equal((await fetch(h.url)).status, 405);
  const limited = await fetch(h.url, { headers: { 'X-Forwarded-For': '192.0.2.1' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  clock = 60_000;
  assert.equal((await fetch(h.url)).status, 405);
});

test('expires closed, and a fresh process/app starts with no records and a new ID', async t => {
  let clock = 0;
  const first = await harness(t, { now: () => clock, ttlMs: 1000 });
  const client = await first.connect();
  await client.callTool({ name: 'write_probe', arguments: { key: 'plus-probe-001', value: 'synthetic-apple' } });
  clock = 1000;
  assert.equal((await fetch(first.url)).status, 410);
  const second = await harness(t);
  assert.notEqual(first.instanceId, second.instanceId);
  const secondClient = await second.connect();
  assert.equal((await secondClient.callTool({ name: 'read_probe', arguments: { key: 'plus-probe-001' } })).structuredContent?.found, false);
});
