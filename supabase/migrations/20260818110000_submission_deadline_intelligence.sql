-- Phase: Submission and Deadline Intelligence
-- Extends notifications, submission_snapshots, and applications for deadline-aware submission guards.

-- Add notification_state to notifications
alter table public.notifications
  add column if not exists notification_state text,
  add column if not exists urgency text,
  add column if not exists priority integer default 0,
  add column if not exists actionable boolean default true;

-- Extend submission_snapshots with opportunity snapshot, evidence manifest, field manifest, idempotency, guard result
alter table public.submission_snapshots
  add column if not exists opportunity_snapshot jsonb,
  add column if not exists evidence_manifest jsonb,
  add column if not exists field_manifest jsonb,
  add column if not exists idempotency_key text,
  add column if not exists guard_result jsonb;

-- Add deadline_timezone to applications and opportunities
alter table public.applications
  add column if not exists deadline_timezone text,
  add column if not exists auto_submit_policy jsonb,
  add column if not exists completeness_percent integer default 0,
  add column if not exists last_reminder_at timestamptz;

alter table public.opportunities
  add column if not exists deadline_timezone text;

-- Create submission_attempts table for duplicate protection and audit trail
create table if not exists public.submission_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  idempotency_key text not null,
  status text not null check (status in ('pending', 'completed', 'failed', 'duplicate')),
  guard_result jsonb not null default '{}'::jsonb,
  snapshot_id uuid references public.submission_snapshots (id),
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists submission_attempts_app_idx on public.submission_attempts (application_id);
create index if not exists submission_attempts_idempotency_idx on public.submission_attempts (idempotency_key);

-- RLS for submission_attempts
alter table public.submission_attempts enable row level security;

create policy "Users can view own submission attempts"
  on public.submission_attempts for select
  using (auth.uid() = user_id);

create policy "Users can insert own submission attempts"
  on public.submission_attempts for insert
  with check (auth.uid() = user_id);
