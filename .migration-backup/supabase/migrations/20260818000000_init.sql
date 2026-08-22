-- 1-Apply foundation schema
-- Deny-by-default RLS. Every user-owned row is scoped by user_id (profiles.id).
-- Vector queries MUST filter by user_id before similarity ranking.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create type public.verification_status as enum ('unverified', 'verified', 'rejected');
create type public.document_type as enum (
  'resume',
  'cover_letter',
  'transcript',
  'certificate',
  'portfolio',
  'other'
);
create type public.document_version_status as enum (
  'uploading',
  'ready',
  'processing',
  'failed',
  'archived'
);
create type public.opportunity_category as enum (
  'job',
  'internship',
  'scholarship',
  'hackathon',
  'grant',
  'fellowship',
  'university',
  'accelerator',
  'conference',
  'ambassador',
  'visa',
  'other'
);
create type public.opportunity_source as enum ('url', 'manual', 'extension', 'discovery');
create type public.opportunity_analysis_status as enum ('pending', 'ready', 'failed', 'needs_input');
create type public.application_status as enum (
  'draft',
  'preparing',
  'ready',
  'submitted',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
  'archived'
);
create type public.eligibility_state as enum ('met', 'not_met', 'unclear', 'not_evaluated');
create type public.job_state as enum ('queued', 'running', 'succeeded', 'failed');
create type public.job_type as enum (
  'document_extract',
  'document_embed',
  'opportunity_analyze',
  'eligibility_evaluate',
  'answer_draft',
  'account_export'
);
create type public.experience_kind as enum (
  'education',
  'employment',
  'project',
  'leadership',
  'volunteering',
  'achievement',
  'certification'
);
create type public.reminder_channel as enum ('in_app', 'email');
create type public.reminder_status as enum ('scheduled', 'sent', 'cancelled');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  headline text,
  phone text,
  location_city text,
  location_country text,
  timezone text,
  linkedin_url text,
  github_url text,
  portfolio_url text,
  work_authorization text,
  availability text,
  preferences jsonb not null default '{}'::jsonb,
  terms_accepted_at timestamptz,
  ai_processing_accepted_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  fact_type text not null,
  value jsonb not null,
  source text,
  confidence numeric(4, 3),
  verification_status public.verification_status not null default 'unverified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.experience_kind not null,
  organization text,
  title text not null,
  location text,
  start_date date,
  end_date date,
  summary text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  experience_id uuid references public.experiences (id) on delete set null,
  title text not null,
  kind text not null,
  organization text,
  situation text,
  action text,
  outcome text,
  metrics text,
  skills text[] not null default '{}',
  source text,
  confidence numeric(4, 3),
  verification_status public.verification_status not null default 'unverified',
  excluded_from_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.document_type not null,
  label text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  version_label text not null,
  storage_path text not null,
  file_hash text not null,
  mime_type text not null,
  byte_size integer not null check (byte_size >= 0),
  status public.document_version_status not null default 'uploading',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, file_hash)
);

alter table public.documents
  add constraint documents_current_version_fk
  foreign key (current_version_id) references public.document_versions (id) on delete set null;

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  document_version_id uuid not null references public.document_versions (id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  source_page integer,
  source_section text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source public.opportunity_source not null,
  source_url text,
  canonical_url text,
  title text not null,
  organization text,
  category public.opportunity_category not null default 'other',
  location text,
  deadline_at timestamptz,
  raw_excerpt text,
  analysis_status public.opportunity_analysis_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  text text not null,
  hard boolean not null default false,
  confidence numeric(4, 3) not null default 0,
  source_span text,
  created_at timestamptz not null default now()
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  status public.application_status not null default 'draft',
  deadline_at timestamptz,
  next_action text,
  persona text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);

create table public.application_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  prompt text not null,
  limit_value integer,
  limit_unit text,
  sort_order integer not null default 0,
  source text,
  created_at timestamptz not null default now()
);

