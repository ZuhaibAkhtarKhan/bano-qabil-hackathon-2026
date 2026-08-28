import { planKitAttachments, type VaultDocument } from "@1apply/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordApplicationEvent } from "@/services/platform";
import type { Actor } from "@/auth/actor";

const CLOSED = new Set(["submitted", "rejected", "withdrawn", "archived", "offer", "accepted"]);

async function loadVault(supabase: SupabaseClient, userId: string): Promise<VaultDocument[]> {
  const { data } = await supabase
    .from("documents")
    .select("id, type, label, current_version_id")
    .eq("user_id", userId);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    label: String(row.label),
    currentVersionId: (row.current_version_id as string | null) ?? null,
  }));
}

export async function autoAttachMatchingDocuments(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  opportunityId: string,
) {
  const vault = await loadVault(supabase, actor.userId);
  const [{ data: required }, { data: attached }] = await Promise.all([
    supabase.from("opportunity_documents").select("label, required").eq("opportunity_id", opportunityId),
    supabase.from("application_documents").select("document_id").eq("application_id", applicationId),
  ]);
  const already = new Set((attached ?? []).map((row) => String(row.document_id)));
  const matches = planKitAttachments(
    (required ?? []).map((row) => ({ label: String(row.label), required: Boolean(row.required) })),
    vault,
    already,
  );

  for (const match of matches) {
    const versionId = match.document.currentVersionId;
    if (!versionId) continue;
    await supabase
      .from("application_documents")
      .delete()
      .eq("application_id", applicationId)
      .eq("document_id", match.document.id);
    await supabase.from("application_documents").insert({
      user_id: actor.userId,
      application_id: applicationId,
      document_id: match.document.id,
      document_version_id: versionId,
    });
    await recordApplicationEvent(supabase, actor, applicationId, "document.auto_attached", {
      documentId: match.document.id,
      versionId,
      requiredLabel: match.requiredLabel,
    });
  }

  return matches.length;
}

export async function autoAttachKitAcrossOpenApplications(supabase: SupabaseClient, actor: Actor) {
  const { data: applications } = await supabase
    .from("applications")
    .select("id, opportunity_id, status")
    .eq("user_id", actor.userId)
    .limit(40);

  let attached = 0;
  for (const application of applications ?? []) {
    if (CLOSED.has(String(application.status))) continue;
    attached += await autoAttachMatchingDocuments(
      supabase,
      actor,
      String(application.id),
      String(application.opportunity_id),
    );
  }
  return attached;
}
