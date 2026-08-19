-- Phase 16: security hardening
-- Consent immutability, owner-readable encrypted tokens, server-callable audit inserts.

create or replace function public.protect_profile_gates()
returns trigger
language plpgsql
as $$
begin
  if old.terms_accepted_at is not null and new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'consent timestamps are immutable';
  end if;
  if old.ai_processing_accepted_at is not null and new.ai_processing_accepted_at is distinct from old.ai_processing_accepted_at then
    raise exception 'consent timestamps are immutable';
  end if;
  if old.onboarding_completed_at is not null and new.onboarding_completed_at is distinct from old.onboarding_completed_at then
    raise exception 'onboarding completion is immutable';
  end if;
  if new.onboarding_completed_at is not null and (new.terms_accepted_at is null or new.ai_processing_accepted_at is null) then
    raise exception 'onboarding requires consent';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_gates on public.profiles;
create trigger profiles_protect_gates
  before update on public.profiles
  for each row execute function public.protect_profile_gates();

-- Owner select is required for server user-JWT reads. Tokens must be ciphertext at rest.
drop policy if exists integration_tokens_select_own on public.integration_tokens;
create policy integration_tokens_select_own
  on public.integration_tokens for select
  using (auth.uid() = user_id);

create or replace function public.record_audit_event(p_event_name text, p_metadata jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  cleaned jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_event_name is null or length(trim(p_event_name)) = 0 or length(p_event_name) > 120 then
    raise exception 'invalid audit event';
  end if;

  cleaned := coalesce(p_metadata, '{}'::jsonb)
    - 'password'
    - 'token'
    - 'access_token'
    - 'refresh_token'
    - 'authorization'
    - 'cookie'
    - 'api_key'
    - 'secret'
    - 'pageText'
    - 'prompt'
    - 'answer';

  insert into public.audit_events (user_id, event_name, metadata)
  values (auth.uid(), trim(p_event_name), cleaned)
  returning id into rid;

  return rid;
end;
$$;

revoke all on function public.record_audit_event(text, jsonb) from public;
grant execute on function public.record_audit_event(text, jsonb) to authenticated;
