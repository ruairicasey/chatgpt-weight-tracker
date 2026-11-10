import 'server-only';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { validateOAuthConfig, type OAuthConfig } from '@weight-tracker/config/server';
import { TrackerScopeSchema, UserIdSchema, type TrackerScope } from '@weight-tracker/contracts';
import type { McpTokenVerifier, PrincipalResolver, VerifiedExternalIdentity, VerifiedPrincipal } from './index';
import { AuthenticationError, bearerToken, checkedScopes } from './errors';
import { trustedKeys } from './trusted-keys';

export { AuthenticationError, bearerToken, oauthFailureResponse } from './errors';

/** A closure owns authentic identities; a type assertion or JSON copy cannot mint one. */
export function createOwnerAuthentication(input: OAuthConfig, fetcher: typeof fetch = fetch): {
  verifier: McpTokenVerifier;
  resolver: PrincipalResolver;
  requireScopes(identity: VerifiedExternalIdentity, scopes: readonly TrackerScope[]): void;
  authenticate(headers: Headers, scopes: readonly TrackerScope[]): Promise<VerifiedPrincipal>;
} {
  const config = validateOAuthConfig(input);
  const keys = trustedKeys(config, fetcher);
  const identities = new WeakSet<VerifiedExternalIdentity>();
  const expirations = new WeakMap<VerifiedExternalIdentity, number>();
  const denied = () => new AuthenticationError('access_denied');
  function assertIdentity(identity: VerifiedExternalIdentity) {
    if (!identities.has(identity) || Date.now() >= (expirations.get(identity) ?? 0)) throw denied();
  }

  const verifier: McpTokenVerifier = {
    async verify(accessToken) {
      try {
        if (typeof accessToken !== 'string' || accessToken.length > 16_384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) throw new AuthenticationError('invalid_token');
        const header = decodeProtectedHeader(accessToken);
        if (header.alg !== config.signingAlgorithm || header.typ !== 'JWT' || typeof header.kid !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(header.kid) ||
            'jku' in header || 'jwk' in header || 'x5u' in header || 'crit' in header) throw new AuthenticationError('invalid_token');
        const { payload } = await jwtVerify(accessToken, keys, {
          issuer: config.issuer, audience: config.audience, algorithms: [config.signingAlgorithm], typ: 'JWT',
          requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'client_id', 'scope', 'role', 'session_id', 'is_anonymous'],
          clockTolerance: 0, maxTokenAge: 600,
        });
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isSafeInteger(payload.exp) || !Number.isSafeInteger(payload.iat) || payload.iat! > now ||
            payload.exp! <= payload.iat! || payload.exp! - payload.iat! > 600 ||
            typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
            payload.role !== 'authenticated' || payload.is_anonymous !== false ||
            !UserIdSchema.safeParse(payload.session_id).success || !UserIdSchema.safeParse(payload.sub).success ||
            typeof payload.scope !== 'string' || payload.scope.length > 2048 || !/^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/.test(payload.scope)) throw new AuthenticationError('invalid_token');
        if (payload.client_id !== config.clientId || payload.sub !== config.ownerUserId) throw denied();
        if (!payload.scope.split(' ').includes('openid')) throw new AuthenticationError('insufficient_scope');
        // Internal domain permissions: fixed owner policy, NOT Supabase OAuth scopes.
        // Never derive grants from user_metadata, permissions or caller arguments.
        const scopes = TrackerScopeSchema.options;
        const identity = Object.freeze({ issuer: config.issuer, subject: payload.sub, clientId: config.clientId, scopes: Object.freeze([...new Set(scopes)]) }) as VerifiedExternalIdentity;
        identities.add(identity);
        expirations.set(identity, payload.exp! * 1000);
        return identity;
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError('invalid_token');
      }
    },
  };
  const resolver: PrincipalResolver = {
    async resolve(identity) {
      assertIdentity(identity);
      if (identity.issuer !== config.issuer || identity.clientId !== config.clientId || identity.subject !== config.ownerUserId) throw denied();
      return Object.freeze({ userId: UserIdSchema.parse(config.ownerUserId), identity }) as VerifiedPrincipal;
    },
  };
  function requireScopes(identity: VerifiedExternalIdentity, scopes: readonly TrackerScope[]) {
    assertIdentity(identity);
    if (checkedScopes(scopes).some(scope => !identity.scopes.includes(scope))) throw new AuthenticationError('insufficient_scope');
  }
  return Object.freeze({
    verifier, resolver, requireScopes,
    async authenticate(headers: Headers, scopes: readonly TrackerScope[]) {
      const identity = await verifier.verify(bearerToken(headers));
      const principal = await resolver.resolve(identity);
      requireScopes(identity, scopes);
      return principal;
    },
  });
}
