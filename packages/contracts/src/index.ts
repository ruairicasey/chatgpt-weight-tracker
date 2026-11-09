import { z } from 'zod';

export const MELBOURNE_TIME_ZONE = 'Australia/Melbourne' as const;
export const UserIdSchema = z.uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserIdSchema>;
export const OperationKeySchema = z.uuid().brand<'OperationKey'>();
export type OperationKey = z.infer<typeof OperationKeySchema>;

export const TrackerScopeSchema = z.enum([
  'tracker:read', 'entries:write', 'entries:delete', 'targets:write',
]);
export type TrackerScope = z.infer<typeof TrackerScopeSchema>;

// No acting user ID: identity belongs to trusted server context, never arguments.
export const OperationEnvelopeSchema = z.strictObject({
  operationKey: OperationKeySchema,
  contractVersion: z.literal(1),
});
export type OperationEnvelope = z.infer<typeof OperationEnvelopeSchema>;

export const OperationReceiptSchema = z.strictObject({
  operationKey: OperationKeySchema,
  receiptId: z.uuid(),
  committedAt: z.iso.datetime({ offset: true }),
  outcome: z.enum(['created', 'replayed']),
});
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;

export const ServiceErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED', 'AUTHORIZATION_DENIED', 'INTEGRATION_NOT_CONFIGURED',
  'IDEMPOTENCY_CONFLICT', 'VALIDATION_FAILED', 'SERVICE_UNAVAILABLE',
]);
export type ServiceErrorCode = z.infer<typeof ServiceErrorCodeSchema>;
