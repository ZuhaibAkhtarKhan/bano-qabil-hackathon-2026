-- Phase: Email and Calendar Integration
-- Extends email_events, calendar_events tables; adds integration_tokens for secure token storage.

-- integration_tokens: server-side token storage (never sent to browser)
create table if not exists public.integration_tokens (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id)
);

alter table public.integration_tokens enable row level security;

-- Only allow server (service role) to read/write tokens — no RLS select for anon/authenticated
create policy "integration_tokens_insert_own"
  on public.integration_tokens for insert
  with check (auth.uid() = user_id);

create policy "integration_tokens_update_own"
  on public.integration_tokens for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "integration_tokens_delete_own"
  on public.integration_tokens for delete
  using (auth.uid() = user_id);

create trigger integration_tokens_set_updated_at before update on public.integration_tokens
  for each row execute function public.set_updated_at();

-- Extend email_events with classification and association fields
alter table public.email_events
  add column if not exists subject text,
  add column if not exists from_address text,
  add column if not exists snippet text,
  add column if not exists sender_domain text,
  add column if not exists association_confidence numeric(5,4),
  add column if not exists association_signals jsonb,
  add column if not exists interview_detected boolean default false,
  add column if not exists interview_date_hints jsonb default '[]'::jsonb,
  add column if not exists calendar_event_id uuid references public.calendar_events (id) on delete set null,
  add column if not exists user_corrected boolean default false;

-- Update email_events check — add update and delete policies (architecture migration only has select/insert)
create policy if not exists "email_events_update_own"
  on public.email_events for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Extend calendar_events with confirmation, meeting URL, timezone, email link
alter table public.calendar_events
  add column if not exists location text,
  add column if not exists meeting_url text,
  add column if not exists timezone text,
  add column if not exists confirmed boolean default false,
  add column if not exists email_event_id uuid references public.email_events (id) on delete set null,
  add column if not exists notes text;

create index if not exists integration_tokens_user_id_idx on public.integration_tokens (user_id);
create index if not exists email_events_application_id_idx on public.email_events (application_id);
create index if not exists calendar_events_application_id_idx on public.calendar_events (application_id);
create index if not exists calendar_events_confirmed_idx on public.calendar_events (user_id, confirmed);
