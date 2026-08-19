create policy profiles_delete_own on public.profiles
  for delete using (id = auth.uid());
