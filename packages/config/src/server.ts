import 'server-only';
import { z } from 'zod';

const issuer = z.string().regex(/^https:\/\/[a-z0-9]{20}\.supabase\.co\/auth\/v1$/);
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
  clientId: z.uuid(),
  signingAlgorithm: z.enum(['ES256', 'RS256']).default('ES256'),
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
  if (Object.keys(env).some(key => key.startsWith('NEXT_PUBLIC_') && /SUPABASE|CHATGPT|APP_ORIGIN|MCP_OAUTH|MCP_OWNER|MCP_EXPERIMENT/.test(key))) {
    throw new OAuthConfigurationError();
  }
  return validateOAuthConfig({
    issuer: env.MCP_OAUTH_ISSUER,
    audience: env.MCP_OAUTH_AUDIENCE,
    clientId: env.MCP_OAUTH_CLIENT_ID,
    signingAlgorithm: env.MCP_OAUTH_SIGNING_ALGORITHM,
    ownerUserId: env.MCP_OWNER_USER_ID,
  });
}

export type McpExperimentConfig = Readonly<{ oauth: OAuthConfig; expiresAt: number }>;

/** No default activation. A fixed UTC/offset deadline may be at most 24h away. */
export function loadMcpExperimentConfig(env: Readonly<Record<string, string | undefined>>, now = Date.now()): McpExperimentConfig {
  const expiry = z.iso.datetime({ offset: true }).safeParse(env.MCP_EXPERIMENT_EXPIRES_AT);
  if (env.MCP_EXPERIMENT_ENABLED !== 'true' || !expiry.success) throw new OAuthConfigurationError();
  const expiresAt = Date.parse(expiry.data);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 86_400_000) throw new OAuthConfigurationError();
  return Object.freeze({ oauth: loadOAuthConfig(env), expiresAt });
}

const webSchema = z.strictObject({
  supabaseUrl: z.string().regex(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/),
  publishableKey: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{16,256}$/),
  origin: z.url().refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        url.pathname === '/' && !url.search && !url.hash && url.origin === value;
    } catch { return false; }
  }),
  callbackUri: z.url().refine(value => {
    try {
      const url = new URL(value);
      return url.origin === 'https://chatgpt.com' && !url.username && !url.password && !url.search && !url.hash && url.href === value &&
        (url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname));
    } catch { return false; }
  }),
  ownerId: z.uuid(),
  clientId: z.uuid(),
});
export type SupabaseWebConfig = Readonly<z.infer<typeof webSchema>>;

/** Server-only web configuration is independent of experiment activation. */
export function loadSupabaseWebConfig(env: Readonly<Record<string, string | undefined>>): SupabaseWebConfig {
  if (Object.keys(env).some(key => key.startsWith('NEXT_PUBLIC_') && /SUPABASE|CHATGPT|APP_ORIGIN|MCP_/.test(key))) throw new OAuthConfigurationError();
  const result = webSchema.safeParse({ supabaseUrl: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY, origin: env.APP_ORIGIN,
    callbackUri: env.CHATGPT_OAUTH_REDIRECT_URI,
    ownerId: env.MCP_OWNER_USER_ID, clientId: env.MCP_OAUTH_CLIENT_ID });
  if (!result.success || env.MCP_OAUTH_ISSUER !== `${result.data.supabaseUrl}/auth/v1` ||
      env.MCP_OAUTH_AUDIENCE !== `${result.data.origin}/mcp`) throw new OAuthConfigurationError();
  return Object.freeze(result.data);
}
