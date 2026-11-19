import 'server-only';
import { approvedClients, type ApprovedClient, type SupabaseWebConfig } from '@weight-tracker/config/server';
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
/**
 * Only an exact operator-approved callback may receive codes/state. When the requesting
 * client is known, only that client's own callbacks are accepted.
 */
export function consentRedirect(value: unknown, config: SupabaseWebConfig, client?: ApprovedClient): string {
  if (typeof value !== 'string' || value.length > 8192) throw denied();
  let url: URL;
  try { url = new URL(value); } catch { throw denied(); }
  const allowed = client ? client.callbacks : approvedClients(config).flatMap(entry => entry.callbacks);
  if (url.username || url.password || url.hash || !allowed.includes(`${url.origin}${url.pathname}`)) throw denied();
  return url.href;
}
/** Returns the approved client making the request; denies unknown clients or mismatched callbacks. */
export function requireConsentDetails(value: unknown, config: SupabaseWebConfig, id: string): ApprovedClient {
  if (!record(value) || value.authorization_id !== authorizationId(id) || !record(value.client) ||
      !record(value.user) || value.user.id !== config.ownerId || typeof value.scope !== 'string') throw denied();
  const requestingId = value.client.id;
  const client = approvedClients(config).find(entry => entry.id === requestingId);
  if (!client || typeof value.redirect_uri !== 'string' || !client.callbacks.includes(value.redirect_uri)) throw denied();
  const scopes = value.scope.split(' ');
  if (!scopes.includes('openid') || scopes.some(scope => !['openid', 'email', 'profile', 'phone', 'offline_access'].includes(scope))) throw denied();
  return client;
}
/** No caller-controlled return URLs; preserve only a bounded authorization ID. */
export function loginDestination(id: unknown) {
  return id === null || id === undefined || id === '' ? '/dashboard' : `/oauth/consent?authorization_id=${authorizationId(id)}`;
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
  const client = requireConsentDetails(await provider.details(id), config, id);
  return consentRedirect(await provider.decide(id, input.decision), config, client);
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
