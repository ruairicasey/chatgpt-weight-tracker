import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { melbourneToday, selectedDate, foodTotals, readDashboard } from '../apps/web/lib/dashboard-data';

test('default day uses Melbourne local date across UTC and daylight-saving boundaries', () => {
  assert.equal(melbourneToday(new Date('2026-11-16T13:30:00Z')), '2026-11-17');
  assert.equal(melbourneToday(new Date('2026-06-30T14:30:00Z')), '2026-07-01');
  assert.equal(selectedDate(undefined, new Date('2026-11-16T13:30:00Z')), '2026-11-17');
  assert.equal(selectedDate('2026-11-17'), '2026-11-17');
  for (const invalid of [null, ['2026-11-17'], '2026-02-30', '2026-13-01', '2026-11-17/anything', '<script>']) {
    assert.throws(() => selectedDate(invalid), /INVALID_DATE/);
  }
});

test('food totals reflect every entry; optional body fat is never substituted with zero', () => {
  assert.deepEqual(foodTotals([]), { calories: 0, proteinG: 0 });
  assert.deepEqual(foodTotals([
    { calories: 288, protein_g: 25.2 }, { calories: 190, protein_g: 6.5 },
    { calories: 220, protein_g: 0 },
  ]), { calories: 698, proteinG: 31.7 });
});

function fakeClient(options: { failTable?: string; historyCount?: number } = {}) {
  const calls: Array<{ table: string; eq?: [string, string]; range?: [number, number]; limit?: number }> = [];
  const allHistory = Array.from({ length: options.historyCount ?? 2 }, (_, i) => ({
    id: `weight-${i}`, entry_date: `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + i % 28).padStart(2, '0')}`,
    weight_kg: 80 - i * 0.01, body_fat_percent: i === 0 ? null : 28,
  }));
  const foods = [
    { id: 'food-a', entry_date: '2026-11-17', name: 'Eggs', calories: 300, protein_g: 24 },
    { id: 'food-b', entry_date: '2026-11-17', name: 'Toast', calories: 200, protein_g: 6 },
  ];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      const q = {
        select() { return q; },
        eq(column: string, value: string) { call.eq = [column, value]; return q; },
        order() { return q; },
        limit(n: number) { call.limit = n; return Promise.resolve({
          data: options.failTable === table ? null : [allHistory[0]], error: options.failTable === table ? new Error('no') : null,
        }); },
        range(from: number, to: number) { call.range = [from, to]; const rows = table === 'food_entries' ? foods : allHistory;
          return Promise.resolve({ data: options.failTable === table ? null : rows.slice(from, to + 1), error: options.failTable === table ? new Error('no') : null }); },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

test('dashboard reads one owner-session day, food totals and all paginated weight history', async () => {
  const { client, calls } = fakeClient({ historyCount: 502 });
  const result = await readDashboard(client, '2026-11-17');
  assert.equal(result.dayWeight?.weight_kg, 80);
  assert.equal(result.foods.length, 2);
  assert.deepEqual(result.totals, { calories: 500, proteinG: 30 });
  assert.equal(result.weights.length, 502);
  assert.deepEqual(calls.map(call => call.table), ['weight_entries', 'food_entries', 'weight_entries', 'weight_entries']);
  assert.deepEqual(calls[1]?.eq, ['entry_date', '2026-11-17']);
  assert.deepEqual(calls[2]?.range, [0, 499]);
  assert.deepEqual(calls[3]?.range, [500, 999]);
});

test('database failures are not silently rendered as empty data', async () => {
  const { client } = fakeClient({ failTable: 'weight_entries' });
  await assert.rejects(readDashboard(client, '2026-11-17'), /WEIGHT_READ_FAILED/);
});
