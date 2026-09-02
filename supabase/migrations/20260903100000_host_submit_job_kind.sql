-- Prefill vs final submit jobs on different schedules.

alter table public.host_submit_jobs
  add column if not exists job_kind text not null default 'submit';

alter table public.host_submit_jobs
  drop constraint if exists host_submit_jobs_status_check;

alter table public.host_submit_jobs
  add constraint host_submit_jobs_status_check check (
    status in ('pending', 'running', 'completed', 'submitted', 'failed', 'blocked', 'cancelled')
  );

alter table public.host_submit_jobs
  drop constraint if exists host_submit_jobs_kind_check;

alter table public.host_submit_jobs
  add constraint host_submit_jobs_kind_check check (job_kind in ('prefill', 'submit'));

create index if not exists host_submit_jobs_kind_pending_idx
  on public.host_submit_jobs (job_kind, status, due_at)
  where status in ('pending', 'running');
