import { computeProfileCompleteness } from "@1apply/contracts";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { mapEvidence } from "@/server/memory/map-evidence";
import {
  asOne,
  type ApplicationListRow,
  type DocumentListRow,
  type EvidenceRow,
  type NotificationRow,
  type OpportunityListRow,
  type ProfileDetails,
} from "@/server/types";

export async function loadDashboard() {
  const { profile, supabase } = await requireWorkspace();

  const [
    { count: verifiedEvidenceCount },
    { count: documentCount },
    { data: applications },
    { data: notifications },
    { data: opportunities },
    { count: resumeCount },
  ] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id", { count: "exact", head: true })
      .eq("verification_status", "verified")
      .eq("excluded_from_ai", false),
    supabase.from("documents").select("id", { count: "exact", head: true }),
    supabase
      .from("applications")
      .select(
        "id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at, opportunities ( title, organization, category, source_url ), fit_evaluations ( score )",
      )
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("notifications")
      .select("id, title, body, read_at, created_at, application_id")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("opportunities")
      .select(
        "id, title, organization, category, source, source_url, location, analysis_status, deadline_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("type", "resume"),
  ]);

  const completeness = computeProfileCompleteness({
    displayName: profile.display_name,
    hasConsent: Boolean(profile.terms_accepted_at && profile.ai_processing_accepted_at),
    verifiedEvidenceCount: verifiedEvidenceCount ?? 0,
    documentCount: documentCount ?? 0,
  });

  return {
    profile,
    completeness,
    verifiedEvidenceCount: verifiedEvidenceCount ?? 0,
    documentCount: documentCount ?? 0,
    applications: (applications ?? []) as ApplicationListRow[],
    notifications: (notifications ?? []) as NotificationRow[],
    opportunities: (opportunities ?? []) as OpportunityListRow[],
    resumeCount: resumeCount ?? 0,
  };
}

export async function loadProfileWorkspace() {
  const { profile, supabase } = await requireWorkspace();
  const { data: full } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, headline, phone, location_city, location_country, linkedin_url, github_url, portfolio_url, availability, work_authorization",
    )
    .eq("id", profile.id)
    .single();
  const { data: evidence } = await supabase
    .from("evidence_items")
    .select(
      "id, title, kind, organization, situation, action, outcome, skills, source, verification_status, excluded_from_ai, created_at",
    )
    .order("created_at", { ascending: false });

  return {
    profile: (full as ProfileDetails | null) ?? {
      ...profile,
      phone: null,
      location_city: null,
      location_country: null,
      linkedin_url: null,
      github_url: null,
      portfolio_url: null,
      availability: null,
      work_authorization: null,
    },
    evidence: (evidence ?? []) as EvidenceRow[],
  };
}

