-- Host form auto-submit jobs (extension or worker fills + clicks Submit before deadline).

create table if not exists public.host_submit_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  source_url text not null,
  due_at timestamptz not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  host_submit_clicked boolean not null default false,
  completed_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint host_submit_jobs_status_check check (
    status in ('pending', 'running', 'submitted', 'failed', 'blocked', 'cancelled')
  )
);

create unique index if not exists host_submit_jobs_idempotency_key_idx
  on public.host_submit_jobs (idempotency_key);

create index if not exists host_submit_jobs_pending_idx
  on public.host_submit_jobs (user_id, status, due_at)
  where status in ('pending', 'running');

alter table public.host_submit_jobs enable row level security;

create policy host_submit_jobs_select_own on public.host_submit_jobs
  for select using (user_id = auth.uid());

create policy host_submit_jobs_update_own on public.host_submit_jobs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger host_submit_jobs_set_updated_at
  before update on public.host_submit_jobs
  for each row execute function public.set_updated_at();
