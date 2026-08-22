-- Phase 15: notification dispatcher metadata and auditable automation runs.

alter table public.notifications
  add column if not exists category text,
  add column if not exists opportunity_id uuid references public.opportunities (id) on delete set null,
  add column if not exists action_url text,
  add column if not exists event_name text,
  add column if not exists channel text not null default 'in_app',
  add column if not exists email_status text,
  add column if not exists idempotency_key text;

create unique index if not exists notifications_user_idempotency_uidx
  on public.notifications (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email')),
  status text not null check (status in ('sent', 'logged', 'skipped', 'failed')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists notification_deliveries_user_id_idx on public.notification_deliveries (user_id, created_at desc);

alter table public.notification_deliveries enable row level security;

do $$ begin
  create policy notification_deliveries_select_own on public.notification_deliveries for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy notification_deliveries_insert_own on public.notification_deliveries for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  application_id uuid references public.applications (id) on delete cascade,
  kind text not null,
  action text not null,
  safe boolean not null default true,
  reason text not null,
  correlation_id uuid not null default gen_random_uuid(),
  event_name text,
  created_at timestamptz not null default now()
);

create index if not exists automation_runs_user_id_idx on public.automation_runs (user_id, created_at desc);

alter table public.automation_runs enable row level security;

do $$ begin
  create policy automation_runs_select_own on public.automation_runs for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy automation_runs_insert_own on public.automation_runs for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

grant select, insert, update on public.notifications to authenticated;
grant select, insert on public.notification_deliveries to authenticated;
grant select, insert on public.automation_runs to authenticated;
grant all on public.notification_deliveries to service_role;
grant all on public.automation_runs to service_role;
