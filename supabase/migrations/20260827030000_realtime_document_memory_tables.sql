-- Realtime for document extraction, memory evidence, and fit updates.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter table public.document_versions replica identity full;
alter table public.document_chunks replica identity full;
alter table public.evidence_items replica identity full;
alter table public.fit_evaluations replica identity full;
alter table public.application_documents replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.document_versions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.document_chunks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.evidence_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.fit_evaluations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.application_documents;
  exception when duplicate_object then null;
  end;
end $$;
