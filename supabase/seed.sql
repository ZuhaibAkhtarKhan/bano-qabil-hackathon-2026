-- Demo account for local `supabase db reset` and the hosted SQL editor.
-- Sign in: demo@1apply.dev / DemoApply2026!
-- Fictional kit + pipeline only. No real resumes, CNIC images, or private answers.

create extension if not exists pgcrypto;

do $$
declare
  demo_id uuid := 'a1a1a1a1-0000-4000-8000-000000000001';
  resume_id uuid := 'a1a1a1a1-0000-4000-8000-000000000010';
  resume_ver uuid := 'a1a1a1a1-0000-4000-8000-000000000011';
  cnic_id uuid := 'a1a1a1a1-0000-4000-8000-000000000012';
  cnic_ver uuid := 'a1a1a1a1-0000-4000-8000-000000000013';
  transcript_id uuid := 'a1a1a1a1-0000-4000-8000-000000000014';
  transcript_ver uuid := 'a1a1a1a1-0000-4000-8000-000000000015';
  ev_intern uuid := 'a1a1a1a1-0000-4000-8000-000000000020';
  ev_hack uuid := 'a1a1a1a1-0000-4000-8000-000000000021';
  ev_edu uuid := 'a1a1a1a1-0000-4000-8000-000000000022';
  opp_needs uuid := 'a1a1a1a1-0000-4000-8000-000000000030';
  opp_deadline uuid := 'a1a1a1a1-0000-4000-8000-000000000031';
  opp_host uuid := 'a1a1a1a1-0000-4000-8000-000000000032';
  opp_submitted uuid := 'a1a1a1a1-0000-4000-8000-000000000033';
  opp_interview uuid := 'a1a1a1a1-0000-4000-8000-000000000034';
  app_needs uuid := 'a1a1a1a1-0000-4000-8000-000000000040';
  app_deadline uuid := 'a1a1a1a1-0000-4000-8000-000000000041';
  app_host uuid := 'a1a1a1a1-0000-4000-8000-000000000042';
  app_submitted uuid := 'a1a1a1a1-0000-4000-8000-000000000043';
  app_interview uuid := 'a1a1a1a1-0000-4000-8000-000000000044';
  q_needs uuid := 'a1a1a1a1-0000-4000-8000-000000000050';
  q_deadline uuid := 'a1a1a1a1-0000-4000-8000-000000000051';
  q_host uuid := 'a1a1a1a1-0000-4000-8000-000000000052';
  q_submitted uuid := 'a1a1a1a1-0000-4000-8000-000000000053';
  req_needs uuid := 'a1a1a1a1-0000-4000-8000-000000000060';
  session_host uuid := 'a1a1a1a1-0000-4000-8000-000000000070';
