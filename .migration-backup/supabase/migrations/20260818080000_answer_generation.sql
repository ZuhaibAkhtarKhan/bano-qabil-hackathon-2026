-- Phase 9: Grounded answer generation
-- Current answers live on application_answers. answer_versions already exists
-- from init (per-question drafts) and is extended here as immutable history.

do $$ begin
  create type public.answer_state as enum (
    'ai_generated', 'user_edited', 'approved', 'rejected', 'needs_review'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.application_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  question_id uuid not null,
  state public.answer_state not null default 'ai_generated',
  original_ai_text text,
  user_edited_text text,
  approved_text text,
  evidence_ids uuid[] not null default '{}',
  claim_flags jsonb not null default '[]'::jsonb,
  missing_facts text[] not null default '{}',
  warnings text[] not null default '{}',
  grounding_score numeric(4,3) not null default 0,
  model text,
  prompt_version text,
  generation_count integer not null default 0,
  version_number integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, question_id)
);

alter table public.application_answers
  add column if not exists state public.answer_state not null default 'ai_generated',
  add column if not exists original_ai_text text,
  add column if not exists user_edited_text text,
  add column if not exists approved_text text,
  add column if not exists evidence_ids uuid[] not null default '{}',
  add column if not exists claim_flags jsonb not null default '[]'::jsonb,
  add column if not exists missing_facts text[] not null default '{}',
  add column if not exists warnings text[] not null default '{}',
  add column if not exists grounding_score numeric(4,3) not null default 0,
  add column if not exists model text,
  add column if not exists prompt_version text,
  add column if not exists generation_count integer not null default 0,
  add column if not exists version_number integer not null default 1,
  add column if not exists updated_at timestamptz not null default now();

alter table public.opportunity_questions
  add column if not exists required boolean not null default true;

-- Extend the existing answer_versions table (created in init) with history columns.
alter table public.answer_versions
  add column if not exists answer_id uuid references public.application_answers (id) on delete cascade,
  add column if not exists application_id uuid references public.applications (id) on delete cascade,
  add column if not exists version_number integer not null default 1,
  add column if not exists state public.answer_state,
  add column if not exists claim_flags jsonb not null default '[]'::jsonb,
  add column if not exists grounding_score numeric(4,3) not null default 0;

create index if not exists application_answers_application_id_idx
  on public.application_answers (application_id);
create index if not exists application_answers_user_id_idx
  on public.application_answers (user_id);
create index if not exists application_answers_state_idx
  on public.application_answers (state);
create index if not exists answer_versions_answer_id_idx
  on public.answer_versions (answer_id);
create index if not exists answer_versions_application_id_idx
  on public.answer_versions (application_id);

alter table public.application_answers enable row level security;

do $$ begin
  create policy "Users manage own application answers"
    on public.application_answers
    for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Users manage own answer versions"
    on public.answer_versions
    for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
