-- Phase 14: persist ranked discovery results that feed the existing opportunity pipeline.

alter type public.job_type add value if not exists 'opportunity_discover';

create table if not exists public.discovery_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid not null references public.discovery_requests (id) on delete cascade,
  provider text not null,
  source_url text not null,
  canonical_url text not null,
  title text not null,
  organization text,
  category text not null default 'other',
  location text,
  remote boolean not null default false,
  excerpt text not null default '',
  deadline_at timestamptz,
  quality integer not null default 0,
  rank_score integer not null default 0,
  relevance integer not null default 0,
  eligibility_preview integer,
  fit_preview integer,
  reasons jsonb not null default '[]'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  already_saved boolean not null default false,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (request_id, canonical_url)
);

create index if not exists discovery_results_request_id_idx on public.discovery_results (request_id, rank_score desc);
create index if not exists discovery_results_user_id_idx on public.discovery_results (user_id);

alter table public.discovery_results enable row level security;

do $$ begin
  create policy discovery_results_select_own on public.discovery_results for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy discovery_results_insert_own on public.discovery_results for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy discovery_results_update_own on public.discovery_results for update using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy discovery_results_delete_own on public.discovery_results for delete using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on public.discovery_results to authenticated;
grant all on public.discovery_results to service_role;
