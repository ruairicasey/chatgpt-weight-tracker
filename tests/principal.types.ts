import type { VerifiedExternalIdentity, VerifiedPrincipal } from '@weight-tracker/auth';
import type { MutationContext } from '@weight-tracker/domain';
import { UserIdSchema } from '@weight-tracker/contracts';

const userId = UserIdSchema.parse('f54ced07-d5b0-47c7-8d80-c2e6e5f3374a');
// These negative assertions run during typecheck, not token validation.
// @ts-expect-error A parsed user ID alone cannot establish a verified principal.
export const forgedPrincipal: VerifiedPrincipal = { userId };
// @ts-expect-error Decoded claims lack the verifier-owned identity brand.
export const forgedIdentity: VerifiedExternalIdentity = { issuer: 'https://example.invalid/', subject: 'synthetic', clientId: 'synthetic', scopes: [] };
// @ts-expect-error Mutation context requires a verified principal, not a user ID.
export const forgedContext: MutationContext = { principal: userId, operation: {} };
