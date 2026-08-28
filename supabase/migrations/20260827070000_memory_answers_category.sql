-- Allow Application Memory "answers" category for Need You Q&A saved to kit.
alter table public.profile_facts
  drop constraint if exists profile_facts_category_check;

alter table public.profile_facts
  add constraint profile_facts_category_check
  check (category in (
    'personal',
    'education',
    'skills',
    'projects',
    'experience',
    'achievements',
    'certifications',
    'leadership',
    'research',
    'links',
    'supporting',
    'answers'
  ));

-- Promote prior Need You essay saves out of Personal into Answers.
update public.profile_facts
set
  category = 'answers',
  fact_type = 'saved_answer'
where source = 'needs_you'
  and category = 'personal'
  and fact_type = 'supporting_detail';
