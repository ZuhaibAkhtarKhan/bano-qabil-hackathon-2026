-- Production architecture: relational memory, retrieval, tracking, integrations.
-- Additive on top of foundation + phase 3. Deny-by-default RLS. Vectors always user-scoped.

alter type public.job_type add value if not exists 'email_sync';
alter type public.job_type add value if not exists 'calendar_sync';
alter type public.job_type add value if not exists 'deadline_monitor';
alter type public.job_type add value if not exists 'embedding_index';
alter type public.job_state add value if not exists 'processing';
alter type public.job_state add value if not exists 'completed';

alter table public.jobs
  add column if not exists max_attempts integer not null default 3 check (max_attempts >= 1),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists last_error_at timestamptz;

create unique index if not exists jobs_user_idempotency_idx
  on public.jobs (user_id, idempotency_key)
  where idempotency_key is not null;

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  source text,
  created_at timestamptz not null default now(),
  unique (user_id, normalized_name)
);

create table public.evidence_skills (
  user_id uuid not null references public.profiles (id) on delete cascade,
  evidence_id uuid not null references public.evidence_items (id) on delete cascade,
  skill_id uuid not null references public.skills (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (evidence_id, skill_id)
);

create table public.evidence_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  evidence_id uuid not null references public.evidence_items (id) on delete cascade,
  source_kind text not null check (source_kind in ('document_version', 'manual', 'import', 'url')),
  source_ref text,
  excerpt text,
  created_at timestamptz not null default now()
);

create table public.profile_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('linkedin', 'github', 'portfolio', 'other')),
  url text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, url)
);

create table public.resumes (
  document_id uuid primary key references public.documents (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target_role text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.opportunity_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  label text not null,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.opportunity_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  prompt text not null,
  limit_value integer,
  limit_unit text,
  sort_order integer not null default 0,
  source text,
  created_at timestamptz not null default now()
);

create table public.answer_evidence (
  user_id uuid not null references public.profiles (id) on delete cascade,
  answer_version_id uuid not null references public.answer_versions (id) on delete cascade,
  evidence_id uuid not null references public.evidence_items (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (answer_version_id, evidence_id)
);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  from_status public.application_status,
  to_status public.application_status not null,
  created_at timestamptz not null default now()
);

create table public.fill_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  origin text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.field_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  fill_session_id uuid references public.fill_sessions (id) on delete cascade,
  field_key text not null,
  label text not null,
  value text not null default '',
  source text not null,
  confidence numeric(4, 3) not null default 0,
  excluded_by_default boolean not null default false,
  sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  kind text not null check (kind in ('gmail', 'google_calendar', 'oauth')),
  status text not null check (status in ('disconnected', 'connected', 'error', 'revoked')),
  scopes text[] not null default '{}',
  account_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, kind)
);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  occurred_at timestamptz not null,
  external_id text,
  event_kind text not null,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  integration_id uuid references public.integrations (id) on delete set null,
  application_id uuid references public.applications (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  title text not null,
  external_id text,
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  purpose text not null,
  model text,
  prompt_version text,
  input_evidence_ids uuid[] not null default '{}',
  latency_ms integer,
  token_in integer,
  token_out integer,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed')),
  error_code text,
  created_at timestamptz not null default now()
);

create table public.embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_table text not null check (source_table in ('evidence_items', 'document_chunks', 'experiences')),
  source_id uuid not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (user_id, source_table, source_id)
);

create index skills_user_id_idx on public.skills (user_id);
create index evidence_sources_user_id_idx on public.evidence_sources (user_id);
create index profile_links_user_id_idx on public.profile_links (user_id);
create index resumes_user_id_idx on public.resumes (user_id);
create index opportunity_documents_user_id_idx on public.opportunity_documents (user_id);
create index opportunity_questions_user_id_idx on public.opportunity_questions (user_id);
create index answer_evidence_user_id_idx on public.answer_evidence (user_id);
create index application_events_user_id_idx on public.application_events (user_id, created_at desc);
create index application_status_history_user_id_idx on public.application_status_history (user_id, application_id);
create index fill_sessions_user_id_idx on public.fill_sessions (user_id);
create index field_mappings_user_id_idx on public.field_mappings (user_id);
create index integrations_user_id_idx on public.integrations (user_id);
create index email_events_user_id_idx on public.email_events (user_id, occurred_at desc);
create index calendar_events_user_id_idx on public.calendar_events (user_id, starts_at);
create index ai_runs_user_id_idx on public.ai_runs (user_id, created_at desc);
create index embeddings_user_id_idx on public.embeddings (user_id);
create index embeddings_embedding_idx on public.embeddings using hnsw (embedding vector_cosine_ops);

create trigger resumes_set_updated_at before update on public.resumes
  for each row execute function public.set_updated_at();
create trigger integrations_set_updated_at before update on public.integrations
  for each row execute function public.set_updated_at();

create or replace function public.record_application_status_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.application_status_history (user_id, application_id, from_status, to_status)
    values (
      new.user_id,
      new.id,
      case when tg_op = 'INSERT' then null else old.status end,
      new.status
    );
  end if;
  return new;
end;
$$;

drop trigger if exists applications_status_history on public.applications;
create trigger applications_status_history
  after insert or update of status on public.applications
  for each row execute function public.record_application_status_change();

create or replace function public.match_user_embeddings(
  query_embedding vector(1536),
  match_count integer default 8,
  filter_source text default null
)
returns table (
  id uuid,
  source_table text,
  source_id uuid,
  content text,
  similarity double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    e.id,
    e.source_table,
    e.source_id,
    e.content,
    (1 - (e.embedding <=> query_embedding))::double precision as similarity
  from public.embeddings e
  where e.user_id = auth.uid()
    and e.embedding is not null
    and (filter_source is null or e.source_table = filter_source)
  order by e.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 8), 50));
$$;

do $$
declare
  t text;
  tables text[] := array[
    'skills',
    'evidence_skills',
    'evidence_sources',
    'profile_links',
    'resumes',
    'opportunity_documents',
    'opportunity_questions',
    'answer_evidence',
    'application_events',
    'application_status_history',
    'fill_sessions',
    'field_mappings',
    'integrations',
    'email_events',
    'calendar_events',
    'ai_runs',
    'embeddings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_select_own on public.%I for select using (user_id = auth.uid())',
      t, t
    );
    execute format(
      'create policy %I_insert_own on public.%I for insert with check (user_id = auth.uid())',
      t, t
    );
    if t not in ('application_status_history', 'application_events', 'ai_runs', 'email_events') then
      execute format(
        'create policy %I_update_own on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())',
        t, t
      );
      execute format(
        'create policy %I_delete_own on public.%I for delete using (user_id = auth.uid())',
        t, t
      );
    end if;
  end loop;
end $$;
