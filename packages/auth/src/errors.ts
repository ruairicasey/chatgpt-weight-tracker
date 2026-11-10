import 'server-only';
import { TrackerScopeSchema, type TrackerScope } from '@weight-tracker/contracts';
import { validateOAuthConfig, type OAuthConfig } from '@weight-tracker/config/server';

export type AuthFailure = 'missing_token' | 'invalid_token' | 'insufficient_scope' | 'access_denied' | 'temporarily_unavailable';
export class AuthenticationError extends Error {
  constructor(readonly code: AuthFailure) {
    super('Authentication or authorization failed.');
    this.name = 'AuthenticationError';
  }
}

export function checkedScopes(scopes: readonly TrackerScope[]): readonly TrackerScope[] {
  if (!scopes.length || scopes.some(scope => !TrackerScopeSchema.safeParse(scope).success)) {
    throw new AuthenticationError('access_denied');
  }
  return Object.freeze([...new Set(scopes)]);
}

/** Challenges request only a standard scope supported by Supabase. */
export function oauthFailureResponse(error: unknown, config: OAuthConfig, requiredScopes: readonly TrackerScope[]): Response {
  const trusted = validateOAuthConfig(config);
  checkedScopes(requiredScopes);
  const scopes = 'openid';
  const code = error instanceof AuthenticationError ? error.code : 'temporarily_unavailable';
  const status = code === 'temporarily_unavailable' ? 503 : code === 'access_denied' || code === 'insufficient_scope' ? 403 : 401;
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Pragma': 'no-cache' });
  if (status === 401 || code === 'insufficient_scope') {
    const metadata = new URL('/.well-known/oauth-protected-resource/mcp', trusted.audience).href;
    // Values come exclusively from validated configuration and known scope constants.
    const detail = code === 'missing_token' ? '' : `, error="${code}"`;
    headers.set('WWW-Authenticate', `Bearer resource_metadata="${metadata}", scope="${scopes}"${detail}`);
  }
  return Response.json({ error: code }, { status, headers });
}

export function bearerToken(headers: Headers): string {
  const value = headers.get('authorization');
  if (value === null) throw new AuthenticationError('missing_token');
  if (value.length > 16_384) throw new AuthenticationError('invalid_token');
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(value);
  if (!match) throw new AuthenticationError('invalid_token');
  return match[1]!;
}
