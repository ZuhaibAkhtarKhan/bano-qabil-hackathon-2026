-- Table privileges for the signed-in role. RLS still scopes every row to auth.uid().
-- Without these grants, PostgREST returns 42501 on profile updates (consent/onboarding).

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;

alter table public.profiles
  add column if not exists onboarding_step text not null default 'consent';

alter table public.profiles
  drop constraint if exists profiles_onboarding_step_check;

alter table public.profiles
  add constraint profiles_onboarding_step_check
  check (onboarding_step in ('consent', 'profile', 'documents', 'review', 'ready', 'done'));

update public.profiles
  set onboarding_step = 'done'
  where onboarding_completed_at is not null
    and onboarding_step is distinct from 'done';
