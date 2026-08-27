import {
  buildAutoResumeSelection,
  computeDeadlineInfo,
  isWeakResumeFit,
  type CategorizedResume,
} from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { loadIntelligenceContext, persistResumeMatches } from "@/server/intelligence/evaluate";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

export type EnsureResumeSelectionResult = {
  ran: boolean;
  attached: boolean;
  strategy: string | null;
  documentId: string | null;
  notified: boolean;
  weakFit: boolean;
};

async function attachResume(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  documentId: string,
  versionId: string,
  reason: string,
) {
  await supabase
    .from("application_documents")
    .delete()
    .eq("application_id", applicationId)
    .eq("document_id", documentId);

  await supabase.from("application_documents").insert({
    user_id: actor.userId,
    application_id: applicationId,
    document_id: documentId,
    document_version_id: versionId,
  });

  await recordApplicationEvent(supabase, actor, applicationId, "document.auto_attached", {
    documentId,
    versionId,
    reason,
  });
}

function deadlineForcesAttach(deadlineAt: string | null, timezone: string | null): boolean {
  const deadline = computeDeadlineInfo(deadlineAt, timezone);
  return (
    deadline.urgency === "imminent" ||
    deadline.urgency === "soon" ||
    deadline.urgency === "overdue"
  );
}

/**
 * Ensures resume_matches has a recommendation and optionally attaches the latest
 * category version to the application.
 *
 * Strong fits attach immediately. Weak fits stay for Need You approval unless a
 * deadline is approaching (or deadlineAuto is set by the automation sweep).
 */
