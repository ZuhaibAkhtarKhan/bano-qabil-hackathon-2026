alter type public.application_status add value if not exists 'saved';
alter type public.application_status add value if not exists 'analyzing';
alter type public.application_status add value if not exists 'ready_to_apply';
alter type public.application_status add value if not exists 'in_progress';
alter type public.application_status add value if not exists 'review_required';
alter type public.application_status add value if not exists 'under_review';
alter type public.application_status add value if not exists 'accepted';

alter table public.submission_snapshots
  add column if not exists opportunity_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists evidence_manifest jsonb not null default '[]'::jsonb,
  add column if not exists field_manifest jsonb not null default '[]'::jsonb,
  add column if not exists application_status text,
  add column if not exists deadline_at timestamptz;
