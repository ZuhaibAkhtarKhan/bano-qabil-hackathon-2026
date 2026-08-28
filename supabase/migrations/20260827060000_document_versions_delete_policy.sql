-- Allow owners to delete individual document versions (history prune).
create policy document_versions_delete_own on public.document_versions
  for delete using (user_id = auth.uid());
