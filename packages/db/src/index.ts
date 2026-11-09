import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { MutationUnitOfWork } from '@weight-tracker/domain';

/** Schema-free type boundary only. No driver is constructed and no socket opens. */
export type PlannedDatabase = PostgresJsDatabase<Record<string, never>>;
export type PlannedMutationUnitOfWork = MutationUnitOfWork<PlannedDatabase>;

// Phase 1B must supply owner-scoped transactions, RLS, migrations and durable
// operation records. A plain Drizzle connection is not itself an authorization boundary.
