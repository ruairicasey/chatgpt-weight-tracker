import { z } from 'zod';
import { MELBOURNE_TIME_ZONE } from '@weight-tracker/contracts';

// Explicit input only: importing this module never reads credentials or process.env.
// Future secret-bearing configuration must live behind a server-only entry point.
export const FoundationConfigSchema = z.strictObject({
  environment: z.enum(['development', 'test', 'production']),
  additionalMonthlyBudget: z.literal(0),
  hostingPlan: z.literal('vercel-hobby'),
  databasePlan: z.literal('supabase-free'),
  mcpOAuthPlan: z.literal('auth0-free'),
  timezone: z.literal(MELBOURNE_TIME_ZONE),
});
export type FoundationConfig = z.infer<typeof FoundationConfigSchema>;

export class ConfigurationError extends Error {
  constructor() {
    // Do not echo input or validation issues; future inputs may contain secrets.
    super('Invalid foundation configuration. Only the approved zero-cost policy is supported.');
    this.name = 'ConfigurationError';
  }
}

export function parseFoundationConfig(input: unknown): FoundationConfig {
  const result = FoundationConfigSchema.safeParse(input);
  if (!result.success) throw new ConfigurationError();
  return result.data;
}
