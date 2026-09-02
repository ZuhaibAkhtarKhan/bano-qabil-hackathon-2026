-- Track LLM memory verification pass for eligibility (avoids re-checking every page load).

alter table public.eligibility_results
  add column if not exists memory_checked_at timestamptz;

comment on column public.eligibility_results.memory_checked_at is 'When Application Memory was checked by LLM for this requirement.';