begin
  delete from auth.users where email = 'demo@1apply.dev' or id = demo_id;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000',
    demo_id,
    'authenticated',
    'authenticated',
    'demo@1apply.dev',
    crypt('DemoApply2026!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Areej Rahman"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    demo_id,
    demo_id,
    jsonb_build_object('sub', demo_id::text, 'email', 'demo@1apply.dev'),
    'email',
    demo_id::text,
    now(),
    now(),
    now()
  )
  on conflict do nothing;

  update public.profiles
  set
    email = 'demo@1apply.dev',
    display_name = 'Areej Rahman',
    headline = 'Full-stack intern · retrieval systems',
    phone = '+92 300 555 0101',
    location_city = 'Islamabad',
    location_country = 'Pakistan',
    timezone = 'Asia/Karachi',
    linkedin_url = 'https://www.linkedin.com/in/areej-demo',
    github_url = 'https://github.com/areej-demo',
    portfolio_url = 'https://areej-demo.dev',
    work_authorization = 'Pakistan — eligible to intern locally',
    availability = 'June 2026 · full-time internship',
    terms_accepted_at = now() - interval '14 days',
    ai_processing_accepted_at = now() - interval '14 days',
    onboarding_completed_at = now() - interval '13 days',
    onboarding_step = 'done',
    preferences = jsonb_build_object(
      'university', 'NUST',
      'educationSummary', 'BS Computer Science, 2026',
      'prepareAndSendIfSilent', true,
      'guideDismissed', false,
      'onboardingSkippedDocuments', false,
      'onboardingSkippedProfile', false
    )
  where id = demo_id;

  insert into public.experiences (
    id, user_id, kind, organization, title, location, start_date, end_date, summary, source
  ) values
    (ev_edu, demo_id, 'education', 'NUST', 'BS Computer Science', 'Islamabad', '2022-09-01', null,
     'Coursework in databases, information retrieval, and full-stack systems.', 'manual'),
    (ev_intern, demo_id, 'employment', 'Campus Applied Research Lab', 'Software intern', 'Islamabad', '2025-06-01', '2025-08-31',
     'Shipped a retrieval demo that ranked campus postings for students.', 'resume'),
    (ev_hack, demo_id, 'project', 'Bano Qabil Hackathon', '1-Apply prototype', 'Karachi', '2026-08-01', '2026-08-28',
     'Evidence-grounded application kit: upload once, reuse across postings.', 'manual');

  insert into public.evidence_items (
    id, user_id, experience_id, title, kind, organization, situation, action, outcome, metrics, skills,
    source, confidence, verification_status, excluded_from_ai, extraction_status, fact_key
  ) values
    (ev_intern, demo_id, ev_intern, 'Ranked campus internship board', 'employment', 'Campus Applied Research Lab',
     'Students missed internships because postings were scattered across PDFs and sites.',
     'Built a retrieval index over posting text and returned evidence-backed matches.',
     'Shipped a working demo used by 40 classmates during a two-week pilot.',
     'Pilot: 40 students',
     array['TypeScript', 'PostgreSQL', 'retrieval'],
     'resume', 0.92, 'verified', false, 'extracted', 'experience:campus-lab'),
    (ev_hack, demo_id, ev_hack, 'Application memory for hackathon judging', 'project', 'Bano Qabil Hackathon',
     'Judges needed a complete kit plus Need You, deadline freeze, and host CAPTCHA walls.',
     'Modeled kit facts, packet lanes, and grounded answers that never invent experience.',
     'Demo account walks the full apply pipeline without clicking host Submit.',
     null,
     array['Next.js', 'Supabase', 'Zod'],
     'manual', 0.95, 'verified', false, 'manual', 'project:1-apply'),
    (ev_edu, demo_id, ev_edu, 'NUST CS degree in progress', 'education', 'NUST',
     'Need a reusable education fact for every form.',
     'Recorded degree, expected graduation, and Islamabad campus.',
     'Kit can fill university and education fields without retyping.',
     'Expected 2026',
     array['Computer Science'],
     'manual', 0.99, 'verified', false, 'manual', 'education:nust');

  insert into public.skills (user_id, name, normalized_name, source) values
    (demo_id, 'TypeScript', 'typescript', 'resume'),
    (demo_id, 'Next.js', 'next.js', 'resume'),
    (demo_id, 'PostgreSQL', 'postgresql', 'resume'),
    (demo_id, 'Retrieval', 'retrieval', 'resume');

  insert into public.profile_facts (
    user_id, fact_type, value, source, confidence, verification_status, category, fact_key, extraction_status
  ) values
    (demo_id, 'university', '{"text":"NUST"}'::jsonb, 'onboarding', 1, 'verified', 'education', 'education:university', 'manual'),
    (demo_id, 'education_summary', '{"text":"BS Computer Science, 2026"}'::jsonb, 'onboarding', 1, 'verified', 'education', 'education:summary', 'manual'),
    (demo_id, 'skill', '{"text":"TypeScript"}'::jsonb, 'resume', 0.9, 'verified', 'skills', 'skill:typescript', 'extracted'),
    (demo_id, 'skill', '{"text":"Next.js"}'::jsonb, 'resume', 0.9, 'verified', 'skills', 'skill:nextjs', 'extracted');

  insert into public.profile_links (user_id, kind, url, label) values
    (demo_id, 'github', 'https://github.com/areej-demo', 'GitHub'),
    (demo_id, 'linkedin', 'https://www.linkedin.com/in/areej-demo', 'LinkedIn');

  insert into public.documents (id, user_id, type, label) values
    (resume_id, demo_id, 'resume', 'Software intern resume'),
    (cnic_id, demo_id, 'identity_document', 'CNIC (demo placeholder)'),
    (transcript_id, demo_id, 'transcript', 'NUST unofficial transcript');

  insert into public.document_versions (
    id, document_id, user_id, version_label, storage_path, file_hash, mime_type, byte_size, status, original_filename, source
  ) values
    (resume_ver, resume_id, demo_id, 'v1', demo_id::text || '/resume-demo.txt', 'demo-hash-resume', 'text/plain', 420, 'ready', 'areej-rahman-resume.txt', 'seed'),
    (cnic_ver, cnic_id, demo_id, 'v1', demo_id::text || '/cnic-demo.txt', 'demo-hash-cnic', 'text/plain', 120, 'ready', 'cnic-placeholder.txt', 'seed'),
    (transcript_ver, transcript_id, demo_id, 'v1', demo_id::text || '/transcript-demo.txt', 'demo-hash-transcript', 'text/plain', 180, 'ready', 'transcript-placeholder.txt', 'seed');

  update public.documents set current_version_id = resume_ver where id = resume_id;
  update public.documents set current_version_id = cnic_ver where id = cnic_id;
  update public.documents set current_version_id = transcript_ver where id = transcript_id;

  insert into public.resumes (document_id, user_id, target_role, notes, category_key, category_label)
  values (resume_id, demo_id, 'Software intern', 'General SWE intern track', 'software_intern', 'Software intern');

  insert into public.opportunities (
    id, user_id, source, source_url, canonical_url, title, organization, category, location,
    deadline_at, raw_excerpt, analysis_status, analyzed_at, deadline_timezone
  ) values
    (opp_needs, demo_id, 'url', 'https://careers.example.com/careem-swe-intern', 'https://careers.example.com/careem-swe-intern',
     'Software Engineering Intern', 'Careem', 'internship', 'Islamabad / remote',
     now() + interval '4 days', 'Need You lane: missing cover letter and GPA.', 'ready', now() - interval '1 day', 'Asia/Karachi'),
    (opp_deadline, demo_id, 'manual', null, null,
     'Applied Research Intern', 'NUST-SEECS Lab', 'internship', 'Islamabad',
     now() + interval '2 days', 'Complete packet. Silence will freeze at the deadline.', 'ready', now() - interval '2 days', 'Asia/Karachi'),
    (opp_host, demo_id, 'extension', 'https://boards.example.com/systems-frontend', 'https://boards.example.com/systems-frontend',
     'Frontend Intern', 'Systems Limited', 'internship', 'Lahore',
     now() + interval '6 days', 'Host page shows CAPTCHA. 1-Apply never bypasses it.', 'ready', now() - interval '12 hours', 'Asia/Karachi'),
    (opp_submitted, demo_id, 'url', 'https://careers.example.com/google-step', 'https://careers.example.com/google-step',
     'STEP Intern', 'Example Labs', 'internship', 'Remote',
     now() - interval '3 days', 'Already frozen and marked submitted by the applicant.', 'ready', now() - interval '10 days', 'Asia/Karachi'),
    (opp_interview, demo_id, 'discovery', null, null,
     'CS Scholarship', 'Bano Qabil', 'scholarship', 'Karachi',
     now() + interval '21 days', 'Host moved the packet to interview after a frozen snapshot.', 'ready', now() - interval '20 days', 'Asia/Karachi');

  insert into public.applications (
    id, user_id, opportunity_id, status, deadline_at, next_action, submitted_at, completeness_percent, deadline_timezone
  ) values
    (app_needs, demo_id, opp_needs, 'review_required', now() + interval '4 days',
     'Need You: attach a cover letter and confirm GPA.', null, 48, 'Asia/Karachi'),
    (app_deadline, demo_id, opp_deadline, 'in_progress', now() + interval '2 days',
     'Packet is complete. 1-Apply will freeze it if you stay silent.', null, 96, 'Asia/Karachi'),
    (app_host, demo_id, opp_host, 'in_progress', now() + interval '6 days',
     'Waiting on host CAPTCHA. Complete it yourself — 1-Apply will not click Submit.', null, 88, 'Asia/Karachi'),
    (app_submitted, demo_id, opp_submitted, 'submitted', now() - interval '3 days',
     'Track the host process. 1-Apply did not send this application.', now() - interval '8 days', 100, 'Asia/Karachi'),
    (app_interview, demo_id, opp_interview, 'interview', now() + interval '21 days',
     'Interview scheduled by the host. Keep the frozen snapshot.', now() - interval '18 days', 100, 'Asia/Karachi');

  insert into public.opportunity_documents (user_id, opportunity_id, label, required) values
    (demo_id, opp_needs, 'Resume', true),
    (demo_id, opp_needs, 'Cover letter', true),
    (demo_id, opp_deadline, 'Resume', true),
    (demo_id, opp_host, 'Resume', true),
    (demo_id, opp_submitted, 'Resume', true),
    (demo_id, opp_interview, 'Transcript', true);

  insert into public.application_documents (user_id, application_id, document_id, document_version_id) values
    (demo_id, app_needs, resume_id, resume_ver),
    (demo_id, app_deadline, resume_id, resume_ver),
    (demo_id, app_host, resume_id, resume_ver),
    (demo_id, app_submitted, resume_id, resume_ver),
    (demo_id, app_interview, transcript_id, transcript_ver);

  insert into public.opportunity_questions (id, user_id, opportunity_id, prompt, limit_value, limit_unit, sort_order, required) values
    (q_needs, demo_id, opp_needs, 'Why do you want this internship? (200 words)', 200, 'words', 0, true),
    (q_deadline, demo_id, opp_deadline, 'Describe a retrieval or ranking project you shipped.', 150, 'words', 0, true),
    (q_host, demo_id, opp_host, 'Which frontend stack are you strongest in?', 80, 'words', 0, true),
    (q_submitted, demo_id, opp_submitted, 'Tell us about a time you used evidence, not guesses.', 150, 'words', 0, true);

  insert into public.application_answers (
    user_id, application_id, question_id, state, original_ai_text, approved_text, evidence_ids, grounding_score, model
  ) values
    (demo_id, app_deadline, q_deadline, 'approved',
     'At the campus lab I indexed internship PDFs and returned ranked matches with cited snippets so students could see why a role fit.',
     'At the campus lab I indexed internship PDFs and returned ranked matches with cited snippets so students could see why a role fit.',
     array[ev_intern], 0.94, 'seed'),
    (demo_id, app_host, q_host, 'approved',
     'I am strongest in TypeScript and Next.js, with PostgreSQL for the kit and packet data.',
     'I am strongest in TypeScript and Next.js, with PostgreSQL for the kit and packet data.',
     array[ev_hack], 0.91, 'seed'),
    (demo_id, app_submitted, q_submitted, 'approved',
     '1-Apply drafts only from verified kit evidence. If a fact is missing, Need You asks instead of inventing it.',
     '1-Apply drafts only from verified kit evidence. If a fact is missing, Need You asks instead of inventing it.',
     array[ev_hack], 0.96, 'seed');

  insert into public.requirements (id, user_id, opportunity_id, text, hard, confidence, kind) values
    (req_needs, demo_id, opp_needs, 'Minimum GPA 3.0', true, 0.8, 'education');

  insert into public.eligibility_results (
    user_id, application_id, requirement_id, state, explanation, requirement_text, requirement_kind, needs_confirmation
  ) values
    (demo_id, app_needs, req_needs, 'unclear', 'GPA is not in the kit yet — confirm it in Need You.', 'Minimum GPA 3.0', 'education', true);

  insert into public.fit_evaluations (
    user_id, application_id, score, skills_match, experience_match, education_match, project_relevance, eligibility, missing, rationale, strengths
  ) values
    (demo_id, app_needs, 74, 80, 72, 88, 70, 55, array['GPA', 'Cover letter'], 'Strong CS intern fit; kit is missing GPA and a cover letter.', array['TypeScript', 'NUST CS']),
    (demo_id, app_deadline, 91, 92, 90, 94, 88, 90, '{}', 'Complete packet with verified retrieval evidence.', array['Retrieval demo', 'Verified education']),
    (demo_id, app_host, 84, 88, 80, 90, 82, 86, '{}', 'Frontend intern fit. Host CAPTCHA blocks autofill submit.', array['Next.js']),
    (demo_id, app_submitted, 88, 86, 84, 90, 90, 92, '{}', 'Frozen snapshot after the applicant submitted on the host.', array['Grounded answers']),
    (demo_id, app_interview, 79, 70, 76, 92, 74, 88, '{}', 'Scholarship moved to interview after a complete kit.', array['Transcript on file']);

  insert into public.resume_matches (
    user_id, application_id, document_id, document_version_id, score, suggestion, label, recommended, explanation
  ) values
    (demo_id, app_needs, resume_id, resume_ver, 86, 'Use the software intern resume.', 'Software intern resume', true, 'Matches TypeScript internship language.'),
    (demo_id, app_deadline, resume_id, resume_ver, 93, 'Use the software intern resume.', 'Software intern resume', true, 'Retrieval project aligns with the lab posting.');

  insert into public.field_mappings (
    user_id, application_id, field_key, label, value, source, confidence, excluded_by_default, field_type
  ) values
    (demo_id, app_needs, 'gpa', 'Cumulative GPA', '', 'needs_you', 0.2, false, 'text'),
    (demo_id, app_deadline, 'full_name', 'Full name', 'Areej Rahman', 'kit', 0.99, false, 'text');

  insert into public.fill_sessions (id, user_id, application_id, origin, expires_at, hazards) values
    (session_host, demo_id, app_host, 'https://boards.example.com/systems-frontend', now() + interval '7 days',
     '{"captcha":true,"captchaMessage":"Host page shows a CAPTCHA. 1-Apply never bypasses it."}'::jsonb);

  insert into public.submission_snapshots (
    user_id, application_id, submitted_at, answer_manifest, document_manifest, opportunity_snapshot, evidence_manifest, field_manifest, application_status, deadline_at
  ) values
    (demo_id, app_submitted, now() - interval '8 days',
     '{"answers":1}'::jsonb, '{"resume":"v1"}'::jsonb, '{"title":"STEP Intern"}'::jsonb,
     '[]'::jsonb, '[]'::jsonb, 'submitted', now() - interval '3 days');

  insert into public.notifications (
    user_id, application_id, opportunity_id, title, body, category, action_url, priority, created_at
  ) values
    (demo_id, app_needs, opp_needs, 'Need You: Careem intern',
     'Cover letter and GPA are still missing. Open Need You to finish the packet.',
     'needs_you', '/app/needs-you', 80, now() - interval '3 hours'),
    (demo_id, app_deadline, opp_deadline, 'Deadline freeze in 2 days',
     'NUST-SEECS packet is complete. If you stay silent, 1-Apply will freeze it — it will not click host Submit.',
     'deadline', '/app/applications/' || app_deadline::text, 70, now() - interval '1 hour'),
    (demo_id, app_host, opp_host, 'Waiting on host CAPTCHA',
     'Frontend intern fill is paused on a CAPTCHA. Complete that step yourself.',
     'host', '/app/applications/' || app_host::text, 60, now() - interval '30 minutes'),
    (demo_id, app_submitted, opp_submitted, 'Packet frozen',
     'STEP intern snapshot is stored. Track the host — 1-Apply did not send the form.',
     'submitted', '/app/applications/' || app_submitted::text, 20, now() - interval '8 days');
end $$;
