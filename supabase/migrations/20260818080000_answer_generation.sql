-- Phase 9: Grounded answer generation
-- Extends application_answers with versioned history, claim validation, and states.

-- Answer state enum
do $$ begin
  create type public.answer_state as enum (
    'ai_generated', 'user_edited', 'approved', 'rejected', 'needs_review'
  );
exception when duplicate_object then null; end $$;

-- Enhance application_answers
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
  add column if not exists generation_count integer not null default 0;

-- answer_versions: immutable history of every generated/edited text
create table if not exists public.answer_versions (
  id             uuid primary key default gen_random_uuid(),
  answer_id      uuid not null references public.application_answers(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  question_id    uuid not null,
  version_number integer not null default 1,
  text           text not null,
  state          public.answer_state not null,
  evidence_ids   uuid[] not null default '{}',
  claim_flags    jsonb not null default '[]'::jsonb,
  missing_facts  text[] not null default '{}',
  warnings       text[] not null default '{}',
  grounding_score numeric(4,3) not null default 0,
  model          text,
  prompt_version text,
  created_at     timestamptz not null default now()
);

create index if not exists answer_versions_answer_id_idx on public.answer_versions(answer_id);
create index if not exists answer_versions_application_id_idx on public.answer_versions(application_id);
create index if not exists answer_versions_user_id_idx on public.answer_versions(user_id);

-- RLS
alter table public.answer_versions enable row level security;

create policy "Users manage own answer versions"
  on public.answer_versions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Index on evidence_ids for lookup
create index if not exists application_answers_state_idx
  on public.application_answers(state);
