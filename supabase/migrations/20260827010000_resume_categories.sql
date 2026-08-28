-- Categorized resumes: one document per (user, category); versions are time-ordered uploads.
alter table public.resumes
  add column if not exists category_key text,
  add column if not exists category_label text;

update public.resumes
set
  category_key = coalesce(nullif(trim(category_key), ''), 'legacy-' || left(document_id::text, 8)),
  category_label = coalesce(nullif(trim(category_label), ''), coalesce(nullif(trim(target_role), ''), 'Uncategorized'))
where category_key is null or category_label is null;

create unique index if not exists resumes_user_category_key_uidx
  on public.resumes (user_id, category_key);

create index if not exists resumes_user_category_key_idx
  on public.resumes (user_id, category_key);
