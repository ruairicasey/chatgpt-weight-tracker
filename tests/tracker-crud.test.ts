import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { trackerApi, LogWeight, LogFood, ViewDay, CorrectEntry, DeleteEntry } from '../packages/mcp/src/tracker';

const owner = '00000000-0000-4000-8000-000000000001';
const env = {
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic000000000000',
};

test('strict tracker inputs validate dates, numbers, revisions and forbid owner spoofing', () => {
  assert.equal(LogWeight.parse({ date: '2026-11-17', weightKg: 75.2 }).weightKg, 75.2);
  assert.equal(LogFood.parse({ date: '2026-11-17', name: 'Oats', calories: 300, proteinG: 12 }).proteinG, 12);
  assert.equal(ViewDay.parse({ date: '2026-11-17' }).date, '2026-11-17');
  for (const input of [
    { date: '2026-02-30', weightKg: 75 },
    { date: '2026-11-17', weightKg: -1 },
    { date: '2026-11-17', weightKg: 75, owner_id: owner },
  ]) assert.equal(LogWeight.safeParse(input).success, false);
  assert.equal(LogFood.safeParse({ date: '2026-11-17', name: '', calories: 20, proteinG: 1 }).success, false);
  assert.equal(CorrectEntry.safeParse({ kind: 'weight', id: randomUUID(), expectedRevision: 1, calories: 12 }).success, false);
  assert.equal(DeleteEntry.safeParse({ kind: 'food', id: randomUUID(), expectedRevision: 0 }).success, false);
});

test('CRUD uses the verified owner and caller bearer, never service-role credentials', async () => {
  const calls: Array<{ method: string; url: URL; body: Record<string, unknown> | null }> = [];
  const token = 'synthetic.valid.owner-token';
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${token}`);
    assert.equal(headers.get('apikey'), env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(init?.cache, 'no-store');
    assert.equal(headers.get('Cache-Control'), 'no-store');
    assert.equal(url.origin, env.SUPABASE_URL);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (body) assert.equal(body.owner_id === undefined || body.owner_id === owner, true);
    if (method !== 'POST') assert.equal(url.searchParams.get('owner_id'), `eq.${owner}`);
    calls.push({ method, url, body });
    if (method === 'DELETE') return Response.json([{ id: 'synthetic-id' }]);
    if (method === 'PATCH') return Response.json([{ id: 'synthetic-id', revision: 2 }]);
    if (method === 'POST') return Response.json([{ id: 'synthetic-id', revision: 1 }]);
    return Response.json([]);
  };
  const api = trackerApi(env, token, owner, fetcher);
  await api.logWeight({ date: '2026-11-17', weightKg: 75.2 });
  await api.logFood({ date: '2026-11-17', name: 'Oats', calories: 300, proteinG: 12 });
  const daily = await api.viewDay('2026-11-17');
  assert.deepEqual(daily, { date: '2026-11-17', weights: [], foods: [] });
  await api.correct({ kind: 'food', id: randomUUID(), expectedRevision: 1, calories: 310 });
  await api.remove({ kind: 'weight', id: randomUUID(), expectedRevision: 2 });
  assert.deepEqual(calls.map(call => call.method), ['POST', 'POST', 'GET', 'GET', 'PATCH', 'DELETE']);
  assert.equal(calls[4]?.url.searchParams.get('revision'), 'eq.1');
  assert.equal(calls[4]?.body?.revision, 2);
  assert.equal(calls[5]?.url.searchParams.get('revision'), 'eq.2');
});

test('API denies missing configuration and unauthorized PostgREST responses', async () => {
  assert.throws(() => trackerApi({}, 'synthetic-token', owner), /DATA_API_NOT_CONFIGURED/);
  const api = trackerApi(env, 'synthetic-token', owner, async () => new Response('unauthorized', { status: 401 }));
  await assert.rejects(api.viewDay('2026-11-17'), /DATA_API_AUTH_DENIED/);
});

test('migration grants CRUD only under owner-scoped RLS and no anon table grants', () => {
  const sql = readFileSync(new URL('../supabase/migrations/202611170001_tracker_data_rls.sql', import.meta.url), 'utf8');
  for (const table of ['weight_entries','food_entries']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    for (const action of ['select','insert','update','delete']) {
      assert.ok(sql.includes(`create policy ${table === 'weight_entries' ? 'weight' : 'food'}_owner_${action}`));
    }
  }
  assert.match(sql, /with check \\(owner_id = \\(select auth\\.uid\\(\\)\\)\\)/);
  assert.match(sql, /revoke all on public\\.weight_entries, public\\.food_entries from anon/);
});
