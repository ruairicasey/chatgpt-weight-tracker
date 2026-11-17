# Phase 1: dated daily targets and weight trend

This change adds only targets/trend, preserving the existing owner-only tracker and free hosting.

## Apply in order
1. In **Supabase SQL Editor**, run the entire migration
   `supabase/migrations/202611170002_daily_targets.sql` once. It creates
   `public.daily_targets` with authenticated-owner RLS, no anonymous privileges, and
   seeds **1900 kcal / 160 g protein from 2026-11-17** for the owner registered in
   `private.mcp_oauth_settings`. Do not apply the migration twice.
2. Verify the initial row in Table Editor or with:
   `select effective_from, calorie_target, protein_target_g from public.daily_targets order by effective_from;`
   (The SQL Editor runs with administrator rights; normal app reads are RLS-scoped.)
3. Deploy the merged `main` commit on Vercel Hobby. **No new environment variables**.
   Keep `MCP_PRODUCTION_ENABLED=true` on Production and all existing OAuth variables;
   keep Preview without the production flag.
4. In ChatGPT, refresh/reconnect the Weight Tracker plugin if its tools have not updated
   to show `view_targets` and `set_targets`. Check an earlier date, then 2026-11-17,
   and a future date. Call `view_day` to confirm consumed/remaining.
5. Sign in to `https://chatgpt-weight-tracker.vercel.app/dashboard`. Confirm target
   cards and the trend line/table. Real entries remain unchanged.
6. If the table or target tools error, verify the migration and Supabase schema API
   visibility. Do not install a service-role key or weaken RLS.

## Semantics
- Targets are effective *on and after* `effective_from`; later entries supersede
  earlier ones. An explicit same-day update replaces that day's record.
- Both targets can be set, or just one; an omitted field carries the applicable
  previous value. With no previous row, both fields are required.
- A missing target returns null, never silently invents a calorie allowance.
  Remaining = target minus consumed and may be negative (over target).
- Daily food totals include all pages of food records, not only the first hundred.
- Chart uses recorded daily weigh-ins and a trailing **seven calendar days** average
  of available readings, plotted on weigh-in dates (missing days aren't imputed).
- Weekly change uses the earliest and latest weigh-ins within the past 14 Melbourne
  calendar days (including today), divided by elapsed days and multiplied by 7;
  percent uses the earliest weight. Fewer than two distinct dates show no estimate.
- No exercise adjustment to food targets. No exercise data, Claude integration,
  idempotency machinery or multi-user implementation in this phase.
