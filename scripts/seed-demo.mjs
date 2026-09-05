/**
 * Creates / refreshes the hackathon demo account against hosted or local Supabase.
 *
 *   npm run seed:demo
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment
 * or apps/web/.env.local. Sign in as demo@1apply.dev / DemoApply2026!
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEMO_EMAIL = "demo@1apply.dev";
const DEMO_PASSWORD = "DemoApply2026!";
const ROOT = path.resolve(import.meta.dirname, "..");

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, "apps/web/.env.local"));
loadEnvFile(path.join(ROOT, ".env.local"));
loadEnvFile(path.join(ROOT, ".env"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || serviceKey.startsWith("replace-with")) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function id(suffix) {
  return `a1a1a1a1-0000-4000-8000-${suffix}`;
}

async function must(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

function isoOffset(days, hours = 0) {
  return new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
}

async function ensureUser() {
  const created = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Areej Rahman" },
  });
  if (!created.error && created.data.user) return created.data.user.id;

  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listed.error) throw new Error(listed.error.message);
  const existing = listed.data.users.find((user) => user.email === DEMO_EMAIL);
  if (!existing) throw new Error(created.error?.message ?? "Could not create demo user");
  await supabase.auth.admin.updateUserById(existing.id, {
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: "Areej Rahman" },
  });
  return existing.id;
}

async function wipe(userId) {
  const tables = [
    "notifications",
    "fill_sessions",
    "field_mappings",
    "resume_matches",
    "fit_evaluations",
    "eligibility_results",
    "application_answers",
    "application_documents",
    "submission_snapshots",
    "applications",
    "opportunity_questions",
    "opportunity_documents",
    "requirements",
    "opportunities",
    "resumes",
    "evidence_items",
    "experiences",
    "profile_facts",
    "skills",
    "profile_links",
  ];
  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error && error.code !== "42P01") {
      throw new Error(`wipe ${table}: ${error.message}`);
    }
  }
  await supabase.from("documents").update({ current_version_id: null }).eq("user_id", userId);
  const { error: docsError } = await supabase.from("documents").delete().eq("user_id", userId);
  if (docsError && docsError.code !== "42P01") {
    throw new Error(`wipe documents: ${docsError.message}`);
  }
}

async function seed(userId) {
  const resumeId = id("000000000010");
  const resumeVer = id("000000000011");
  const cnicId = id("000000000012");
  const cnicVer = id("000000000013");
  const transcriptId = id("000000000014");
  const transcriptVer = id("000000000015");
  const evIntern = id("000000000020");
  const evHack = id("000000000021");
  const evEdu = id("000000000022");
  const oppNeeds = id("000000000030");
  const oppDeadline = id("000000000031");
  const oppHost = id("000000000032");
  const oppSubmitted = id("000000000033");
  const oppInterview = id("000000000034");
  const appNeeds = id("000000000040");
  const appDeadline = id("000000000041");
  const appHost = id("000000000042");
  const appSubmitted = id("000000000043");
  const appInterview = id("000000000044");
  const qNeeds = id("000000000050");
  const qDeadline = id("000000000051");
  const qHost = id("000000000052");
  const qSubmitted = id("000000000053");
  const reqNeeds = id("000000000060");

  const { data: existingProfile } = await supabase.from("profiles").select("terms_accepted_at, ai_processing_accepted_at, onboarding_completed_at").eq("id", userId).maybeSingle();

  const profilePatch = {
    email: DEMO_EMAIL,
    display_name: "Areej Rahman",
    headline: "Full-stack intern · retrieval systems",
    phone: "+92 300 555 0101",
    location_city: "Islamabad",
    location_country: "Pakistan",
    timezone: "Asia/Karachi",
    linkedin_url: "https://www.linkedin.com/in/areej-demo",
    github_url: "https://github.com/areej-demo",
    portfolio_url: "https://areej-demo.dev",
    work_authorization: "Pakistan — eligible to intern locally",
    availability: "June 2026 · full-time internship",
    onboarding_step: "done",
    preferences: {
      university: "NUST",
      educationSummary: "BS Computer Science, 2026",
      prepareAndSendIfSilent: true,
      guideDismissed: false,
      onboardingSkippedDocuments: false,
      onboardingSkippedProfile: false,
    },
  };
  if (!existingProfile?.terms_accepted_at) profilePatch.terms_accepted_at = isoOffset(-14);
  if (!existingProfile?.ai_processing_accepted_at) profilePatch.ai_processing_accepted_at = isoOffset(-14);
  if (!existingProfile?.onboarding_completed_at) profilePatch.onboarding_completed_at = isoOffset(-13);

  await must("profile", await supabase.from("profiles").update(profilePatch).eq("id", userId));

  await must(
    "experiences",
    await supabase.from("experiences").insert([
      {
        id: evEdu,
        user_id: userId,
        kind: "education",
        organization: "NUST",
        title: "BS Computer Science",
        location: "Islamabad",
        start_date: "2022-09-01",
        summary: "Coursework in databases, information retrieval, and full-stack systems.",
        source: "manual",
      },
      {
        id: evIntern,
        user_id: userId,
        kind: "employment",
        organization: "Campus Applied Research Lab",
        title: "Software intern",
        location: "Islamabad",
        start_date: "2025-06-01",
        end_date: "2025-08-31",
        summary: "Shipped a retrieval demo that ranked campus postings for students.",
        source: "resume",
      },
      {
        id: evHack,
        user_id: userId,
        kind: "project",
        organization: "Bano Qabil Hackathon",
        title: "1-Apply prototype",
        location: "Karachi",
        start_date: "2026-08-01",
        end_date: "2026-08-28",
        summary: "Evidence-grounded application kit: upload once, reuse across postings.",
        source: "manual",
      },
    ]),
  );

  await must(
    "evidence",
    await supabase.from("evidence_items").insert([
      {
        id: evIntern,
        user_id: userId,
        experience_id: evIntern,
        title: "Ranked campus internship board",
        kind: "employment",
        organization: "Campus Applied Research Lab",
        situation: "Students missed internships because postings were scattered across PDFs and sites.",
        action: "Built a retrieval index over posting text and returned evidence-backed matches.",
        outcome: "Shipped a working demo used by 40 classmates during a two-week pilot.",
        metrics: "Pilot: 40 students",
        skills: ["TypeScript", "PostgreSQL", "retrieval"],
        source: "resume",
        confidence: 0.92,
        verification_status: "verified",
        extraction_status: "extracted",
        fact_key: "experience:campus-lab",
      },
      {
        id: evHack,
        user_id: userId,
        experience_id: evHack,
        title: "Application memory for hackathon judging",
        kind: "project",
        organization: "Bano Qabil Hackathon",
        situation: "Judges needed a complete kit plus Need You, deadline freeze, and host CAPTCHA walls.",
        action: "Modeled kit facts, packet lanes, and grounded answers that never invent experience.",
        outcome: "Demo account walks the full apply pipeline without clicking host Submit.",
        skills: ["Next.js", "Supabase", "Zod"],
        source: "manual",
        confidence: 0.95,
        verification_status: "verified",
        extraction_status: "manual",
        fact_key: "project:1-apply",
      },
      {
        id: evEdu,
        user_id: userId,
        experience_id: evEdu,
        title: "NUST CS degree in progress",
        kind: "education",
        organization: "NUST",
        situation: "Need a reusable education fact for every form.",
        action: "Recorded degree, expected graduation, and Islamabad campus.",
        outcome: "Kit can fill university and education fields without retyping.",
        metrics: "Expected 2026",
        skills: ["Computer Science"],
        source: "manual",
        confidence: 0.99,
        verification_status: "verified",
        extraction_status: "manual",
        fact_key: "education:nust",
      },
    ]),
  );

  await must(
    "skills",
    await supabase.from("skills").insert(
      ["TypeScript", "Next.js", "PostgreSQL", "Retrieval"].map((name) => ({
        user_id: userId,
        name,
        normalized_name: name.toLowerCase(),
        source: "resume",
      })),
    ),
  );

  await must(
    "facts",
    await supabase.from("profile_facts").insert([
      {
        user_id: userId,
        fact_type: "university",
        value: { text: "NUST" },
        source: "onboarding",
        confidence: 1,
        verification_status: "verified",
        category: "education",
        fact_key: "education:university",
        extraction_status: "manual",
      },
      {
        user_id: userId,
        fact_type: "education_summary",
        value: { text: "BS Computer Science, 2026" },
        source: "onboarding",
        confidence: 1,
        verification_status: "verified",
        category: "education",
        fact_key: "education:summary",
        extraction_status: "manual",
      },
    ]),
  );

  await must(
    "links",
    await supabase.from("profile_links").insert([
      { user_id: userId, kind: "github", url: "https://github.com/areej-demo", label: "GitHub" },
      { user_id: userId, kind: "linkedin", url: "https://www.linkedin.com/in/areej-demo", label: "LinkedIn" },
    ]),
  );

  await must(
    "documents",
    await supabase.from("documents").insert([
      { id: resumeId, user_id: userId, type: "resume", label: "Software intern resume" },
      { id: cnicId, user_id: userId, type: "supporting_document", label: "CNIC (demo placeholder)" },
      { id: transcriptId, user_id: userId, type: "transcript", label: "NUST unofficial transcript" },
    ]),
  );

  await must(
    "versions",
    await supabase.from("document_versions").insert([
      {
        id: resumeVer,
        document_id: resumeId,
        user_id: userId,
        version_label: "v1",
        storage_path: `${userId}/resume-demo.txt`,
        file_hash: `demo-hash-resume-${userId.slice(0, 8)}`,
        mime_type: "text/plain",
        byte_size: 420,
        status: "ready",
        original_filename: "areej-rahman-resume.txt",
        source: "seed",
      },
      {
        id: cnicVer,
        document_id: cnicId,
        user_id: userId,
        version_label: "v1",
        storage_path: `${userId}/cnic-demo.txt`,
        file_hash: `demo-hash-cnic-${userId.slice(0, 8)}`,
        mime_type: "text/plain",
        byte_size: 120,
        status: "ready",
        original_filename: "cnic-placeholder.txt",
        source: "seed",
      },
      {
        id: transcriptVer,
        document_id: transcriptId,
        user_id: userId,
        version_label: "v1",
        storage_path: `${userId}/transcript-demo.txt`,
        file_hash: `demo-hash-transcript-${userId.slice(0, 8)}`,
        mime_type: "text/plain",
        byte_size: 180,
        status: "ready",
        original_filename: "transcript-placeholder.txt",
        source: "seed",
      },
    ]),
  );

  await must("resume current", await supabase.from("documents").update({ current_version_id: resumeVer }).eq("id", resumeId));
  await must("cnic current", await supabase.from("documents").update({ current_version_id: cnicVer }).eq("id", cnicId));
  await must(
    "transcript current",
    await supabase.from("documents").update({ current_version_id: transcriptVer }).eq("id", transcriptId),
  );

  await must(
    "resume row",
    await supabase.from("resumes").insert({
      document_id: resumeId,
      user_id: userId,
      target_role: "Software intern",
      notes: "General SWE intern track",
      category_key: "software_intern",
      category_label: "Software intern",
    }),
  );

  await must(
    "opportunities",
    await supabase.from("opportunities").insert([
      {
        id: oppNeeds,
        user_id: userId,
        source: "url",
        source_url: "https://careers.example.com/careem-swe-intern",
        canonical_url: "https://careers.example.com/careem-swe-intern",
        title: "Software Engineering Intern",
        organization: "Careem",
        category: "internship",
        location: "Islamabad / remote",
        deadline_at: isoOffset(4),
        raw_excerpt: "Need You lane: missing cover letter and GPA.",
        analysis_status: "ready",
        analyzed_at: isoOffset(-1),
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: oppDeadline,
        user_id: userId,
        source: "manual",
        title: "Applied Research Intern",
        organization: "NUST-SEECS Lab",
        category: "internship",
        location: "Islamabad",
        deadline_at: isoOffset(2),
        raw_excerpt: "Complete packet. Silence will freeze at the deadline.",
        analysis_status: "ready",
        analyzed_at: isoOffset(-2),
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: oppHost,
        user_id: userId,
        source: "extension",
        source_url: "https://boards.example.com/systems-frontend",
        canonical_url: "https://boards.example.com/systems-frontend",
        title: "Frontend Intern",
        organization: "Systems Limited",
        category: "internship",
        location: "Lahore",
        deadline_at: isoOffset(6),
        raw_excerpt: "Host page shows CAPTCHA. 1-Apply never bypasses it.",
        analysis_status: "ready",
        analyzed_at: isoOffset(0, -12),
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: oppSubmitted,
        user_id: userId,
        source: "url",
        source_url: "https://careers.example.com/google-step",
        canonical_url: "https://careers.example.com/google-step",
        title: "STEP Intern",
        organization: "Example Labs",
        category: "internship",
        location: "Remote",
        deadline_at: isoOffset(-3),
        raw_excerpt: "Already frozen and marked submitted by the applicant.",
        analysis_status: "ready",
        analyzed_at: isoOffset(-10),
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: oppInterview,
        user_id: userId,
        source: "discovery",
        title: "CS Scholarship",
        organization: "Bano Qabil",
        category: "scholarship",
        location: "Karachi",
        deadline_at: isoOffset(21),
        raw_excerpt: "Host moved the packet to interview after a frozen snapshot.",
        analysis_status: "ready",
        analyzed_at: isoOffset(-20),
        deadline_timezone: "Asia/Karachi",
      },
    ]),
  );

  await must(
    "applications",
    await supabase.from("applications").insert([
      {
        id: appNeeds,
        user_id: userId,
        opportunity_id: oppNeeds,
        status: "review_required",
        deadline_at: isoOffset(4),
        next_action: "Need You: attach a cover letter and confirm GPA.",
        completeness_percent: 48,
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: appDeadline,
        user_id: userId,
        opportunity_id: oppDeadline,
        status: "in_progress",
        deadline_at: isoOffset(2),
        next_action: "Packet is complete. 1-Apply will freeze it if you stay silent.",
        completeness_percent: 96,
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: appHost,
        user_id: userId,
        opportunity_id: oppHost,
        status: "in_progress",
        deadline_at: isoOffset(6),
        next_action: "Waiting on host CAPTCHA. Complete it yourself — 1-Apply will not click Submit.",
        completeness_percent: 88,
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: appSubmitted,
        user_id: userId,
        opportunity_id: oppSubmitted,
        status: "submitted",
        deadline_at: isoOffset(-3),
        next_action: "Track the host process. 1-Apply did not send this application.",
        submitted_at: isoOffset(-8),
        completeness_percent: 100,
        deadline_timezone: "Asia/Karachi",
      },
      {
        id: appInterview,
        user_id: userId,
        opportunity_id: oppInterview,
        status: "interview",
        deadline_at: isoOffset(21),
        next_action: "Interview scheduled by the host. Keep the frozen snapshot.",
        submitted_at: isoOffset(-18),
        completeness_percent: 100,
        deadline_timezone: "Asia/Karachi",
      },
    ]),
  );

  await must(
    "opp docs",
    await supabase.from("opportunity_documents").insert([
      { user_id: userId, opportunity_id: oppNeeds, label: "Resume", required: true },
      { user_id: userId, opportunity_id: oppNeeds, label: "Cover letter", required: true },
      { user_id: userId, opportunity_id: oppDeadline, label: "Resume", required: true },
      { user_id: userId, opportunity_id: oppHost, label: "Resume", required: true },
      { user_id: userId, opportunity_id: oppSubmitted, label: "Resume", required: true },
      { user_id: userId, opportunity_id: oppInterview, label: "Transcript", required: true },
    ]),
  );

  await must(
    "app docs",
    await supabase.from("application_documents").insert([
      { user_id: userId, application_id: appNeeds, document_id: resumeId, document_version_id: resumeVer },
      { user_id: userId, application_id: appDeadline, document_id: resumeId, document_version_id: resumeVer },
      { user_id: userId, application_id: appHost, document_id: resumeId, document_version_id: resumeVer },
      { user_id: userId, application_id: appSubmitted, document_id: resumeId, document_version_id: resumeVer },
      { user_id: userId, application_id: appInterview, document_id: transcriptId, document_version_id: transcriptVer },
    ]),
  );

  await must(
    "questions",
    await supabase.from("opportunity_questions").insert([
      {
        id: qNeeds,
        user_id: userId,
        opportunity_id: oppNeeds,
        prompt: "Why do you want this internship? (200 words)",
        limit_value: 200,
        limit_unit: "words",
        sort_order: 0,
        required: true,
      },
      {
        id: qDeadline,
        user_id: userId,
        opportunity_id: oppDeadline,
        prompt: "Describe a retrieval or ranking project you shipped.",
        limit_value: 150,
        limit_unit: "words",
        sort_order: 0,
        required: true,
      },
      {
        id: qHost,
        user_id: userId,
        opportunity_id: oppHost,
        prompt: "Which frontend stack are you strongest in?",
        limit_value: 80,
        limit_unit: "words",
        sort_order: 0,
        required: true,
      },
      {
        id: qSubmitted,
        user_id: userId,
        opportunity_id: oppSubmitted,
        prompt: "Tell us about a time you used evidence, not guesses.",
        limit_value: 150,
        limit_unit: "words",
        sort_order: 0,
        required: true,
      },
    ]),
  );

  await must(
    "answers",
    await supabase.from("application_answers").insert([
      {
        user_id: userId,
        application_id: appDeadline,
        question_id: qDeadline,
        state: "approved",
        original_ai_text:
          "At the campus lab I indexed internship PDFs and returned ranked matches with cited snippets so students could see why a role fit.",
        approved_text:
          "At the campus lab I indexed internship PDFs and returned ranked matches with cited snippets so students could see why a role fit.",
        evidence_ids: [evIntern],
        grounding_score: 0.94,
        model: "seed",
      },
      {
        user_id: userId,
        application_id: appHost,
        question_id: qHost,
        state: "approved",
        original_ai_text: "I am strongest in TypeScript and Next.js, with PostgreSQL for the kit and packet data.",
        approved_text: "I am strongest in TypeScript and Next.js, with PostgreSQL for the kit and packet data.",
        evidence_ids: [evHack],
        grounding_score: 0.91,
        model: "seed",
      },
      {
        user_id: userId,
        application_id: appSubmitted,
        question_id: qSubmitted,
        state: "approved",
        original_ai_text:
          "1-Apply drafts only from verified kit evidence. If a fact is missing, Need You asks instead of inventing it.",
        approved_text:
          "1-Apply drafts only from verified kit evidence. If a fact is missing, Need You asks instead of inventing it.",
        evidence_ids: [evHack],
        grounding_score: 0.96,
        model: "seed",
      },
    ]),
  );

  await must(
    "requirement",
    await supabase.from("requirements").insert({
      id: reqNeeds,
      user_id: userId,
      opportunity_id: oppNeeds,
      text: "Minimum GPA 3.0",
      hard: true,
      confidence: 0.8,
      kind: "education",
    }),
  );

  await must(
    "eligibility",
    await supabase.from("eligibility_results").insert({
      user_id: userId,
      application_id: appNeeds,
      requirement_id: reqNeeds,
      state: "unclear",
      explanation: "GPA is not in the kit yet — confirm it in Need You.",
      requirement_text: "Minimum GPA 3.0",
      requirement_kind: "education",
      needs_confirmation: true,
    }),
  );

  await must(
    "fit",
    await supabase.from("fit_evaluations").insert([
      {
        user_id: userId,
        application_id: appNeeds,
        score: 74,
        skills_match: 80,
        experience_match: 72,
        education_match: 88,
        project_relevance: 70,
        eligibility: 55,
        missing: ["GPA", "Cover letter"],
        rationale: "Strong CS intern fit; kit is missing GPA and a cover letter.",
        strengths: ["TypeScript", "NUST CS"],
      },
      {
        user_id: userId,
        application_id: appDeadline,
        score: 91,
        skills_match: 92,
        experience_match: 90,
        education_match: 94,
        project_relevance: 88,
        eligibility: 90,
        missing: [],
        rationale: "Complete packet with verified retrieval evidence.",
        strengths: ["Retrieval demo", "Verified education"],
      },
      {
        user_id: userId,
        application_id: appHost,
        score: 84,
        skills_match: 88,
        experience_match: 80,
        education_match: 90,
        project_relevance: 82,
        eligibility: 86,
        missing: [],
        rationale: "Frontend intern fit. Host CAPTCHA blocks autofill submit.",
        strengths: ["Next.js"],
      },
      {
        user_id: userId,
        application_id: appSubmitted,
        score: 88,
        skills_match: 86,
        experience_match: 84,
        education_match: 90,
        project_relevance: 90,
        eligibility: 92,
        missing: [],
        rationale: "Frozen snapshot after the applicant submitted on the host.",
        strengths: ["Grounded answers"],
      },
      {
        user_id: userId,
        application_id: appInterview,
        score: 79,
        skills_match: 70,
        experience_match: 76,
        education_match: 92,
        project_relevance: 74,
        eligibility: 88,
        missing: [],
        rationale: "Scholarship moved to interview after a complete kit.",
        strengths: ["Transcript on file"],
      },
    ]),
  );

  await must(
    "resume matches",
    await supabase.from("resume_matches").insert([
      {
        user_id: userId,
        application_id: appNeeds,
        document_id: resumeId,
        document_version_id: resumeVer,
        score: 86,
        suggestion: "Use the software intern resume.",
        label: "Software intern resume",
        recommended: true,
        explanation: "Matches TypeScript internship language.",
      },
      {
        user_id: userId,
        application_id: appDeadline,
        document_id: resumeId,
        document_version_id: resumeVer,
        score: 93,
        suggestion: "Use the software intern resume.",
        label: "Software intern resume",
        recommended: true,
        explanation: "Retrieval project aligns with the lab posting.",
      },
    ]),
  );

  await must(
    "field mappings",
    await supabase.from("field_mappings").insert([
      {
        user_id: userId,
        application_id: appNeeds,
        field_key: "gpa",
        label: "Cumulative GPA",
        value: "",
        source: "needs_you",
        confidence: 0.2,
        excluded_by_default: false,
        field_type: "text",
      },
      {
        user_id: userId,
        application_id: appDeadline,
        field_key: "full_name",
        label: "Full name",
        value: "Areej Rahman",
        source: "kit",
        confidence: 0.99,
        excluded_by_default: false,
        field_type: "text",
      },
    ]),
  );

  await must(
    "fill session",
    await supabase.from("fill_sessions").insert({
      user_id: userId,
      application_id: appHost,
      origin: "https://boards.example.com/systems-frontend",
      expires_at: isoOffset(7),
      hazards: {
        captcha: true,
        captchaMessage: "Host page shows a CAPTCHA. 1-Apply never bypasses it.",
      },
    }),
  );

  await must(
    "snapshot",
    await supabase.from("submission_snapshots").insert({
      user_id: userId,
      application_id: appSubmitted,
      submitted_at: isoOffset(-8),
      answer_manifest: { answers: 1 },
      document_manifest: { resume: "v1" },
      opportunity_snapshot: { title: "STEP Intern" },
      evidence_manifest: [],
      field_manifest: [],
      application_status: "submitted",
      deadline_at: isoOffset(-3),
    }),
  );

  await must(
    "notifications",
    await supabase.from("notifications").insert([
      {
        user_id: userId,
        application_id: appNeeds,
        opportunity_id: oppNeeds,
        title: "Need You: Careem intern",
        body: "Cover letter and GPA are still missing. Open Need You to finish the packet.",
        category: "needs_you",
        action_url: "/app/needs-you",
        priority: 80,
        created_at: isoOffset(0, -3),
      },
      {
        user_id: userId,
        application_id: appDeadline,
        opportunity_id: oppDeadline,
        title: "Deadline freeze in 2 days",
        body: "NUST-SEECS packet is complete. If you stay silent, 1-Apply will freeze it — it will not click host Submit.",
        category: "deadline",
        action_url: `/app/applications/${appDeadline}`,
        priority: 70,
        created_at: isoOffset(0, -1),
      },
      {
        user_id: userId,
        application_id: appHost,
        opportunity_id: oppHost,
        title: "Waiting on host CAPTCHA",
        body: "Frontend intern fill is paused on a CAPTCHA. Complete that step yourself.",
        category: "host",
        action_url: `/app/applications/${appHost}`,
        priority: 60,
        created_at: isoOffset(0, -0.5),
      },
      {
        user_id: userId,
        application_id: appSubmitted,
        opportunity_id: oppSubmitted,
        title: "Packet frozen",
        body: "STEP intern snapshot is stored. Track the host — 1-Apply did not send the form.",
        category: "submitted",
        action_url: `/app/applications/${appSubmitted}`,
        priority: 20,
        created_at: isoOffset(-8),
      },
    ]),
  );
}

const userId = await ensureUser();
await wipe(userId);
await seed(userId);
console.log(`Demo account ready: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
console.log("Open /sign-in, then dashboard, Need You, Your kit, Applications, and Notifications.");