export async function loadDocumentsWorkspace() {
  const { supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("documents")
    .select(
      "id, type, label, current_version_id, created_at, document_versions ( id, version_label, mime_type, byte_size, status, original_filename, created_at )",
    )
    .order("created_at", { ascending: false });
  return { documents: (data ?? []) as DocumentListRow[] };
}

export async function loadOpportunitiesWorkspace() {
  const { supabase } = await requireWorkspace();
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select(
      "id, title, organization, category, source, source_url, location, analysis_status, deadline_at, created_at",
    )
    .order("created_at", { ascending: false });
  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, status");
  const applicationByOpportunity = new Map(
    (applications ?? []).map((row: { id: string; opportunity_id: string; status: string }) => [
      row.opportunity_id,
      { id: row.id, status: row.status },
    ]),
  );
  return {
    opportunities: (opportunities ?? []) as OpportunityListRow[],
    applicationByOpportunity,
  };
}

export async function loadApplicationsWorkspace() {
  const { supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("applications")
    .select(
      "id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at, opportunities ( title, organization, category, source_url ), fit_evaluations ( score )",
    )
    .order("updated_at", { ascending: false });
  return { applications: (data ?? []) as ApplicationListRow[] };
}

export async function loadApplicationWorkspace(applicationId: string) {
  const { user, supabase } = await requireWorkspace();

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, status, deadline_at, next_action, submitted_at, persona, opportunity_id, created_at, updated_at",
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (!application) return null;

  const { data: opportunity } = await supabase
    .from("opportunities")
    .select(
      "id, title, organization, category, location, source, source_url, canonical_url, deadline_at, raw_excerpt, analysis_status",
    )
    .eq("id", application.opportunity_id)
    .maybeSingle();

  const [
    { data: requirements },
    { data: questions },
    { data: answers },
    { data: eligibility },
    { data: fit },
    { data: resumeMatches },
    { data: attached },
    { data: snapshots },
    { data: reviewItems },
    { data: evidence },
    { data: documents },
    { data: applicationEmailEvents },
    { data: applicationCalendarEvents },
  ] = await Promise.all([
        supabase.from("requirements").select("id, text, hard, kind").eq("opportunity_id", application.opportunity_id),
    supabase
      .from("application_questions")
      .select("id, prompt, limit_value, limit_unit, sort_order")
      .eq("application_id", applicationId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("answer_versions")
      .select("id, question_id, text, evidence_ids, missing_facts, warnings, approved, model, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("eligibility_results")
      .select("id, requirement_id, state, explanation, evidence_id, requirement_kind, display_state")
      .eq("application_id", applicationId),
    supabase
      .from("fit_evaluations")
      .select(
        "score, skills_match, experience_match, education_match, project_relevance, eligibility, missing, strengths, explanation, should_apply, factors",
      )
      .eq("application_id", applicationId)
      .maybeSingle(),
    supabase
      .from("resume_matches")
      .select("id, document_id, document_version_id, score, suggestion, track, explanation, recommended")
      .eq("application_id", applicationId)
      .order("score", { ascending: false }),
    supabase
      .from("application_documents")
      .select("id, document_id, document_version_id")
      .eq("application_id", applicationId),
    supabase
      .from("submission_snapshots")
      .select("id, submitted_at, answer_manifest, document_manifest, opportunity_snapshot, evidence_manifest, field_manifest, idempotency_key, guard_result")
      .eq("application_id", applicationId)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("review_items")
      .select("id, kind, prompt, resolved")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("evidence_items")
      .select(
        "id, title, kind, organization, situation, action, outcome, skills, source, verification_status, excluded_from_ai, created_at",
      )
      .eq("user_id", user.id),
    supabase
      .from("documents")
      .select(
        "id, type, label, current_version_id, document_versions ( id, version_label, status, created_at, original_filename )",
      )
      .eq("user_id", user.id),
    supabase
      .from("email_events")
      .select("id, event_kind, subject, sender_domain, occurred_at, association_confidence, interview_detected, user_corrected, calendar_event_id")
      .eq("application_id", applicationId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at, location, meeting_url, timezone, confirmed, notes")
      .eq("application_id", applicationId)
      .order("starts_at", { ascending: true }),
  ]);

  const answersByQuestion = new Map<string, NonNullable<typeof answers>>();
  for (const answer of answers ?? []) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }

  return {
    application,
    opportunity,
    requirements: requirements ?? [],
    questions: (questions ?? []).map((question) => ({
      ...question,
      versions: answersByQuestion.get(question.id) ?? [],
      approved: (answersByQuestion.get(question.id) ?? []).find((item) => item.approved) ?? null,
    })),
    eligibility: eligibility ?? [],
    fit,
    resumeMatches: resumeMatches ?? [],
    attached: attached ?? [],
    snapshots: snapshots ?? [],
    reviewItems: reviewItems ?? [],
    evidence: ((evidence ?? []) as EvidenceRow[]).map(mapEvidence),
    evidenceRows: (evidence ?? []) as EvidenceRow[],
    documents: documents ?? [],
    emailEvents: (applicationEmailEvents ?? []) as Array<{
      id: string;
      event_kind: string;
      subject: string | null;
      sender_domain: string | null;
      occurred_at: string;
      association_confidence: number | null;
      interview_detected: boolean;
      user_corrected: boolean;
      calendar_event_id: string | null;
    }>,
    calendarEvents: (applicationCalendarEvents ?? []) as Array<{
      id: string;
      title: string;
      starts_at: string;
      ends_at: string | null;
      location: string | null;
      meeting_url: string | null;
      timezone: string | null;
      confirmed: boolean;
      notes: string | null;
    }>,
  };
}

export { asOne };

export async function loadNotificationsWorkspace() {
  const { supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, read_at, created_at, application_id")
    .order("created_at", { ascending: false })
    .limit(50);
  return { notifications: (data ?? []) as NotificationRow[] };
}

export async function loadIntegrationsWorkspace() {
  const { supabase } = await requireWorkspace();
  const [{ data: integrations }, { data: emailEvents }, { data: calendarEvents }] = await Promise.all([
    supabase
      .from("integrations")
      .select("id, provider, kind, status, account_label, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("email_events")
      .select("id, event_kind, subject, from_address, sender_domain, occurred_at, application_id, association_confidence, interview_detected, user_corrected, calendar_event_id")
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("calendar_events")
      .select("id, title, starts_at, ends_at, location, meeting_url, timezone, confirmed, application_id, email_event_id, notes")
      .order("starts_at", { ascending: true })
      .limit(20),
  ]);

  return {
    integrations: (integrations ?? []) as Array<{
      id: string;
      provider: string;
      kind: string;
      status: string;
      account_label: string | null;
      created_at: string;
    }>,
    emailEvents: (emailEvents ?? []) as Array<{
      id: string;
      event_kind: string;
      subject: string | null;
      from_address: string | null;
      sender_domain: string | null;
      occurred_at: string;
      application_id: string | null;
      association_confidence: number | null;
      interview_detected: boolean;
      user_corrected: boolean;
      calendar_event_id: string | null;
    }>,
    calendarEvents: (calendarEvents ?? []) as Array<{
      id: string;
      title: string;
      starts_at: string;
      ends_at: string | null;
      location: string | null;
      meeting_url: string | null;
      timezone: string | null;
      confirmed: boolean;
      application_id: string | null;
      email_event_id: string | null;
      notes: string | null;
    }>,
  };
}
