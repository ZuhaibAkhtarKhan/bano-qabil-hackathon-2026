-- Phase 8: eligibility, Fit Index, and resume-matching intelligence.

alter type public.eligibility_state add value if not exists 'partial';
alter type public.eligibility_state add value if not exists 'needs_confirmation';

alter table public.fit_evaluations
  add column if not exists strengths text[] not null default '{}',
  add column if not exists explanation text,
  add column if not exists should_apply text,
  add column if not exists factors jsonb not null default '{}'::jsonb;

alter table public.resume_matches
  add column if not exists track text,
  add column if not exists explanation text,
  add column if not exists recommended boolean not null default false;

alter table public.eligibility_results
  add column if not exists requirement_kind text,
  add column if not exists display_state text;
