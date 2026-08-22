-- Phase 8: eligibility, Fit Index, and resume matching stay three systems.
-- Add explainable factors. Never collapse them into one opaque AI score.

alter type public.eligibility_state add value if not exists 'partial';

alter table public.eligibility_results
  add column if not exists requirement_text text,
  add column if not exists requirement_kind text,
  add column if not exists needs_confirmation boolean not null default false;

alter table public.fit_evaluations
  add column if not exists rationale text,
  add column if not exists strengths text[] not null default '{}',
  add column if not exists factors jsonb not null default '[]'::jsonb,
  add column if not exists weights jsonb not null default '{"eligibility":0.3,"skillsMatch":0.2,"experienceMatch":0.2,"educationMatch":0.15,"projectRelevance":0.15}'::jsonb;

alter table public.resume_matches
  add column if not exists label text,
  add column if not exists focus text,
  add column if not exists explanation text,
  add column if not exists strengths text[] not null default '{}',
  add column if not exists gaps text[] not null default '{}',
  add column if not exists recommended boolean not null default false;

comment on table public.eligibility_results is 'Can I apply? Per-requirement SATISFIED / NOT SATISFIED / PARTIAL / UNKNOWN.';
comment on table public.fit_evaluations is 'Should I apply? Deterministic Fit Index from stored factors, not an LLM score.';
comment on table public.resume_matches is 'Which resume to use? Ranked variants with explanations. Never invents experience.';