export async function ensureApplicationResumeSelection(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  options: {
    autoAttach?: boolean;
    notifyOnAiPick?: boolean;
    forceRefresh?: boolean;
    /** When true, attach even if user has not opened the workspace (deadline automation). */
    deadlineAuto?: boolean;
  } = {},
): Promise<EnsureResumeSelectionResult> {
  const { autoAttach = true, notifyOnAiPick = true, forceRefresh = false, deadlineAuto = false } = options;

  const { data: application } = await supabase
    .from("applications")
    .select("id, opportunity_id, status, deadline_at, deadline_timezone")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application?.opportunity_id) {
    return { ran: false, attached: false, strategy: null, documentId: null, notified: false, weakFit: false };
  }

  if (["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"].includes(String(application.status))) {
    return { ran: false, attached: false, strategy: null, documentId: null, notified: false, weakFit: false };
  }

  const deadlineAt = (application.deadline_at as string | null) ?? null;
  const deadlineTz = (application.deadline_timezone as string | null) ?? null;
  const forceByDeadline = deadlineAuto || deadlineForcesAttach(deadlineAt, deadlineTz);

  const [{ data: existingMatches }, { data: attached }] = await Promise.all([
    supabase
      .from("resume_matches")
      .select("document_id, document_version_id, recommended, score, suggestion")
      .eq("application_id", applicationId),
    supabase
      .from("application_documents")
      .select("document_id, document_version_id")
      .eq("application_id", applicationId),
  ]);

  const recommended = (existingMatches ?? []).find((row) => row.recommended);
  const hasResumeAttached = (attached ?? []).some((row) => {
    const docId = String(row.document_id);
    return (existingMatches ?? []).some((match) => String(match.document_id) === docId);
  });

  if (recommended && !forceRefresh) {
    const docId = String(recommended.document_id);
    const versionId = String(recommended.document_version_id);
    const score = typeof recommended.score === "number" ? recommended.score : Number(recommended.score ?? NaN);
    const weakFit = isWeakResumeFit(score) || Boolean(recommended.suggestion);
    const alreadyAttached = (attached ?? []).some(
      (row) => String(row.document_id) === docId && String(row.document_version_id) === versionId,
    );
    if (alreadyAttached || !autoAttach) {
      return {
        ran: false,
        attached: alreadyAttached,
        strategy: "existing",
        documentId: docId,
        notified: false,
        weakFit,
      };
    }
    if (weakFit && !forceByDeadline) {
      return {
        ran: false,
        attached: false,
        strategy: "existing_weak",
        documentId: docId,
        notified: false,
        weakFit: true,
      };
    }
    await attachResume(supabase, actor, applicationId, docId, versionId, "resume_recommendation_existing");
    return { ran: false, attached: true, strategy: "existing", documentId: docId, notified: false, weakFit };
  }

  const [{ data: opportunity }, { data: requirements }] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, title, organization, raw_excerpt, location, category")
      .eq("id", application.opportunity_id)
      .maybeSingle(),
    supabase.from("requirements").select("id, text, hard, kind").eq("opportunity_id", application.opportunity_id),
  ]);

  const requirementRows = (requirements ?? []).map((item) => ({
    id: item.id as string,
    text: item.text as string,
    hard: Boolean(item.hard),
    kind: (item.kind as string | null) ?? "general",
  }));

  const loaded = await loadIntelligenceContext(supabase, actor, opportunity, requirementRows);
  if (loaded.resumes.length === 0) {
    return { ran: true, attached: false, strategy: null, documentId: null, notified: false, weakFit: false };
  }

  const highlights = loaded.evidence
    .filter((item) => item.verificationStatus === "verified")
    .slice(0, 4)
    .map((item) => item.title);

  const { data: resumeMeta } = await supabase
    .from("resumes")
    .select("document_id, category_key, category_label")
    .eq("user_id", actor.userId);

  const metaByDoc = new Map(
    (resumeMeta ?? []).map((row) => [
      String(row.document_id),
      { categoryKey: row.category_key as string | null, categoryLabel: row.category_label as string | null },
    ]),
  );

  const categorized: CategorizedResume[] = loaded.resumes.map((resume) => ({
    ...resume,
    categoryKey: resume.categoryKey ?? metaByDoc.get(resume.documentId)?.categoryKey ?? null,
    categoryLabel: resume.categoryLabel ?? metaByDoc.get(resume.documentId)?.categoryLabel ?? resume.label,
  }));

  const selection = buildAutoResumeSelection(loaded.opportunityText, categorized, {
    memoryHighlights: highlights,
  });

  if (selection.ranked.length === 0) {
    return { ran: true, attached: false, strategy: null, documentId: null, notified: false, weakFit: false };
  }

  await persistResumeMatches(supabase, {
    userId: actor.userId,
    applicationId,
    resumes: selection.ranked,
  });

  const pick = selection.ranked.find((item) => item.recommended) ?? selection.ranked[0]!;
  const weakFit =
    isWeakResumeFit(pick.score) ||
    Boolean(pick.suggestion) ||
    (selection.strategy === "ai_rank" && isWeakResumeFit(pick.score));
  const strongFit =
    selection.strategy === "category_match" ||
    selection.strategy === "only_available" ||
    !weakFit;

  let attachedNow = hasResumeAttached;

  const shouldAutoAttach =
    autoAttach &&
    pick.documentId &&
    pick.documentVersionId &&
    (forceByDeadline || (strongFit && !hasResumeAttached));

  if (shouldAutoAttach) {
    await attachResume(
      supabase,
      actor,
      applicationId,
      pick.documentId,
      pick.documentVersionId,
      selection.strategy === "category_match"
        ? "resume_category_auto"
        : selection.strategy === "ai_rank"
          ? "resume_ai_auto"
          : "resume_only_available",
    );
    attachedNow = true;
  }

  let notified = false;
  if (notifyOnAiPick && selection.notifyUser && selection.notificationTitle && selection.notificationBody) {
    await emitDomainEvent(
      supabase,
      {
        name: "intelligence.updated",
        userId: actor.userId,
        applicationId,
        opportunityId: String(application.opportunity_id),
        subjectId: `${applicationId}:resume_auto_select`,
        title: selection.notificationTitle,
        body: selection.notificationBody,
        payload: { resumeStrategy: selection.strategy },
      },
      { recordTimeline: false },
    );
    notified = true;
  }

  return {
    ran: true,
    attached: attachedNow,
    strategy: selection.strategy,
    documentId: pick.documentId,
    notified,
    weakFit,
  };
}

/** Rank / attach resumes for every open application (Need You + kit refresh). */
export async function ensureOpenApplicationsResumeSelection(
  supabase: SupabaseClient,
  actor: Actor,
  applicationIds: string[],
): Promise<void> {
  for (const applicationId of applicationIds) {
    try {
      await ensureApplicationResumeSelection(supabase, actor, applicationId, {
        autoAttach: true,
        notifyOnAiPick: true,
      });
    } catch {
      // Non-blocking — Need You still loads if one app fails.
    }
  }
}
