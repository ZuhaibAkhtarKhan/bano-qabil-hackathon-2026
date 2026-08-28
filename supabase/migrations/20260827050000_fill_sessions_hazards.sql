-- Persist page walls (captcha, account creation, unsupported) from extension fill inventory.
alter table public.fill_sessions
  add column if not exists hazards jsonb not null default '{}'::jsonb;
