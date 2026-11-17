import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { trackerApi, LogExercise, CorrectEntry, DeleteEntry } from '../packages/mcp/src/tracker';
import { exerciseTotals } from '../apps/web/lib/dashboard-data';

const owner = '00000000-0000-4000-8000-000000000001';
const env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic000000000000',
};

test('exercise inputs are strict, bounded and cannot carry an owner ID', () => {
  assert.equal(LogExercise.parse({ date: '2026-11-17', activity: 'Push' }).activity, 'Push');
  assert.equal(LogExercise.parse({ date: '2026-11-17', activity: ' Legs ', durationMinutes: 60, caloriesBurned: 350, notes: 'Squats 5x5' }).activity, 'Legs');
  for (const invalid of [
    { date: '2026-11-17', activity: '' },
    { date: '2026-11-17', activity: 'x'.repeat(101) },
    { date: '2026-11-17', activity: 'Run', durationMinutes: 0 },
    { date: '2026-11-17', activity: 'Run', durationMinutes: 1441 },
    { date: '2026-11-17', activity: 'Run', caloriesBurned: -1 },
    { date: '2026-11-17', activity: 'Run', caloriesBurned: 12.5 },
    { date: '2026-11-17', activity: 'Run', notes: 'x'.repeat(501) },
    { date: '2026-02-30', activity: 'Run' },
    { date: '2026-11-17', activity: 'Run', owner_id: owner },
  ]) assert.equal(LogExercise.safeParse(invalid).success, false, JSON.stringify(invalid));
});

test('exercise corrections must only use exercise fields; deletes accept the exercise kind', () => {
  const id = randomUUID();
  assert.equal(CorrectEntry.safeParse({ kind: 'exercise', id, expectedRevision: 1, durationMinutes: 45 }).success, true);
  assert.equal(CorrectEntry.safeParse({ kind: 'exercise', id, expectedRevision: 1, caloriesBurned: null, notes: null }).success, true);
  assert.equal(CorrectEntry.safeParse({ kind: 'exercise', id, expectedRevision: 1 }).success, false);
  assert.equal(CorrectEntry.safeParse({ kind: 'exercise', id, expectedRevision: 1, calories: 100 }).success, false);
  assert.equal(CorrectEntry.safeParse({ kind: 'food', id, expectedRevision: 1, activity: 'Pull' }).success, false);
  assert.equal(CorrectEntry.safeParse({ kind: 'weight', id, expectedRevision: 1, weightKg: 94, durationMinutes: 5 }).success, false);
  assert.equal(DeleteEntry.safeParse({ kind: 'exercise', id, expectedRevision: 1 }).success, true);
});

test('exercise CRUD uses the owner bearer and RLS-scoped filters; view_day excludes burned calories from remaining', async () => {
  const token = 'synthetic.owner.token';
  const calls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${token}`);
    assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (method !== 'POST') assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
    calls.push({ method, url, body });
    if (url.pathname.endsWith('daily_targets')) return Response.json([{ owner_id: owner, effective_from: '2026-11-17', calorie_target: 1900, protein_target_g: 160 }]);
    if (url.pathname.endsWith('food_entries')) return Response.json([{ calories: 996, protein_g: 41.2 }]);
    if (url.pathname.endsWith('exercise_entries') && method === 'GET') return Response.json([{ id: 'e', activity: 'Push', calories_burned: 400 }]);
    if (method === 'POST') return Response.json([{ id: 'e', revision: 1 }]);
    if (method === 'PATCH') return Response.json([{ id: 'e', revision: 2 }]);
    if (method === 'DELETE') return Response.json([{ id: 'e' }]);
    return Response.json([]);
  };
  const api = trackerApi(env, token, owner, fetcher);
  await api.logExercise({ date: '2026-11-17', activity: 'Push', durationMinutes: 60 });
  const post = calls[0]!;
  assert.ok(post.url.pathname.endsWith('/rest/v1/exercise_entries'));
  assert.deepEqual(post.body, { owner_id: owner, entry_date: '2026-11-17', activity: 'Push', duration_minutes: 60, calories_burned: null, notes: null });

  const day = await api.viewDay('2026-11-17');
  assert.equal(day.exercises.length, 1);
  assert.deepEqual(day.remaining, { calories: 904, proteinG: 118.8 });

  const id = randomUUID();
  await api.correct({ kind: 'exercise', id, expectedRevision: 1, durationMinutes: 45, notes: null });
  const patch = calls.find(call => call.method === 'PATCH')!;
  assert.ok(patch.url.pathname.endsWith('exercise_entries'));
  assert.equal(patch.url.searchParams.get('revision'), 'eq.1');
  assert.equal(patch.body?.duration_minutes, 45);
  assert.equal(patch.body?.notes, null);
  assert.equal(patch.body?.revision, 2);

  await api.remove({ kind: 'exercise', id, expectedRevision: 2 });
  const del = calls.find(call => call.method === 'DELETE')!;
  assert.ok(del.url.pathname.endsWith('exercise_entries'));
  assert.equal(del.url.searchParams.get('id'), `eq.${id}`);
});

test('exercise totals ignore missing values instead of inventing them', () => {
  assert.deepEqual(exerciseTotals([]), { minutes: 0, caloriesBurned: 0 });
  assert.deepEqual(exerciseTotals([
    { duration_minutes: 60, calories_burned: 350 },
    { duration_minutes: null, calories_burned: null },
    { duration_minutes: 20, calories_burned: null },
  ]), { minutes: 80, caloriesBurned: 350 });
});

test('exercise migration is owner-scoped with RLS, full CRUD policies and no anon grants', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202611170003_exercise_entries.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table public\.exercise_entries enable row level security/);
  assert.match(sql, /alter table public\.exercise_entries force row level security/);
  assert.match(sql, /revoke all on public\.exercise_entries from anon/);
  for (const action of ['select', 'insert', 'update', 'delete']) assert.ok(sql.includes(`create policy exercise_owner_${action}`));
  assert.ok(sql.includes('with check (owner_id = (select auth.uid()))'));
  assert.doesNotMatch(sql, /service_role|security definer/i);
});
