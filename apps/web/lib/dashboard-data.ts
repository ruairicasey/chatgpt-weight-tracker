import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MELBOURNE_ZONE = 'Australia/Melbourne';

export function melbourneToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: MELBOURNE_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (part: string) => parts.find(item => item.type === part)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function selectedDate(value: unknown, now: Date = new Date()): string {
  if (value === undefined) return melbourneToday(now);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('INVALID_DATE');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('INVALID_DATE');
  return value;
}

export type WeightRow = { id: string; entry_date: string; weight_kg: number; body_fat_percent: number | null };
export type FoodRow = { id: string; entry_date: string; name: string; calories: number; protein_g: number };

export function foodTotals(foods: ReadonlyArray<Pick<FoodRow, 'calories' | 'protein_g'>>) {
  return foods.reduce((totals, food) => ({
    calories: totals.calories + Number(food.calories),
    proteinG: totals.proteinG + Number(food.protein_g),
  }), { calories: 0, proteinG: 0 });
}

// PostgREST defaults to a maximum page size. Fetch every weight from the first entry,
// not merely the most recent 1000; all requests use the owner's cookie session and RLS.
export async function readDashboard(client: SupabaseClient, date: string) {
  const dayWeight = await client.from('weight_entries')
    .select('id,entry_date,weight_kg,body_fat_percent')
    .eq('entry_date', date).limit(1);
  if (dayWeight.error) throw new Error('WEIGHT_READ_FAILED');

  const foods: FoodRow[] = [];
  const weights: WeightRow[] = [];
  const pageSize = 500;
  for (let offset = 0;; offset += pageSize) {
    const page = await client.from('food_entries')
      .select('id,entry_date,name,calories,protein_g')
      .eq('entry_date', date).order('created_at', { ascending: true })
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (page.error) throw new Error('FOOD_READ_FAILED');
    const rows = (page.data ?? []) as FoodRow[];
    foods.push(...rows);
    if (rows.length < pageSize) break;
  }
  for (let offset = 0;; offset += pageSize) {
    const page = await client.from('weight_entries')
      .select('id,entry_date,weight_kg,body_fat_percent')
      .order('entry_date', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (page.error) throw new Error('HISTORY_READ_FAILED');
    const rows = (page.data ?? []) as WeightRow[];
    weights.push(...rows);
    if (rows.length < pageSize) break;
  }
  return {
    dayWeight: ((dayWeight.data ?? [])[0] ?? null) as WeightRow | null,
    foods,
    weights,
    totals: foodTotals(foods),
  };
}
