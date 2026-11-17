import 'server-only';
import { z } from 'zod';

const day = z.iso.date();
const uuid = z.uuid();
export const LogWeight = z.strictObject({ date: day, weightKg: z.number().positive().max(999.99), bodyFatPercent: z.number().min(0).max(100).optional() });
export const LogFood = z.strictObject({ date: day, name: z.string().trim().min(1).max(200), calories: z.number().int().min(0).max(100000), proteinG: z.number().min(0).max(10000) });
export const ViewDay = z.strictObject({ date: day });
export const ViewTargets = z.strictObject({ date: day });
export const SetTargets = z.strictObject({
  effectiveFrom: day,
  calories: z.number().int().min(1).max(10000).optional(),
  proteinG: z.number().min(0).max(1000).optional(),
}).refine(v => v.calories !== undefined || v.proteinG !== undefined, 'At least one target must be supplied');
type TargetRow = { owner_id: string; effective_from: string; calorie_target: number; protein_target_g: number };
export function remainingForDay(foods: Array<Record<string,unknown>>, target: TargetRow | null) {
  const consumed = {
    calories: foods.reduce((n, row) => n + Number(row.calories), 0),
    proteinG: foods.reduce((n, row) => n + Number(row.protein_g), 0),
  };
  return { consumed,
    remaining: target ? {
      calories: Number(target.calorie_target) - consumed.calories,
      proteinG: Number((Number(target.protein_target_g) - consumed.proteinG).toFixed(2)),
    } : null };
}
export const CorrectEntry = z.strictObject({ kind: z.enum(['weight', 'food']), id: uuid, expectedRevision: z.number().int().positive(), weightKg: z.number().positive().max(999.99).optional(), bodyFatPercent: z.number().min(0).max(100).nullable().optional(), name: z.string().trim().min(1).max(200).optional(), calories: z.number().int().min(0).max(100000).optional(), proteinG: z.number().min(0).max(10000).optional() }).superRefine((v,ctx) => {
  const weight = v.weightKg !== undefined || v.bodyFatPercent !== undefined;
  const food = v.name !== undefined || v.calories !== undefined || v.proteinG !== undefined;
  if ((v.kind === 'weight' && (!weight || food)) || (v.kind === 'food' && (!food || weight))) ctx.addIssue({ code:'custom', message:'Fields must match kind and include a correction' });
});
export const DeleteEntry = z.strictObject({ kind: z.enum(['weight','food']), id: uuid, expectedRevision: z.number().int().positive() });

/** REST calls carry the verified caller's JWT. RLS is the authorization boundary. */
export function trackerApi(env: Readonly<Record<string,string|undefined>>, token: string, owner: string, fetcher: typeof fetch = fetch) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(base) ||
      !key || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) throw new Error('DATA_API_NOT_CONFIGURED');
  async function request(table: 'weight_entries'|'food_entries'|'daily_targets', method: string, query: string, payload?: object, preference = 'return=representation') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher(`${base}/rest/v1/${table}?${query}`, {
        method, signal: controller.signal, cache:'no-store',
        headers: { apikey: key!, Authorization: `Bearer ${token}`, 'Content-Type':'application/json',
          Prefer: preference, 'Cache-Control':'no-store' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'DATA_API_AUTH_DENIED' : 'DATA_API_REQUEST_FAILED');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('DATA_API_INVALID_RESPONSE');
      return data as Record<string,unknown>[];
    } finally { clearTimeout(timer); }
  }
  const ownerFilter = `owner_id=eq.${encodeURIComponent(owner)}`;
  async function targetFor(date: string): Promise<TargetRow | null> {
    const rows = await request('daily_targets','GET',
      `${ownerFilter}&effective_from=lte.${date}&select=owner_id,effective_from,calorie_target,protein_target_g&order=effective_from.desc&limit=1`);
    return (rows[0] ?? null) as TargetRow | null;
  }
  const table = (kind: 'weight'|'food') => kind === 'weight' ? 'weight_entries' : 'food_entries';
  return {
    async logWeight(input: z.infer<typeof LogWeight>) {
      return request('weight_entries','POST','select=id,entry_date,weight_kg,body_fat_percent,revision', {
        owner_id: owner, entry_date: input.date, weight_kg: input.weightKg, body_fat_percent: input.bodyFatPercent ?? null,
      });
    },
    async logFood(input: z.infer<typeof LogFood>) {
      return request('food_entries','POST','select=id,entry_date,name,calories,protein_g,revision', {
        owner_id: owner, entry_date: input.date, name: input.name, calories: input.calories, protein_g: input.proteinG,
      });
    },
    async viewDay(date: string) {
      const [weights, target] = await Promise.all([
        request('weight_entries','GET',`${ownerFilter}&entry_date=eq.${date}&select=*&limit=1`),
        targetFor(date),
      ]);
      const foods: Record<string,unknown>[] = [];
      for (let offset = 0;; offset += 500) {
        const batch = await request('food_entries', 'GET',
          `${ownerFilter}&entry_date=eq.${date}&select=*&order=created_at.asc,id.asc&offset=${offset}&limit=500`);
        foods.push(...batch);
        if (batch.length < 500) break;
      }
      return { date, weights, foods, targets: target, ...remainingForDay(foods, target) };
    },
    async viewTargets(date: string) {
      return { date, targets: await targetFor(date) };
    },
    async setTargets(input: z.infer<typeof SetTargets>) {
      const previous = await targetFor(input.effectiveFrom);
      if (!previous && (input.calories === undefined || input.proteinG === undefined)) throw new Error('TARGETS_NOT_FOUND');
      const values = {
        owner_id: owner, effective_from: input.effectiveFrom,
        calorie_target: input.calories ?? Number(previous!.calorie_target),
        protein_target_g: input.proteinG ?? Number(previous!.protein_target_g),
        updated_at: new Date().toISOString(),
      };
      const rows = await request('daily_targets', 'POST',
        'on_conflict=owner_id,effective_from&select=owner_id,effective_from,calorie_target,protein_target_g',
        values, 'resolution=merge-duplicates,return=representation');
      if (rows.length !== 1) throw new Error('TARGET_WRITE_FAILED');
      return rows[0];
    },
    async correct(input: z.infer<typeof CorrectEntry>) {
      const patch: Record<string,unknown> = { revision: input.expectedRevision + 1, updated_at: new Date().toISOString() };
      if (input.kind === 'weight') {
        if (input.weightKg !== undefined) patch.weight_kg = input.weightKg;
        if (input.bodyFatPercent !== undefined) patch.body_fat_percent = input.bodyFatPercent;
      } else {
        if (input.name !== undefined) patch.name = input.name;
        if (input.calories !== undefined) patch.calories = input.calories;
        if (input.proteinG !== undefined) patch.protein_g = input.proteinG;
      }
      const rows = await request(table(input.kind),'PATCH',`${ownerFilter}&id=eq.${input.id}&revision=eq.${input.expectedRevision}&select=*`,patch);
      if (!rows.length) throw new Error('ENTRY_NOT_FOUND_OR_STALE');
      return rows;
    },
    async remove(input: z.infer<typeof DeleteEntry>) {
      const rows = await request(table(input.kind),'DELETE',`${ownerFilter}&id=eq.${input.id}&revision=eq.${input.expectedRevision}&select=id`);
      if (!rows.length) throw new Error('ENTRY_NOT_FOUND_OR_STALE');
      return { deleted: true, id: input.id };
    },
  };
}
