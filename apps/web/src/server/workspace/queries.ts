import { computeProfileCompleteness } from "@1apply/contracts";
import {
  classifyPendingPacket,
  computeDeadlineInfo,
  currentGuideStep,
  kitStatus,
  nextGuideSteps,
  packetAnswerText,
  packetSummary,
  requiredDocumentCovered,
} from "@1apply/domain";

import { logError } from "@/lib/log";
import { requireWorkspace } from "@/server/auth/require-workspace";
import { ensureApplicationResumeSelection } from "@/server/intelligence/auto-resume";
import { mapEvidence } from "@/server/memory/map-evidence";
import { syncDeadlineReminders } from "@/server/applications/reminders";
import { loadNeedsYouFieldCounts } from "@/server/needs-you/queries";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import type { PendingPacket } from "@/lib/dashboard";
import {
  asOne,
  type ApplicationListRow,
  type DocumentListRow,
  type EvidenceRow,
  type NotificationRow,
  type OpportunityListRow,
} from "@/server/types";

export async function loadDashboard() {
  const { profile, supabase, actor } = await requireWorkspace();

  const [
    { count: verifiedEvidenceCount },
    { count: documentCount },
    { data: notifications },
    { data: opportunities },
    { count: resumeCount },
    { data: kitDocuments },
  ] = await Promise.all([
    supabase
      .from("evidence_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("verification_status", "verified")
      .eq("excluded_from_ai", false),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
    supabase
      .from("notifications")
      .select("id, title, body, read_at, created_at, application_id, opportunity_id, category, priority, action_url")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("opportunities")
      .select(
        "id, title, organization, category, source, source_url, location, analysis_status, deadline_at, created_at, canonical_url",
      )
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("type", "resume").eq("user_id", profile.id),
    supabase.from("documents").select("id, type, label").eq("user_id", profile.id),
    syncDeadlineReminders(supabase, actor).catch(() => null),
  ]);

  // Match the extension applications API shape first — nested fit_evaluations has
  // broken this query for some rows and returned an empty list.
  let applicationRows: ApplicationListRow[] = [];
  const primaryApps = await supabase
    .from("applications")
    .select(
      "id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at, opportunities ( title, organization, category, source, source_url, canonical_url )",
    )
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (primaryApps.error) {
    logError("dashboard.applications_list_failed", {
      code: primaryApps.error.code,
      message: primaryApps.error.message,
    });
    const fallbackApps = await supabase
      .from("applications")
      .select("id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at")
      .eq("user_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(100);
    applicationRows = (fallbackApps.data ?? []).map((row) => ({
      ...(row as Omit<ApplicationListRow, "opportunities" | "fit_evaluations">),
      opportunities: null,
      fit_evaluations: null,
    }));
  } else {
    applicationRows = (primaryApps.data ?? []) as ApplicationListRow[];
  }

  // Do not auto-create applications for orphan opportunities here. Ingest already
  // calls ensureApplication; recreating on dashboard load resurrects user deletes.
  const opportunityList = (opportunities ?? []) as OpportunityListRow[];

  const applicationIds = applicationRows.map((row) => row.id);
  const opportunityIds = [
    ...new Set(applicationRows.map((row) => row.opportunity_id).filter((id): id is string => Boolean(id))),
  ];
  const fitByApplication = new Map<string, number>();
  const requiredDocsByOpportunity = new Map<string, string[]>();
  const attachedLabelsByApplication = new Map<string, string[]>();

  if (applicationIds.length > 0) {
    const [{ data: fits }, { data: requiredDocs }, { data: attachedRows }, { data: userDocuments }] = await Promise.all([
      supabase
        .from("fit_evaluations")
        .select("application_id, score")
        .eq("user_id", profile.id)
        .in("application_id", applicationIds),
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_documents")
            .select("opportunity_id, label, required")
            .eq("user_id", profile.id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [] as Array<{ opportunity_id: string; label: string; required: boolean }> }),
      supabase
        .from("application_documents")
        .select("application_id, document_id")
        .eq("user_id", profile.id)
        .in("application_id", applicationIds),
      supabase.from("documents").select("id, label, type").eq("user_id", profile.id),
    ]);

    for (const row of fits ?? []) {
      if (typeof row.score === "number" && typeof row.application_id === "string") {
        fitByApplication.set(row.application_id, row.score);
      }
    }

    for (const row of requiredDocs ?? []) {
      if (!row.required) continue;
      const list = requiredDocsByOpportunity.get(String(row.opportunity_id)) ?? [];
      list.push(String(row.label));
      requiredDocsByOpportunity.set(String(row.opportunity_id), list);
    }

    const docMeta = new Map(
      (userDocuments ?? []).map((doc) => [
        String(doc.id),
        { label: String(doc.label ?? ""), type: String(doc.type ?? "") },
      ]),
    );

    for (const row of attachedRows ?? []) {
      const meta = docMeta.get(String(row.document_id));
      if (!meta) continue;
      const labels = attachedLabelsByApplication.get(String(row.application_id)) ?? [];
      // Prefer the vault label; also surface type so resume-typed docs count even if mislabeled.
      labels.push(meta.label || meta.type);
      if (meta.type === "resume" && !/\bresume\b|\bcv\b/i.test(meta.label)) {
        labels.push("resume");
      }
      attachedLabelsByApplication.set(String(row.application_id), labels);
    }
  }

  const applications = applicationRows.map((row) => {
    const opportunity =
      asOne(row.opportunities) ??
      opportunityList.find((item) => item.id === row.opportunity_id) ??
      null;
    const score = fitByApplication.get(row.id);
    return {
      ...row,
      opportunities: opportunity
        ? {
            title: opportunity.title,
            organization: opportunity.organization,
            category: opportunity.category,
            source: "source" in opportunity ? (opportunity.source as string | null) : null,
            source_url: opportunity.source_url,
            canonical_url:
              "canonical_url" in opportunity
                ? ((opportunity as { canonical_url?: string | null }).canonical_url ?? null)
                : null,
          }
        : row.opportunities,
      fit_evaluations: score != null ? { score } : null,
      requiredDocumentLabels: requiredDocsByOpportunity.get(row.opportunity_id) ?? [],
      attachedDocumentLabels: attachedLabelsByApplication.get(row.id) ?? [],
    };
  });

  const completeness = computeProfileCompleteness({
    displayName: profile.display_name,
    hasConsent: Boolean(profile.terms_accepted_at && profile.ai_processing_accepted_at),
    verifiedEvidenceCount: verifiedEvidenceCount ?? 0,
    documentCount: documentCount ?? 0,
  });
  const prefs = parseWorkspacePreferences(profile.preferences);
  const kit = kitStatus({
    displayName: profile.display_name,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: (kitDocuments ?? []).map((row) => ({ type: String(row.type), label: String(row.label) })),
  });
  const packets = await loadDashboardPackets(
    supabase,
    (applications ?? []) as ApplicationListRow[],
    kitDocuments ?? [],
    prefs.prepareAndSendIfSilent,
    Boolean(profile.display_name?.trim()),
    profile.timezone,
  );

  return {
    profile,
    completeness,
    verifiedEvidenceCount: verifiedEvidenceCount ?? 0,
    documentCount: documentCount ?? 0,
    applications,
    notifications: (notifications ?? []) as NotificationRow[],
    opportunities: opportunityList,
    resumeCount: resumeCount ?? 0,
    kit,
    packets,
    prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
    guideDismissed: prefs.guideDismissed,
  };
}

export async function loadWorkspaceGuide() {
  const { profile, supabase } = await requireWorkspace();
  const prefs = parseWorkspacePreferences(profile.preferences);
  if (prefs.guideDismissed) {
    return { dismissed: true as const, steps: [], next: null };
  }

  const [{ data: kitDocuments }, { count: opportunityCount }, { count: applicationCount }, needsYouCounts] =
    await Promise.all([
      supabase.from("documents").select("type, label").eq("user_id", profile.id),
      supabase.from("opportunities").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
      supabase.from("applications").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
      loadNeedsYouFieldCounts(),
    ]);

  const kit = kitStatus({
    displayName: profile.display_name,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: (kitDocuments ?? []).map((row) => ({ type: String(row.type), label: String(row.label) })),
  });
  const steps = nextGuideSteps({
    kitMissing: kit.missing,
    opportunityCount: opportunityCount ?? 0,
    applicationCount: applicationCount ?? 0,
    needsYouCount: needsYouCounts.applicationCount,
    prepareAndSendIfSilent: prefs.prepareAndSendIfSilent,
  });

  return {
    dismissed: false as const,
    steps,
    next: currentGuideStep(steps),
  };
}

async function loadDashboardPackets(
  supabase: Awaited<ReturnType<typeof requireWorkspace>>["supabase"],
  applications: ApplicationListRow[],
  documents: Array<{ id: string; type: string; label: string }>,
  prepareAndSendIfSilent: boolean,
  identityPresent: boolean,
  timezone: string | null,
): Promise<PendingPacket[]> {
  const open = applications.filter(
    (row) => !["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"].includes(row.status),
  );
  if (open.length === 0) return [];
  const applicationIds = open.map((row) => row.id);
  const opportunityIds = [...new Set(open.map((row) => row.opportunity_id))];

  const [{ data: questions }, { data: answers }, { data: requiredDocs }, { data: attached }] = await Promise.all([
    supabase.from("opportunity_questions").select("id, opportunity_id").in("opportunity_id", opportunityIds),
    supabase
      .from("application_answers")
      .select("application_id, question_id, state, approved_text, original_ai_text, user_edited_text")
      .in("application_id", applicationIds),
    supabase.from("opportunity_documents").select("opportunity_id, label, required").in("opportunity_id", opportunityIds),
    supabase.from("application_documents").select("application_id, document_id").in("application_id", applicationIds),
  ]);

  const docById = new Map(documents.map((row) => [row.id, row]));

  return open.map((row) => {
    const oppQuestions = (questions ?? []).filter((item) => item.opportunity_id === row.opportunity_id);
    const appAnswers = (answers ?? []).filter((item) => item.application_id === row.id);
    const required = (requiredDocs ?? []).filter((item) => item.opportunity_id === row.opportunity_id && item.required);
    const attachedIds = new Set(
      (attached ?? []).filter((item) => item.application_id === row.id).map((item) => String(item.document_id)),
    );
    const attachedVault = [...attachedIds]
      .map((id) => docById.get(id))
      .filter((item): item is { id: string; type: string; label: string } => Boolean(item))
      .map((item) => ({ type: item.type, label: item.label }));
    const missingDocs = required
      .filter((item) => !requiredDocumentCovered(String(item.label), attachedVault))
      .map((item) => String(item.label));
    const packetCount = oppQuestions.filter((question) =>
      appAnswers.some(
        (answer) =>
          String(answer.question_id) === String(question.id) &&
          packetAnswerText({
            approvedText: (answer.approved_text as string | null) ?? null,
            userEditedText: (answer.user_edited_text as string | null) ?? null,
            originalAiText: (answer.original_ai_text as string | null) ?? null,
          }),
      ),
    ).length;
    const suggestionCount = appAnswers.filter((item) => item.state === "ai_generated" || item.state === "user_edited").length;
    const summary = packetSummary({
      attachedCount: attachedIds.size,
      requiredCount: required.length,
      questionCount: oppQuestions.length,
      packetAnswerCount: packetCount,
      suggestionCount,
    });
    const lane = classifyPendingPacket({
      status: row.status,
      deadlineAt: row.deadline_at,
      hasCaptcha: false,
      hasSignature: false,
      hasPayment: false,
      identityPresent,
      missingRequiredDocuments: missingDocs,
      questionsWithoutPacketText: Math.max(0, oppQuestions.length - packetCount),
      suggestionCount,
      prepareAndSendIfSilent,
    });
    const deadline = computeDeadlineInfo(row.deadline_at, timezone);
    return {
      id: row.id,
      title: asOne(row.opportunities)?.title ?? "Untitled opportunity",
      host: asOne(row.opportunities)?.organization ?? "Unknown host",
      deadlineAt: row.deadline_at,
      deadlineLabel: deadline.label,
      lane,
      summary,
      suggestionCount,
      missingDocs,
    };
  });
}


export async function loadDocumentsWorkspace() {
  const { profile, supabase } = await requireWorkspace();
  const { data, error } = await supabase
    .from("documents")
    .select(
      "id, type, label, current_version_id, created_at, document_versions!document_id ( id, version_label, mime_type, byte_size, status, original_filename, created_at )",
    )
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  if (error) {
    logError("documents.list_failed", { code: error.code, message: error.message });
  }
  return { documents: (data ?? []) as DocumentListRow[] };
}

export async function loadOpportunitiesWorkspace() {
  const { profile, supabase } = await requireWorkspace();
  const { data: opportunities } = await supabase
    .from("opportunities")
    .select(
      "id, title, organization, category, source, source_url, location, analysis_status, deadline_at, created_at",
    )
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });
  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("user_id", profile.id);
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
  const { profile, supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("applications")
    .select(
      "id, opportunity_id, status, deadline_at, next_action, submitted_at, updated_at, opportunities ( title, organization, category, source, source_url, canonical_url ), fit_evaluations ( score )",
    )
    .eq("user_id", profile.id)
    .order("updated_at", { ascending: false });

  const applicationRows = (data ?? []) as ApplicationListRow[];
  const applicationIds = applicationRows.map((row) => row.id);
  const opportunityIds = [
    ...new Set(applicationRows.map((row) => row.opportunity_id).filter((id): id is string => Boolean(id))),
  ];
  const requiredDocsByOpportunity = new Map<string, string[]>();
  const attachedLabelsByApplication = new Map<string, string[]>();

  if (applicationIds.length > 0) {
    const [{ data: requiredDocs }, { data: attachedRows }, { data: userDocuments }] = await Promise.all([
      opportunityIds.length > 0
        ? supabase
            .from("opportunity_documents")
            .select("opportunity_id, label, required")
            .eq("user_id", profile.id)
            .in("opportunity_id", opportunityIds)
        : Promise.resolve({ data: [] as Array<{ opportunity_id: string; label: string; required: boolean }> }),
      supabase
        .from("application_documents")
        .select("application_id, document_id")
        .eq("user_id", profile.id)
        .in("application_id", applicationIds),
      supabase.from("documents").select("id, label, type").eq("user_id", profile.id),
    ]);

    for (const row of requiredDocs ?? []) {
      if (!row.required) continue;
      const list = requiredDocsByOpportunity.get(String(row.opportunity_id)) ?? [];
      list.push(String(row.label));
      requiredDocsByOpportunity.set(String(row.opportunity_id), list);
    }

    const docMeta = new Map(
      (userDocuments ?? []).map((doc) => [
        String(doc.id),
        { label: String(doc.label ?? ""), type: String(doc.type ?? "") },
      ]),
    );

    for (const row of attachedRows ?? []) {
      const meta = docMeta.get(String(row.document_id));
      if (!meta) continue;
      const labels = attachedLabelsByApplication.get(String(row.application_id)) ?? [];
      labels.push(meta.label || meta.type);
      if (meta.type === "resume" && !/\bresume\b|\bcv\b/i.test(meta.label)) {
        labels.push("resume");
      }
      attachedLabelsByApplication.set(String(row.application_id), labels);
    }
  }

  return {
    applications: applicationRows.map((row) => ({
      ...row,
      requiredDocumentLabels: requiredDocsByOpportunity.get(row.opportunity_id) ?? [],
      attachedDocumentLabels: attachedLabelsByApplication.get(row.id) ?? [],
    })),
  };
}

