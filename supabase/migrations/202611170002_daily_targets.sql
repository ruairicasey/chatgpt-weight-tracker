-- Phase 1: historical owner-only daily targets.
-- A new effective date supersedes prior targets without rewriting prior history.
create table public.daily_targets (
  owner_id uuid not null default auth.uid() references auth.users(id),
  effective_from date not null,
  calorie_target integer not null check (calorie_target between 1 and 10000),
  protein_target_g numeric(7,2) not null check (protein_target_g between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, effective_from)
);
create index daily_targets_owner_effective_idx on public.daily_targets (owner_id, effective_from desc);
alter table public.daily_targets enable row level security;
alter table public.daily_targets force row level security;
revoke all on public.daily_targets from anon;
grant select, insert, update on public.daily_targets to authenticated;
create policy daily_targets_owner_select on public.daily_targets
  for select to authenticated using (owner_id = (select auth.uid()));
create policy daily_targets_owner_insert on public.daily_targets
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy daily_targets_owner_update on public.daily_targets
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Seed the already registered owner's requested targets from their starting date.
-- Fail closed rather than seeding arbitrary accounts.
insert into public.daily_targets (owner_id, effective_from, calorie_target, protein_target_g)
select owner_id, date '2026-11-17', 1900, 160
from private.mcp_oauth_settings
on conflict (owner_id, effective_from) do nothing;
