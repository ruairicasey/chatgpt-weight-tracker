-- Phase 2: owner-only exercise log.
-- Exercise calories are informational only; they never change the daily calorie target.
create table if not exists public.exercise_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  entry_date date not null,
  activity text not null check (length(btrim(activity)) between 1 and 100),
  duration_minutes integer check (duration_minutes between 1 and 1440),
  calories_burned integer check (calories_burned between 0 and 10000),
  notes text check (notes is null or length(notes) <= 500),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists exercise_entries_owner_date_idx on public.exercise_entries (owner_id, entry_date desc);
alter table public.exercise_entries enable row level security;
alter table public.exercise_entries force row level security;
revoke all on public.exercise_entries from anon;
grant select, insert, update, delete on public.exercise_entries to authenticated;
create policy exercise_owner_select on public.exercise_entries
  for select to authenticated using (owner_id = (select auth.uid()));
create policy exercise_owner_insert on public.exercise_entries
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy exercise_owner_update on public.exercise_entries
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy exercise_owner_delete on public.exercise_entries
  for delete to authenticated using (owner_id = (select auth.uid()));
