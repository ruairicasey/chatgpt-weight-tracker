import 'server-only';
import type { SupabaseWebConfig } from '@weight-tracker/config/server';
import { AuthenticationError } from './errors';

const denied = () => new AuthenticationError('access_denied');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function authorizationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw denied();
  return value;
}
export function requireWebOwner(user: { id: string; is_anonymous?: boolean } | null, config: SupabaseWebConfig) {
  if (!user || user.id !== config.ownerId || user.is_anonymous !== false) throw denied();
}
export function requireSameOrigin(origin: string | null, config: SupabaseWebConfig) {
  if (origin !== config.origin) throw denied();
}
/** Only the exact operator-registered ChatGPT callback may receive codes/state. */
export function consentRedirect(value: unknown, config: SupabaseWebConfig): string {
  if (typeof value !== 'string' || value.length > 8192) throw denied();
  let url: URL;
  try { url = new URL(value); } catch { throw denied(); }
  if (url.username || url.password || url.hash || `${url.origin}${url.pathname}` !== config.callbackUri) throw denied();
  return url.href;
}
export function requireConsentDetails(value: unknown, config: SupabaseWebConfig, id: string) {
  if (!record(value) || value.authorization_id !== authorizationId(id) || !record(value.client) ||
      value.client.id !== config.clientId || !record(value.user) || value.user.id !== config.ownerId ||
      value.redirect_uri !== config.callbackUri || typeof value.scope !== 'string') throw denied();
  const scopes = value.scope.split(' ');
  if (!scopes.includes('openid') || scopes.some(scope => !['openid', 'email', 'profile', 'phone'].includes(scope))) throw denied();
}
/** No caller-controlled return URLs; preserve only a bounded authorization ID. */
export function loginDestination(id: unknown) {
  return id === null || id === undefined || id === '' ? '/login?success=1' : `/oauth/consent?authorization_id=${authorizationId(id)}`;
}

export interface ConsentProvider {
  owner(): Promise<{ id: string; is_anonymous?: boolean } | null>;
  details(id: string): Promise<unknown>;
  decide(id: string, decision: 'approve' | 'deny'): Promise<string>;
}
/** Revalidate immediately before provider mutation; no browser-supplied client/owner. */
export async function executeConsentDecision(
  input: { origin: string | null; id: unknown; decision: unknown },
  config: SupabaseWebConfig,
  provider: ConsentProvider,
): Promise<string> {
  requireSameOrigin(input.origin, config);
  const id = authorizationId(input.id);
  if (input.decision !== 'approve' && input.decision !== 'deny') throw denied();
  requireWebOwner(await provider.owner(), config);
  requireConsentDetails(await provider.details(id), config, id);
  return consentRedirect(await provider.decide(id, input.decision), config);
}

/** Small, bounded form body. Reject duplicate fields and non-browser form encodings. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  if (!(request.headers.get('content-type')?.split(';')[0]?.trim() === 'application/x-www-form-urlencoded')) throw new Error('Invalid form');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Invalid form');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new Error('Invalid form');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new Error('Invalid form');
  return form;
}
