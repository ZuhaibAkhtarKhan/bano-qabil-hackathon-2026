-- Applicant can confirm eligibility for requirements the system cannot auto-decide.

alter table public.eligibility_results
  add column if not exists user_confirmed_at timestamptz,
  add column if not exists auto_confirmed boolean not null default false,
  add column if not exists ack_only boolean not null default false;

create policy eligibility_results_update_own on public.eligibility_results
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on column public.eligibility_results.user_confirmed_at is 'When the applicant confirmed they meet this requirement.';
comment on column public.eligibility_results.auto_confirmed is 'True when confirmation was applied by deadline automation.';
comment on column public.eligibility_results.ack_only is 'True when Need You has no editable field — applicant must acknowledge eligibility.';
