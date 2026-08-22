-- Application Memory: source-traced facts, extraction status, unresolved conflicts.
-- RLS remains deny-by-default and owner-scoped.

alter type public.experience_kind add value if not exists 'research';

alter table public.evidence_items
  add column if not exists extraction_status text not null default 'manual',
  add column if not exists source_document_id uuid references public.documents (id) on delete set null,
  add column if not exists source_version_id uuid references public.document_versions (id) on delete set null,
  add column if not exists source_location text,
  add column if not exists fact_key text,
  add column if not exists conflict_group_id uuid,
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.evidence_items
  drop constraint if exists evidence_items_extraction_status_check;

alter table public.evidence_items
  add constraint evidence_items_extraction_status_check
  check (extraction_status in ('manual', 'extracted', 'user_edited'));

alter table public.profile_facts
  add column if not exists category text not null default 'personal',
  add column if not exists fact_key text,
  add column if not exists extraction_status text not null default 'manual',
  add column if not exists source_document_id uuid references public.documents (id) on delete set null,
  add column if not exists source_version_id uuid references public.document_versions (id) on delete set null,
  add column if not exists source_location text,
  add column if not exists conflict_group_id uuid,
  add column if not exists excerpt text;

alter table public.profile_facts
  drop constraint if exists profile_facts_extraction_status_check;

alter table public.profile_facts
  add constraint profile_facts_extraction_status_check
  check (extraction_status in ('manual', 'extracted', 'user_edited'));

alter table public.profile_facts
  drop constraint if exists profile_facts_category_check;

alter table public.profile_facts
  add constraint profile_facts_category_check
  check (category in (
    'personal',
    'education',
    'skills',
    'projects',
    'experience',
    'achievements',
    'certifications',
    'leadership',
    'research',
    'links',
    'supporting'
  ));

create table if not exists public.memory_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  fact_key text not null,
  category text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  chosen_fact_id uuid,
  fact_ids uuid[] not null default '{}',
  values text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists memory_conflicts_open_idx
  on public.memory_conflicts (user_id, fact_key)
  where status = 'open';

create index if not exists memory_conflicts_user_id_idx on public.memory_conflicts (user_id);
create index if not exists evidence_items_fact_key_idx on public.evidence_items (user_id, fact_key);
create index if not exists profile_facts_fact_key_idx on public.profile_facts (user_id, fact_key);

alter table public.memory_conflicts enable row level security;

create policy memory_conflicts_select_own on public.memory_conflicts for select using (user_id = auth.uid());
create policy memory_conflicts_insert_own on public.memory_conflicts for insert with check (user_id = auth.uid());
create policy memory_conflicts_update_own on public.memory_conflicts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy memory_conflicts_delete_own on public.memory_conflicts for delete using (user_id = auth.uid());

grant select, insert, update, delete on public.memory_conflicts to authenticated;
grant all on public.memory_conflicts to service_role;
