-- Enable Supabase Realtime publication on critical workflow tables
-- Ensures client subscriptions receive row-level INSERT/UPDATE/DELETE events in real time.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Set replica identity to full so old/new rows are available in update/delete payloads
alter table public.notifications replica identity full;
alter table public.applications replica identity full;
alter table public.jobs replica identity full;
alter table public.application_answers replica identity full;
alter table public.email_events replica identity full;
alter table public.calendar_events replica identity full;
alter table public.review_items replica identity full;

-- Add tables to the supabase_realtime publication
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.applications;
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.application_answers;
alter publication supabase_realtime add table public.email_events;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.review_items;
