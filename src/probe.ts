import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const keySchema = z.string().regex(/^(plus|control)-probe-00[1-9]$/);
const valueSchema = z.enum(['synthetic-apple', 'synthetic-banana', 'synthetic-control']);
type RecordValue = { value: z.infer<typeof valueSchema>; receipt: string };
export type ProbeEvent = {
  tool: 'read_probe' | 'write_probe';
  key: string;
  outcome: 'missing' | 'found' | 'created' | 'replayed' | 'conflict';
  instanceId: string;
  receipt?: string;
};

export function createProbeApp(options: {
  now?: () => number;
  ttlMs?: number;
  requestsPerMinute?: number;
  onEvent?: (event: ProbeEvent) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const expiresAt = now() + (options.ttlMs ?? 900_000);
  const instanceId = randomUUID();
  // One store per process/app, never per MCP transport or client session.
  const records = new Map<string, RecordValue>();
  let windowStart = now();
  let requests = 0;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (now() >= expiresAt) {
      records.clear();
      res.status(410).json({ error: 'probe_expired' });
      return;
    }
    // Global budget: cannot be bypassed by spoofing forwarded IP headers.
    if (now() - windowStart >= 60_000) { windowStart = now(); requests = 0; }
    if (++requests > (options.requestsPerMinute ?? 120)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowStart + 60_000 - now()) / 1000))));
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    // The documented tunnel rewrites Host to localhost:3000.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')) {
      res.status(403).json({ error: 'invalid_host' });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && ![
      'https://chatgpt.com', 'https://chat.openai.com',
      'http://localhost:6274', 'http://127.0.0.1:6274',
    ].includes(origin)) {
      res.status(403).json({ error: 'invalid_origin' });
      return;
    }
    next();
  });
  app.post('/mcp', express.json({ limit: '4kb' }), async (req, res) => {
    // Stateless Streamable HTTP avoids an unbounded session registry; transports
    // are request-local, but all clients use the shared map above.
    const server = new McpServer({ name: 'disposable-write-probe', version: '0.0.0' });
    const result = (data: Record<string, unknown>, isError = false) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
      structuredContent: data,
      ...(isError ? { isError: true } : {}),
    });
    const common = { securitySchemes: [{ type: 'noauth' }] };
    server.registerTool('read_probe', {
      description: 'Read a disposable synthetic probe record. Use this to verify the server state.',
      inputSchema: z.object({ key: keySchema }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: common,
    }, async ({ key }) => {
      const record = records.get(key);
      options.onEvent?.({ tool: 'read_probe', key, outcome: record ? 'found' : 'missing', instanceId, ...(record ? { receipt: record.receipt } : {}) });
      return result({ instanceId, key, found: Boolean(record), ...record });
    });
    server.registerTool('write_probe', {
      description: 'Create an in-memory synthetic test record. Use this to test actual write execution. No durable storage.',
      inputSchema: z.object({ key: keySchema, value: valueSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: common,
    }, async ({ key, value }) => {
      const existing = records.get(key);
      if (existing && existing.value !== value) {
        options.onEvent?.({ tool: 'write_probe', key, outcome: 'conflict', instanceId });
        return result({ error: 'idempotency_conflict', instanceId, key }, true);
      }
      const record = existing ?? { value, receipt: randomUUID() };
      // No await between lookup and insertion: concurrent requests cannot double-insert.
      records.set(key, record);
      const outcome = existing ? 'replayed' : 'created';
      options.onEvent?.({ tool: 'write_probe', key, outcome, instanceId, receipt: record.receipt });
      return result({ instanceId, key, ...record, outcome, recordCount: records.size });
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => { void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'transport_error' });
      else res.end();
    }
  });
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
  });
  app.use((_req, res) => { res.status(404).json({ error: 'not_found' }); });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_body' });
  };
  app.use(errors);
  return { app, instanceId, clear: () => records.clear() };
}
