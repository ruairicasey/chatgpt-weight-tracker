import 'server-only';
import { z } from 'zod';

const text = z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/);
const issuer = z.string().regex(/^https:\/\/[a-z0-9][a-z0-9-]*\.(?:[a-z]{2}\.)?auth0\.com\/$/);
const resource = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.port && url.pathname === '/mcp' && !url.search && !url.hash && url.href === value;
  } catch { return false; }
});

const schema = z.strictObject({
  issuer,
  audience: resource,
  clientId: text,
  ownerSubject: text.refine(value => !value.endsWith('@clients')),
  ownerUserId: z.uuid(),
});

export type OAuthConfig = Readonly<z.infer<typeof schema>>;

export class OAuthConfigurationError extends Error {
  constructor() {
    super('Invalid server OAuth configuration.');
    this.name = 'OAuthConfigurationError';
  }
}

export function validateOAuthConfig(input: unknown): OAuthConfig {
  const result = schema.safeParse(input);
  if (!result.success) throw new OAuthConfigurationError();
  return Object.freeze(result.data);
}

/** Explicit call only; no import-time environment access, defaults or credentials. */
export function loadOAuthConfig(env: Readonly<Record<string, string | undefined>>): OAuthConfig {
  if (Object.keys(env).some(key => key.startsWith('NEXT_PUBLIC_') && /AUTH0|MCP_OAUTH|MCP_OWNER/.test(key))) {
    throw new OAuthConfigurationError();
  }
  return validateOAuthConfig({
    issuer: env.MCP_OAUTH_ISSUER,
    audience: env.MCP_OAUTH_AUDIENCE,
    clientId: env.MCP_OAUTH_CLIENT_ID,
    ownerSubject: env.MCP_OWNER_SUBJECT,
    ownerUserId: env.MCP_OWNER_USER_ID,
  });
}
