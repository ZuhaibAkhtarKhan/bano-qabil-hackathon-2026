-- Broaden realtime so Need You, memory, documents, and opportunities update live.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter table public.documents replica identity full;
alter table public.field_mappings replica identity full;
alter table public.profile_facts replica identity full;
alter table public.eligibility_results replica identity full;
alter table public.opportunities replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.documents;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.field_mappings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profile_facts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.eligibility_results;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.opportunities;
  exception when duplicate_object then null;
  end;
end $$;
