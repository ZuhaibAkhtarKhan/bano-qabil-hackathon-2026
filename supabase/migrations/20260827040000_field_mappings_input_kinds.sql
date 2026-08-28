-- Persist scraped form field type + choices so Needs You can render select / file / image controls.
alter table public.field_mappings
  add column if not exists field_type text,
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists meta jsonb not null default '{}'::jsonb;

comment on column public.field_mappings.field_type is
  'Detected form control type: text, textarea, select, radio, checkbox, date, number, url, file, multi-select.';
comment on column public.field_mappings.options is
  'Choice labels for select/radio/checkbox fields (JSON string array).';
comment on column public.field_mappings.meta is
  'Extra field metadata (accept, uploadKind=document|image, etc.).';