create table public.answer_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_id uuid not null references public.application_questions (id) on delete cascade,
  text text not null,
  evidence_ids uuid[] not null default '{}',
  missing_facts text[] not null default '{}',
  warnings text[] not null default '{}',
  approved boolean not null default false,
  model text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create unique index answer_versions_one_approved
  on public.answer_versions (question_id)
  where approved;

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete restrict,
  document_version_id uuid not null references public.document_versions (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (application_id, document_id)
);

create table public.eligibility_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  requirement_id uuid not null references public.requirements (id) on delete cascade,
  state public.eligibility_state not null,
  explanation text not null,
  profile_fact_id uuid references public.profile_facts (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.submission_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  submitted_at timestamptz not null default now(),
  answer_manifest jsonb not null,
  document_manifest jsonb not null,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  name text,
  role text,
  email text,
  created_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  fire_at timestamptz not null,
  channel public.reminder_channel not null default 'in_app',
  status public.reminder_status not null default 'scheduled',
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.job_type not null,
  state public.job_state not null default 'queued',
  attempts integer not null default 0,
  input_ref text not null,
  error_code text,
  correlation_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  event_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index profile_facts_user_id_idx on public.profile_facts (user_id);
create index experiences_user_id_idx on public.experiences (user_id);
create index evidence_items_user_id_idx on public.evidence_items (user_id);
create index documents_user_id_idx on public.documents (user_id);
create index document_versions_user_id_idx on public.document_versions (user_id);
create index document_chunks_user_id_idx on public.document_chunks (user_id);
create index opportunities_user_id_idx on public.opportunities (user_id);
create index opportunities_user_canonical_url_idx on public.opportunities (user_id, canonical_url);
create index requirements_user_id_idx on public.requirements (user_id);
create index applications_user_id_idx on public.applications (user_id);
create index applications_deadline_idx on public.applications (user_id, deadline_at);
create index application_questions_user_id_idx on public.application_questions (user_id);
create index answer_versions_user_id_idx on public.answer_versions (user_id);
create index eligibility_results_user_id_idx on public.eligibility_results (user_id);
create index jobs_user_id_idx on public.jobs (user_id, state);
create index audit_events_user_id_idx on public.audit_events (user_id);

create index document_chunks_embedding_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger profile_facts_set_updated_at before update on public.profile_facts
  for each row execute function public.set_updated_at();
create trigger experiences_set_updated_at before update on public.experiences
  for each row execute function public.set_updated_at();
create trigger evidence_items_set_updated_at before update on public.evidence_items
  for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger opportunities_set_updated_at before update on public.opportunities
  for each row execute function public.set_updated_at();
create trigger applications_set_updated_at before update on public.applications
  for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  insert into public.audit_events (user_id, event_name, metadata)
  values (new.id, 'profile_created', jsonb_build_object('source', 'auth.users'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.profile_facts enable row level security;
alter table public.experiences enable row level security;
alter table public.evidence_items enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.opportunities enable row level security;
alter table public.requirements enable row level security;
alter table public.applications enable row level security;
alter table public.application_questions enable row level security;
alter table public.answer_versions enable row level security;
alter table public.application_documents enable row level security;
alter table public.eligibility_results enable row level security;
alter table public.submission_snapshots enable row level security;
alter table public.contacts enable row level security;
alter table public.reminders enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_events enable row level security;

-- Owner-scoped CRUD. Jobs and audit events are readable by the owner and written by trusted server roles.
create policy profiles_select_own on public.profiles for select using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create policy profile_facts_select_own on public.profile_facts for select using (user_id = auth.uid());
create policy profile_facts_insert_own on public.profile_facts for insert with check (user_id = auth.uid());
create policy profile_facts_update_own on public.profile_facts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy profile_facts_delete_own on public.profile_facts for delete using (user_id = auth.uid());

create policy experiences_select_own on public.experiences for select using (user_id = auth.uid());
create policy experiences_insert_own on public.experiences for insert with check (user_id = auth.uid());
create policy experiences_update_own on public.experiences for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy experiences_delete_own on public.experiences for delete using (user_id = auth.uid());

create policy evidence_items_select_own on public.evidence_items for select using (user_id = auth.uid());
create policy evidence_items_insert_own on public.evidence_items for insert with check (user_id = auth.uid());
create policy evidence_items_update_own on public.evidence_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy evidence_items_delete_own on public.evidence_items for delete using (user_id = auth.uid());

create policy documents_select_own on public.documents for select using (user_id = auth.uid());
create policy documents_insert_own on public.documents for insert with check (user_id = auth.uid());
create policy documents_update_own on public.documents for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy documents_delete_own on public.documents for delete using (user_id = auth.uid());

create policy document_versions_select_own on public.document_versions for select using (user_id = auth.uid());
create policy document_versions_insert_own on public.document_versions for insert with check (user_id = auth.uid());
create policy document_versions_update_own on public.document_versions for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy document_chunks_select_own on public.document_chunks for select using (user_id = auth.uid());
create policy document_chunks_insert_own on public.document_chunks for insert with check (user_id = auth.uid());
create policy document_chunks_delete_own on public.document_chunks for delete using (user_id = auth.uid());

create policy opportunities_select_own on public.opportunities for select using (user_id = auth.uid());
create policy opportunities_insert_own on public.opportunities for insert with check (user_id = auth.uid());
create policy opportunities_update_own on public.opportunities for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy opportunities_delete_own on public.opportunities for delete using (user_id = auth.uid());

create policy requirements_select_own on public.requirements for select using (user_id = auth.uid());
create policy requirements_insert_own on public.requirements for insert with check (user_id = auth.uid());
create policy requirements_update_own on public.requirements for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy requirements_delete_own on public.requirements for delete using (user_id = auth.uid());

create policy applications_select_own on public.applications for select using (user_id = auth.uid());
create policy applications_insert_own on public.applications for insert with check (user_id = auth.uid());
create policy applications_update_own on public.applications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy applications_delete_own on public.applications for delete using (user_id = auth.uid());

create policy application_questions_select_own on public.application_questions for select using (user_id = auth.uid());
create policy application_questions_insert_own on public.application_questions for insert with check (user_id = auth.uid());
create policy application_questions_update_own on public.application_questions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy application_questions_delete_own on public.application_questions for delete using (user_id = auth.uid());

create policy answer_versions_select_own on public.answer_versions for select using (user_id = auth.uid());
create policy answer_versions_insert_own on public.answer_versions for insert with check (user_id = auth.uid());
create policy answer_versions_update_own on public.answer_versions for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy application_documents_select_own on public.application_documents for select using (user_id = auth.uid());
create policy application_documents_insert_own on public.application_documents for insert with check (user_id = auth.uid());
create policy application_documents_delete_own on public.application_documents for delete using (user_id = auth.uid());

create policy eligibility_results_select_own on public.eligibility_results for select using (user_id = auth.uid());
create policy eligibility_results_insert_own on public.eligibility_results for insert with check (user_id = auth.uid());
create policy eligibility_results_delete_own on public.eligibility_results for delete using (user_id = auth.uid());

create policy submission_snapshots_select_own on public.submission_snapshots for select using (user_id = auth.uid());
create policy submission_snapshots_insert_own on public.submission_snapshots for insert with check (user_id = auth.uid());

create policy contacts_select_own on public.contacts for select using (user_id = auth.uid());
create policy contacts_insert_own on public.contacts for insert with check (user_id = auth.uid());
create policy contacts_update_own on public.contacts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy contacts_delete_own on public.contacts for delete using (user_id = auth.uid());

create policy reminders_select_own on public.reminders for select using (user_id = auth.uid());
create policy reminders_insert_own on public.reminders for insert with check (user_id = auth.uid());
create policy reminders_update_own on public.reminders for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy jobs_select_own on public.jobs for select using (user_id = auth.uid());
create policy audit_events_select_own on public.audit_events for select using (user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false)
on conflict (id) do nothing;

create policy document_objects_select_own
  on storage.objects for select
  using (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy document_objects_insert_own
  on storage.objects for insert
  with check (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy document_objects_update_own
  on storage.objects for update
  using (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy document_objects_delete_own
  on storage.objects for delete
  using (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
