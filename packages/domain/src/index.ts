import type { VerifiedPrincipal } from '@weight-tracker/auth';
import type { OperationEnvelope, OperationReceipt } from '@weight-tracker/contracts';

export type MutationContext = Readonly<{
  principal: VerifiedPrincipal;
  operation: OperationEnvelope;
}>;

/** Contract for future atomic mutations; not an implementation or persistence claim. */
export interface MutationUnitOfWork<Transaction> {
  execute<Result>(
    context: MutationContext,
    work: (transaction: Transaction) => Promise<Result>,
  ): Promise<Readonly<{ result: Result; receipt: OperationReceipt }>>;
}

// No food, weight, exercise or target services are implemented in Phase 1A.
