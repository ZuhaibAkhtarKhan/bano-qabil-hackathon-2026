-- Phase 7: opportunity intelligence metadata and discovery architecture.

alter table public.opportunities
  add column if not exists analyzed_at timestamptz,
  add column if not exists metadata jsonb not null default '{}';

alter table public.requirements
  add column if not exists kind text not null default 'general';

create table if not exists public.discovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  filters jsonb not null default '{}',
  result_summary text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists discovery_requests_user_id_idx on public.discovery_requests (user_id, created_at desc);

alter table public.discovery_requests enable row level security;

create policy discovery_requests_select_own on public.discovery_requests for select using (user_id = auth.uid());
create policy discovery_requests_insert_own on public.discovery_requests for insert with check (user_id = auth.uid());
create policy discovery_requests_update_own on public.discovery_requests for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.discovery_requests to authenticated;
grant all on public.discovery_requests to service_role;
