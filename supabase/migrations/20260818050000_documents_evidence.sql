-- Phase 6: document versioning metadata, expanded types, embeddings corpus, grants.

alter type public.document_type add value if not exists 'resume_variant';
alter type public.document_type add value if not exists 'supporting_document';

alter table public.document_versions
  add column if not exists original_filename text,
  add column if not exists source text not null default 'upload';

alter table public.embeddings
  drop constraint if exists embeddings_source_table_check;

alter table public.embeddings
  add constraint embeddings_source_table_check
  check (source_table in (
    'evidence_items',
    'document_chunks',
    'experiences',
    'profile_facts',
    'answer_versions',
    'skills'
  ));

grant select, insert, update, delete on public.embeddings to authenticated;
grant all on public.embeddings to service_role;

grant execute on function public.match_user_embeddings(vector, integer, text) to authenticated;
grant execute on function public.match_user_embeddings(vector, integer, text) to service_role;
