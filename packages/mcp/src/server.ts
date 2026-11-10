import 'server-only';
import { createMcpHandler, McpServer, readRequestBody, isJsonContentType, type CallToolResult } from '@modelcontextprotocol/server';
import { AuthenticationError, bearerToken, createOwnerAuthentication, oauthFailureResponse } from '@weight-tracker/auth/server';
import { loadMcpExperimentConfig } from '@weight-tracker/config/server';
import type { TrackerScope } from '@weight-tracker/contracts';
import type { VerifiedPrincipal } from '@weight-tracker/auth';
import { createProbeStore, ReadProbeSchema, WriteProbeSchema } from './probes';

const METHODS = new Set(['initialize', 'notifications/initialized', 'ping', 'server/discover', 'tools/list', 'tools/call']);
const SCOPES = ['tracker:read', 'entries:write'] as const;
const VERSIONS = new Set(['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26']);
const MAX_BODY = 16_384;

function json(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export function inactiveMcpResponse() { return json('INTEGRATION_NOT_CONFIGURED', 503); }

function uncached(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function result(value: object, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { ...value }, ...(isError ? { isError: true } : {}) };
}

/** One shared bounded store/verifier; every request receives a fresh MCP handler. */
export function createMcpExperiment(env: Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch) {
  const config = loadMcpExperimentConfig(env);
  const authentication = createOwnerAuthentication(config.oauth, fetcher);
  const store = createProbeStore(config.expiresAt);
  const origin = new URL(config.oauth.audience).origin;
  let windowStart = Date.now();
  let requests = 0;

  function active() {
    if (Date.now() >= config.expiresAt) {
      store.clear();
      throw new AuthenticationError('temporarily_unavailable');
    }
  }
  function tools(principal: VerifiedPrincipal) {
    const server = new McpServer({ name: 'weight-tracker-synthetic-probe', version: '0.1.0' }, {
      maxToolInputElements: 16,
      supportedProtocolVersions: [...VERSIONS],
    });
    const authorize = (scope: TrackerScope, work: () => CallToolResult): CallToolResult => {
      try {
        active();
        authentication.requireScopes(principal.identity, [scope]);
        return work();
      } catch (error) {
        const response = oauthFailureResponse(error, config.oauth, [scope]);
        const challenge = response.headers.get('WWW-Authenticate');
        return { ...result({ error: error instanceof AuthenticationError ? error.code : 'temporarily_unavailable' }, true),
          ...(challenge ? { _meta: { 'mcp/www_authenticate': [challenge] } } : {}) };
      }
    };
    server.registerTool('read_probe', {
      title: 'Read synthetic connectivity probe',
      description: 'Read a fixed synthetic slot from temporary memory on this server instance. Never supply personal data.',
      inputSchema: ReadProbeSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['openid'] }] },
    }, input => authorize('tracker:read', () => result(store.read(input.slot))));
    server.registerTool('write_probe', {
      title: 'Write synthetic connectivity probe',
      description: 'MUTATION: create a synthetic alpha/beta/gamma record in bounded temporary instance memory. No personal data. Receipts/replay expire after ten minutes or restart.',
      inputSchema: WriteProbeSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['openid'] }] },
    }, input => authorize('entries:write', () => {
      const value = store.write(input);
      return result(value, 'error' in value);
    }));
    return server;
  }

  return Object.freeze({
    metadata() {
      try { active(); } catch { return inactiveMcpResponse(); }
      return Response.json({ resource: config.oauth.audience, authorization_servers: [config.oauth.issuer],
        scopes_supported: ['openid'], bearer_methods_supported: ['header'],
        resource_name: 'Synthetic MCP connectivity experiment' }, { headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
    },
    async fetch(request: Request): Promise<Response> {
      try { active(); } catch { return inactiveMcpResponse(); }
      if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
      if (++requests > 120) return json('RATE_LIMITED', 429, { 'Retry-After': '60' });
      // Never trust X-Forwarded-Host or Origin as an identity/URL source.
      if (new URL(request.url).origin !== origin ||
          (request.headers.has('host') && request.headers.get('host') !== new URL(origin).host) ||
          (request.headers.has('origin') && request.headers.get('origin') !== origin)) return json('FORBIDDEN_ORIGIN', 403);
      let principal: VerifiedPrincipal;
      try {
        const identity = await authentication.verifier.verify(bearerToken(request.headers));
        principal = await authentication.resolver.resolve(identity);
        if (!SCOPES.some(scope => identity.scopes.includes(scope))) authentication.requireScopes(identity, ['tracker:read']);
        active();
      } catch (error) { return oauthFailureResponse(error, config.oauth, ['tracker:read']); }
      if (request.method !== 'POST') return json('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });
      const revision = request.headers.get('mcp-protocol-version');
      if (revision !== null && !VERSIONS.has(revision)) return json('UNSUPPORTED_PROTOCOL_VERSION', 400);
      if (!isJsonContentType(request.headers.get('content-type'))) return json('UNSUPPORTED_MEDIA_TYPE', 415);
      let parsedBody: unknown;
      try {
        const body = await readRequestBody(request, MAX_BODY);
        if (body.tooLarge) return json('REQUEST_TOO_LARGE', 413);
        parsedBody = JSON.parse(body.text) as unknown;
      } catch { return json('INVALID_REQUEST', 400); }
      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) return json('INVALID_REQUEST', 400);
      const method = (parsedBody as { method?: unknown }).method;
      if (typeof method !== 'string' || !METHODS.has(method)) return json('METHOD_NOT_ALLOWED', 400);
      // No sessions, subscriptions, callbacks, background work or caller authInfo.
      const handler = createMcpHandler(() => tools(principal), {
        legacy: 'stateless', responseMode: 'auto', maxRequestBodySize: MAX_BODY, maxSubscriptions: 0, keepAliveMs: 0,
      });
      try { return uncached(await handler.fetch(request, { parsedBody })); }
      catch { return json('SERVICE_UNAVAILABLE', 503); }
      finally { await handler.close(); }
    },
  });
}

/** Lazily configured Next.js boundary. Invalidated config also discards old state. */
export function createMcpGateway(environment: () => Readonly<Record<string, string | undefined>>, fetcher: typeof fetch = fetch) {
  let cached: ReturnType<typeof createMcpExperiment> | undefined;
  let fingerprint: string | undefined;
  function current() {
    try {
      const env = environment();
      const key = JSON.stringify(loadMcpExperimentConfig(env));
      if (!cached || key !== fingerprint) {
        cached = createMcpExperiment(env, fetcher);
        fingerprint = key;
      }
      return cached;
    } catch {
      cached = undefined;
      fingerprint = undefined;
      return undefined;
    }
  }
  return Object.freeze({
    async fetch(request: Request) {
      try { return await current()?.fetch(request) ?? inactiveMcpResponse(); }
      catch { return inactiveMcpResponse(); }
    },
    metadata() { return current()?.metadata() ?? inactiveMcpResponse(); },
  });
}
