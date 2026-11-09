import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createMcpExperiment } from '@weight-tracker/mcp/server';

export const syntheticEnv = {
  MCP_OAUTH_ISSUER: 'https://synthetic-probe.au.auth0.com/',
  MCP_OAUTH_AUDIENCE: 'https://synthetic-probe.vercel.app/mcp',
  MCP_OAUTH_CLIENT_ID: 'synthetic-chatgpt-client',
  MCP_OWNER_SUBJECT: 'auth0|synthetic-owner',
  MCP_OWNER_USER_ID: '00000000-0000-4000-8000-000000000001',
  MCP_EXPERIMENT_ENABLED: 'true',
};
const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), use: 'sig', alg: 'RS256', kid: 'synthetic-only' };

export function fixture() {
  const env = { ...syntheticEnv, MCP_EXPERIMENT_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString() };
  let fetches = 0;
  const fetcher: typeof fetch = async input => {
    fetches++;
    const url = String(input);
    if (url === `${env.MCP_OAUTH_ISSUER}.well-known/openid-configuration`) return Response.json({ issuer: env.MCP_OAUTH_ISSUER, jwks_uri: `${env.MCP_OAUTH_ISSUER}.well-known/jwks.json` });
    if (url === `${env.MCP_OAUTH_ISSUER}.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    throw new Error('Unexpected external request in test');
  };
  async function token(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: env.MCP_OAUTH_ISSUER, aud: env.MCP_OAUTH_AUDIENCE, sub: env.MCP_OWNER_SUBJECT,
      client_id: env.MCP_OAUTH_CLIENT_ID, scope: 'tracker:read entries:write', iat: now, exp: now + 300, jti: randomUUID(), ...overrides,
    }).setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'synthetic-only' }).sign(pair.privateKey);
  }
  const app = createMcpExperiment(env, fetcher);
  function request(body: unknown, bearer?: string, headers: Record<string, string> = {}) {
    return new Request(env.MCP_OAUTH_AUDIENCE, { method: 'POST', headers: { 'content-type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers }, body: JSON.stringify(body) });
  }
  return { env, fetcher, token, app, request, fetches: () => fetches };
}

export async function rpc(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const body = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6)).at(-1)
    : text;
  return JSON.parse(body ?? '{}') as Record<string, unknown>;
}

export function toolCall(name: string, args: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } };
}
