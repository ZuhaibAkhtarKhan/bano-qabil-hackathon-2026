-- Allow users to queue their own host prefill/submit jobs from the web app.

create policy host_submit_jobs_insert_own on public.host_submit_jobs
  for insert with check (user_id = auth.uid());
