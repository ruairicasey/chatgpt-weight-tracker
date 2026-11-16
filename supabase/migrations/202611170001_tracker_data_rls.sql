-- Phase 2: owner-scoped tracker storage. Apply only after review.
-- No privileged runtime key. MCP must forward the caller's OAuth access token.
create table if not exists public.weight_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  entry_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg > 0 and weight_kg < 1000),
  body_fat_percent numeric(5,2) check (body_fat_percent between 0 and 100),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, entry_date)
);
create table if not exists public.food_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  entry_date date not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  calories integer not null check (calories between 0 and 100000),
  protein_g numeric(8,2) not null check (protein_g between 0 and 10000),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists food_entries_owner_date_idx on public.food_entries(owner_id, entry_date desc);
alter table public.weight_entries enable row level security;
alter table public.food_entries enable row level security;
alter table public.weight_entries force row level security;
alter table public.food_entries force row level security;
revoke all on public.weight_entries, public.food_entries from anon;
grant select, insert, update, delete on public.weight_entries, public.food_entries to authenticated;
create policy weight_owner_select on public.weight_entries for select to authenticated using (owner_id = (select auth.uid()));
create policy weight_owner_insert on public.weight_entries for insert to authenticated with check (owner_id = (select auth.uid()));
create policy weight_owner_update on public.weight_entries for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy weight_owner_delete on public.weight_entries for delete to authenticated using (owner_id = (select auth.uid()));
create policy food_owner_select on public.food_entries for select to authenticated using (owner_id = (select auth.uid()));
create policy food_owner_insert on public.food_entries for insert to authenticated with check (owner_id = (select auth.uid()));
create policy food_owner_update on public.food_entries for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy food_owner_delete on public.food_entries for delete to authenticated using (owner_id = (select auth.uid()));
-- No write policy or grant for receipts until atomic RPC is implemented and reviewed.
