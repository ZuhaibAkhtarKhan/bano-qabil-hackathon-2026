-- Phase 3: generate / review / track support tables.
-- Jobs may be enqueued and processed as the owning user so local setups
-- without a service-role worker still function.

alter type public.job_type add value if not exists 'resume_match';
alter type public.job_type add value if not exists 'notification_dispatch';

create table public.fit_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null unique references public.applications (id) on delete cascade,
  score integer not null check (score between 0 and 100),
  skills_match integer not null check (skills_match between 0 and 100),
  experience_match integer not null check (experience_match between 0 and 100),
  education_match integer not null check (education_match between 0 and 100),
  project_relevance integer not null check (project_relevance between 0 and 100),
  eligibility integer not null check (eligibility between 0 and 100),
  missing text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.resume_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  document_version_id uuid not null references public.document_versions (id) on delete cascade,
  score integer not null check (score between 0 and 100),
  suggestion text,
  created_at timestamptz not null default now(),
  unique (application_id, document_version_id)
);

create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  kind text not null,
  prompt text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.evidence_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  evidence_id uuid not null references public.evidence_items (id) on delete cascade,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index fit_evaluations_user_id_idx on public.fit_evaluations (user_id);
create index resume_matches_user_id_idx on public.resume_matches (user_id);
create index review_items_user_id_idx on public.review_items (user_id, resolved);
create index notifications_user_id_idx on public.notifications (user_id, created_at desc);
create index evidence_embeddings_user_id_idx on public.evidence_embeddings (user_id);

alter table public.fit_evaluations enable row level security;
alter table public.resume_matches enable row level security;
alter table public.review_items enable row level security;
alter table public.notifications enable row level security;
alter table public.evidence_embeddings enable row level security;

create policy fit_evaluations_select_own on public.fit_evaluations for select using (user_id = auth.uid());
create policy fit_evaluations_insert_own on public.fit_evaluations for insert with check (user_id = auth.uid());
create policy fit_evaluations_delete_own on public.fit_evaluations for delete using (user_id = auth.uid());

create policy resume_matches_select_own on public.resume_matches for select using (user_id = auth.uid());
create policy resume_matches_insert_own on public.resume_matches for insert with check (user_id = auth.uid());
create policy resume_matches_delete_own on public.resume_matches for delete using (user_id = auth.uid());

create policy review_items_select_own on public.review_items for select using (user_id = auth.uid());
create policy review_items_insert_own on public.review_items for insert with check (user_id = auth.uid());
create policy review_items_update_own on public.review_items for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy review_items_delete_own on public.review_items for delete using (user_id = auth.uid());

create policy notifications_select_own on public.notifications for select using (user_id = auth.uid());
create policy notifications_insert_own on public.notifications for insert with check (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy evidence_embeddings_select_own on public.evidence_embeddings for select using (user_id = auth.uid());
create policy evidence_embeddings_insert_own on public.evidence_embeddings for insert with check (user_id = auth.uid());
create policy evidence_embeddings_delete_own on public.evidence_embeddings for delete using (user_id = auth.uid());

create policy jobs_insert_own on public.jobs for insert with check (user_id = auth.uid());
create policy jobs_update_own on public.jobs for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.eligibility_results
  add column if not exists evidence_id uuid references public.evidence_items (id) on delete set null;

create policy fit_evaluations_update_own on public.fit_evaluations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy resume_matches_update_own on public.resume_matches
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
