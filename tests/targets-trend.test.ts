import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { trackerApi, remainingForDay } from '../packages/mcp/src/tracker';
import { weightTrend, trendSvg } from '../apps/web/lib/weight-trend';

const owner='00000000-0000-4000-8000-000000000001';
const env={ SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic000000000000' };

test('daily targets migration has owner RLS and seeds initial values without changing prior records', () => {
  const sql=readFileSync(new URL('../supabase/migrations/202611170002_daily_targets.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table public\.daily_targets/);
  assert.match(sql, /alter table public\.daily_targets force row level security/);
  assert.match(sql, /revoke all on public\.daily_targets from anon/);
  for (const verb of ['select','insert','update']) assert.ok(sql.includes(`daily_targets_owner_${verb}`));
  assert.match(sql, /from private\.mcp_oauth_settings/);
  assert.match(sql, /2026-11-17', 1900, 160/);
});

test('remaining includes overshoots and zero consumption', () => {
  const target={ owner_id: owner, effective_from: '2026-11-17', calorie_target:1900, protein_target_g:160 };
  assert.deepEqual(remainingForDay([
    {calories:996,protein_g:41},{calories:0,protein_g:0}
  ],target), {consumed:{calories:996,proteinG:41},remaining:{calories:904,proteinG:119}});
  assert.deepEqual(remainingForDay([{calories:2000,protein_g:170}],target),
    {consumed:{calories:2000,proteinG:170},remaining:{calories:-100,proteinG:-10}});
});

test('owner bearer reads effective targets, preserves protein during partial set and returns totals on view_day',async()=>{
  const requests: Array<{url:URL;method:string;body:Record<string,unknown>|null;headers:Headers}>= [];
  const bearer='synthetic-bearer-token';
  const existing={owner_id:owner,effective_from:'2026-11-17',calorie_target:1900,protein_target_g:160};
  const fetcher:typeof fetch=async(input,init)=>{
    const url=new URL(String(input)),method=init?.method??'GET', headers=new Headers(init?.headers);
    assert.equal(headers.get('apikey'),env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(headers.get('Authorization'),`Bearer ${bearer}`);
    const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:null;
    requests.push({url,method,body,headers});
    if (url.pathname.endsWith('daily_targets') && method==='GET') return Response.json([existing]);
    if (url.pathname.endsWith('daily_targets') && method==='POST') {
      assert.equal(headers.get('Prefer'),'resolution=merge-duplicates,return=representation');
      assert.equal(url.searchParams.get('on_conflict'),'owner_id,effective_from');
      return Response.json([body]);
    }
    if (url.pathname.endsWith('food_entries')) return Response.json([{calories:996,protein_g:41}]);
    return Response.json([]);
  };
  const api=trackerApi(env,bearer,owner,fetcher);
  assert.deepEqual(await api.viewTargets('2026-11-20'), {date:'2026-11-20',targets:existing});
  const updated=await api.setTargets({effectiveFrom:'2026-11-24',calories:2000});
  assert.equal(updated.calorie_target,2000);
  assert.equal(updated.protein_target_g,160);
  const day=await api.viewDay('2026-11-20');
  assert.deepEqual(day.remaining,{calories:904,proteinG:119});
  assert.equal(day.targets?.effective_from,'2026-11-17');
  assert.ok(requests.filter(r=>r.url.pathname.endsWith('daily_targets')&&r.method==='GET')
    .every(r=>r.url.searchParams.get('owner_id')===`eq.${owner}` &&
      r.url.searchParams.get('effective_from')?.startsWith('lte.')));
});

test('seven-day rolling averages use calendar windows, and weekly rate uses actual elapsed days',()=>{
  assert.deepEqual(weightTrend([], '2026-11-30'),{points:[],weeklyChange:null});
  const single=weightTrend([{entry_date:'2026-11-17',weight_kg:94.35}], '2026-11-17');
  assert.equal(single.points[0]?.rolling7Kg,94.35);
  assert.equal(single.weeklyChange,null);
  assert.ok(trendSvg(single.points));
  const multiple=weightTrend([
    {entry_date:'2026-11-28',weight_kg:92},
    {entry_date:'2026-11-17',weight_kg:94},
    {entry_date:'2026-11-22',weight_kg:93},
    {entry_date:'2026-11-29',weight_kg:91},
  ],'2026-11-29');
  // A 7-day window excludes Nov 22 for the Nov 29 point.
  assert.equal(multiple.points[3]?.rolling7Kg,91.5);
  assert.equal(multiple.points[1]?.rolling7Kg,93.5);
  assert.ok(Math.abs(multiple.weeklyChange!.kg - (-3*7/12))<1e-10);
  assert.ok(multiple.weeklyChange!.percent<0);
  assert.ok(trendSvg(multiple.points)?.average.startsWith('M'));
});
