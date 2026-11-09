import 'server-only';
import { createLocalJWKSet, errors, type JSONWebKeySet, type JWTHeaderParameters } from 'jose';
import type { OAuthConfig } from '@weight-tracker/config/server';
import { AuthenticationError } from './errors.js';

const CACHE_MS = 300_000;
const COOLDOWN_MS = 30_000;
const MAX_BYTES = 65_536;

function strongModulus(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{342,683}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.toString('base64url') === value && bytes.length <= 512 &&
    (bytes.length > 256 ? bytes[0] !== 0 : bytes.length === 256 && bytes[0]! >= 128);
}

/** Only an operator-configured Auth0 issuer may supply metadata/keys. No token URLs. */
export function trustedKeys(config: OAuthConfig, fetcher: typeof fetch) {
  let cached: ReturnType<typeof createLocalJWKSet> | undefined;
  let expires = 0;
  let nextAttempt = 0;
  let pending: Promise<void> | undefined;

  async function json(url: string): Promise<unknown> {
    const response = await fetcher(url, {
      redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/json' }, credentials: 'omit',
    });
    if (!response.ok || !response.body) throw new Error('Discovery unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) throw new Error('Discovery too large');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }

  async function refresh() {
    if (pending) return pending;
    if (Date.now() < nextAttempt) throw new AuthenticationError('temporarily_unavailable');
    nextAttempt = Date.now() + COOLDOWN_MS;
    pending = (async () => {
      const metadata = await json(`${config.issuer}.well-known/openid-configuration`) as Record<string, unknown> | null;
      const jwksUri = `${config.issuer}.well-known/jwks.json`;
      if (!metadata || metadata.issuer !== config.issuer || metadata.jwks_uri !== jwksUri) throw new Error('Untrusted discovery');
      const body = await json(jwksUri) as JSONWebKeySet | null;
      if (!body || !Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 10) throw new Error('Invalid keys');
      const keys = body.keys.filter(key => key && key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256' &&
        typeof key.kid === 'string' && key.kid.length > 0 && !('d' in key) &&
        strongModulus(key.n) && key.e === 'AQAB');
      if (!keys.length || new Set(keys.map(key => key.kid)).size !== keys.length) throw new Error('Invalid signing keys');
      cached = createLocalJWKSet({ keys });
      expires = Date.now() + CACHE_MS;
    })().catch(() => { throw new AuthenticationError('temporarily_unavailable'); }).finally(() => { pending = undefined; });
    return pending;
  }

  return async (header: JWTHeaderParameters) => {
    if (!cached || Date.now() >= expires) await refresh();
    try {
      return await cached!(header);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw new AuthenticationError('invalid_token');
      // Unknown kids cannot trigger unbounded network calls. Rotation may wait 30s.
      if (Date.now() < nextAttempt) throw new AuthenticationError('invalid_token');
      await refresh();
      try { return await cached!(header); }
      catch { throw new AuthenticationError('invalid_token'); }
    }
  };
}