export async function loadApplicationWorkspace(applicationId: string) {
  const { user, supabase, actor } = await requireWorkspace();

  // Auto-pick resume category / AI fallback before rendering submission checklist.
  try {
    await ensureApplicationResumeSelection(supabase, actor, applicationId, {
      autoAttach: true,
      notifyOnAiPick: true,
    });
  } catch {
    // Non-blocking — workspace still loads if selection fails.
  }

  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, status, deadline_at, deadline_timezone, next_action, submitted_at, persona, opportunity_id, created_at, updated_at",
    )
    .eq("id", applicationId)
    .eq("user_id", user.id)
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
    { data: requiredDocuments },
    { data: attached },
    { data: snapshots },
    { data: reviewItems },
    { data: fieldMappings },
    { data: fillSessions },
    { data: statusHistory },
    { data: events },
    { data: evidence },
    { data: documents },
    { data: applicationEmailEvents },
    { data: applicationCalendarEvents },
  ] = await Promise.all([
        supabase.from("requirements").select("id, text, hard, kind").eq("opportunity_id", application.opportunity_id),
    supabase
      .from("opportunity_questions")
      .select("id, prompt, limit_value, limit_unit, required, sort_order")
      .eq("opportunity_id", application.opportunity_id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("application_answers")
      .select(
        "id, question_id, state, original_ai_text, user_edited_text, approved_text, evidence_ids, claim_flags, missing_facts, warnings, grounding_score, generation_count, model, created_at",
      )
      .eq("application_id", applicationId),
    supabase
      .from("eligibility_results")
      .select("id, requirement_id, state, explanation, evidence_id, requirement_text, requirement_kind, display_state, needs_confirmation")
      .eq("application_id", applicationId),
    supabase
      .from("fit_evaluations")
      .select(
        "score, skills_match, experience_match, education_match, project_relevance, eligibility, missing, strengths, explanation, rationale, should_apply, factors, weights",
      )
      .eq("application_id", applicationId)
      .maybeSingle(),
    supabase
      .from("resume_matches")
      .select("id, document_id, document_version_id, score, suggestion, track, explanation, recommended, label, focus, strengths, gaps")
      .eq("application_id", applicationId)
      .order("score", { ascending: false }),
    supabase
      .from("opportunity_documents")
      .select("id, label, required")
      .eq("opportunity_id", application.opportunity_id),
    supabase
      .from("application_documents")
      .select("id, document_id, document_version_id")
      .eq("application_id", applicationId),
    supabase
      .from("submission_snapshots")
      .select("id, submitted_at, answer_manifest, document_manifest, opportunity_snapshot, evidence_manifest, field_manifest, application_status, deadline_at, idempotency_key, guard_result")
      .eq("application_id", applicationId)
      .order("submitted_at", { ascending: false }),
    supabase
      .from("review_items")
      .select("id, kind, prompt, resolved")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("field_mappings")
      .select("id, field_key, label, value, source, confidence, excluded_by_default, sensitive, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("fill_sessions")
      .select("id, origin, expires_at, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("application_status_history")
      .select("id, from_status, to_status, created_at")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("application_events")
      .select("id, event_name, payload, created_at")
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
        "id, type, label, current_version_id, document_versions!document_id ( id, version_label, status, created_at, original_filename )",
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

  type AnswerRow = {
    id: unknown; question_id: unknown; state: unknown; original_ai_text: unknown;
    user_edited_text: unknown; approved_text: unknown; evidence_ids: unknown;
    claim_flags: unknown; missing_facts: unknown; warnings: unknown;
    grounding_score: unknown; generation_count: unknown; model: unknown; created_at: unknown;
  };
  const answerByQuestion = new Map<string, AnswerRow>();
  for (const answer of (answers ?? []) as AnswerRow[]) {
    const qid = answer.question_id as string;
    const existing = answerByQuestion.get(qid);
    if (!existing || (answer.created_at as string) > (existing.created_at as string)) {
      answerByQuestion.set(qid, answer);
    }
  }

  const { data: previousAnswerRows } = await supabase
    .from("application_answers")
    .select("id, application_id, question_id, approved_text")
    .eq("user_id", user.id)
    .eq("state", "approved")
    .neq("application_id", applicationId)
    .not("approved_text", "is", null)
    .limit(40);
  const previousQuestionIds = [...new Set((previousAnswerRows ?? []).map((row) => String(row.question_id)))];
  const { data: previousPrompts } =
    previousQuestionIds.length > 0
      ? await supabase.from("opportunity_questions").select("id, prompt").in("id", previousQuestionIds)
      : { data: [] as Array<{ id: string; prompt: string }> };
  const previousPromptById = new Map((previousPrompts ?? []).map((row) => [String(row.id), String(row.prompt)]));
  const previousAnswers = (previousAnswerRows ?? []).map((row) => ({
    id: String(row.id),
    applicationId: String(row.application_id),
    questionId: String(row.question_id),
    prompt: previousPromptById.get(String(row.question_id)) ?? "",
    text: String(row.approved_text ?? ""),
  }));

  return {
    application,
    opportunity,
    requirements: requirements ?? [],
    questions: (questions ?? []).map((question) => ({
      id: question.id as string,
      prompt: question.prompt as string,
      limitValue: (question.limit_value as number | null) ?? null,
      limitUnit: (question.limit_unit as string | null) ?? null,
      required: Boolean(question.required),
      answer: answerByQuestion.get(question.id as string) ?? null,
    })),
    eligibility: eligibility ?? [],
    fit,
    resumeMatches: resumeMatches ?? [],
    requiredDocuments: requiredDocuments ?? [],
    attached: attached ?? [],
    snapshots: snapshots ?? [],
    reviewItems: reviewItems ?? [],
    fieldMappings: fieldMappings ?? [],
    fillSessions: fillSessions ?? [],
    statusHistory: statusHistory ?? [],
    events: events ?? [],
    evidence: ((evidence ?? []) as EvidenceRow[]).map(mapEvidence),
    evidenceRows: (evidence ?? []) as EvidenceRow[],
    documents: documents ?? [],
    previousAnswers,
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

export async function loadNotificationsWorkspace() {
  const { supabase } = await requireWorkspace();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, read_at, created_at, application_id, opportunity_id, category, priority, action_url")
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
