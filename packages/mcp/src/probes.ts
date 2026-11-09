import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const ReadProbeSchema = z.strictObject({
  slot: z.enum(['synthetic-1', 'synthetic-2', 'synthetic-3', 'synthetic-4', 'synthetic-5',
    'synthetic-6', 'synthetic-7', 'synthetic-8', 'synthetic-9', 'synthetic-10']),
});
export const WriteProbeSchema = ReadProbeSchema.extend({
  operationKey: z.uuid(),
  value: z.enum(['alpha', 'beta', 'gamma']),
});
type Write = z.infer<typeof WriteProbeSchema>;
type Record = Readonly<Write & { receipt: string; createdAt: string; expiresAt: string }>;

/** Synthetic experiment state only; no eviction that silently defeats live replay. */
export function createProbeStore(experimentExpiry: number) {
  const instanceId = randomUUID();
  const records = new Map<string, Record>();
  const info = { instanceId, durable: false, storage: 'temporary-instance-memory' } as const;
  function prune() {
    for (const [slot, record] of records) if (Date.parse(record.expiresAt) <= Date.now()) records.delete(slot);
  }
  return {
    clear() { records.clear(); },
    read(slot: string) {
      prune();
      const record = records.get(slot);
      return { ...info, found: Boolean(record), ...(record ? { record } : {}) };
    },
    write(input: Write) {
      prune();
      const previous = [...records.values()].find(record => record.operationKey === input.operationKey);
      if (previous) return previous.slot === input.slot && previous.value === input.value
        ? { ...info, outcome: 'replayed', record: previous }
        : { ...info, error: 'IDEMPOTENCY_CONFLICT' };
      if (records.has(input.slot)) return { ...info, error: 'SLOT_OCCUPIED' };
      if (records.size >= 10) return { ...info, error: 'CAPACITY_REACHED' };
      const record = Object.freeze({ ...input, receipt: randomUUID(), createdAt: new Date().toISOString(),
        expiresAt: new Date(Math.min(Date.now() + 600_000, experimentExpiry)).toISOString() });
      records.set(input.slot, record);
      return { ...info, outcome: 'created', record };
    },
  };
}
