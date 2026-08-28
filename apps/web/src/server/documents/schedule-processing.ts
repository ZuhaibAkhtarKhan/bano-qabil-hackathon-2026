import { after } from "next/server";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { loadAppConfig } from "@/config/env";
import { runOwnedJob } from "@/infra/jobs/runner";
import { uploadProcessingNotice } from "@/lib/document-upload-options";
import { logError } from "@/lib/log";
import { autoAttachKitAcrossOpenApplications } from "@/server/applications/attach-kit";
import { refreshOpenApplicationsFromKit } from "@/server/applications/refresh-from-kit";
import { FLASH } from "@/server/http/flash";
import { reindexUserRetrievalCorpus } from "@/services/embeddings";

import { assertOwnedVersion, processDocumentVersion } from "./service";

async function downloadDocumentVersionBuffer(supabase: SupabaseClient, storagePath: string): Promise<Buffer> {
  const bucket = loadAppConfig().storageBucket;
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error("STORAGE_DOWNLOAD_FAILED");
  return Buffer.from(await data.arrayBuffer());
}

async function notifyDocumentProcessingComplete(
  supabase: SupabaseClient,
  userId: string,
  versionId: string,
  result: { textExtracted: boolean; kitFilled: boolean; remainingBlanks: number; fieldsWritten: number },
) {
  const noticeCode = uploadProcessingNotice({
    useInKit: true,
    textExtracted: result.textExtracted,
    kitFilled: result.fieldsWritten > 0,
    remainingBlanks: result.remainingBlanks,
    fieldsWritten: result.fieldsWritten,
  });
  const title =
    noticeCode === "kit_updated"
      ? "Your kit was updated"
      : noticeCode === "kit_updated_partial"
        ? "Your kit was partially updated"
        : noticeCode === "kit_fill_failed"
          ? "Kit auto-fill needs attention"
          : "Document processed";

  await supabase.from("notifications").insert({
    user_id: userId,
    title,
    body: FLASH[noticeCode],
    category: noticeCode,
    action_url: "/app/memory",
    event_name: "document.processed",
    channel: "in_app",
    idempotency_key: `document-process:${versionId}`,
  });
}

/** Store first, return to the client quickly, then extract + kit-fill in the background. */
export function scheduleDocumentVersionProcessing(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  documentId: string;
  versionId: string;
  documentLabel: string;
  profileDisplayName: string | null;
  fillKit: boolean;
  postProcess?: () => Promise<void>;
}) {
  if (!input.fillKit) {
    void input.supabase.from("document_versions").update({ status: "ready" }).eq("id", input.versionId);
    return;
  }

  after(async () => {
    try {
      const version = await assertOwnedVersion(input.supabase, input.actor, input.versionId);
      let processResult = {
        textExtracted: false,
        kitFilled: false,
        remainingBlanks: 0,
        fieldsWritten: 0,
      };

      await runOwnedJob(
        input.supabase,
        { actor: input.actor, type: "document_extract", inputRef: input.versionId },
        async () => {
          const buffer = await downloadDocumentVersionBuffer(input.supabase, version.storage_path);
          const result = await processDocumentVersion({
            supabase: input.supabase,
            userId: input.userId,
            documentId: input.documentId,
            versionId: input.versionId,
            documentLabel: input.documentLabel,
            profileDisplayName: input.profileDisplayName,
            buffer,
            mimeType: version.mime_type,
            fillKit: true,
          });
          processResult = {
            textExtracted: result.textExtracted,
            kitFilled: result.kitFilled,
            remainingBlanks: result.remainingBlanks,
            fieldsWritten: result.fieldsWritten,
          };
        },
      );

      await runOwnedJob(
        input.supabase,
        { actor: input.actor, type: "embedding_index", inputRef: input.versionId },
        async () => {
          await reindexUserRetrievalCorpus(input.supabase, input.userId);
        },
      );

      await notifyDocumentProcessingComplete(input.supabase, input.userId, input.versionId, processResult);
      // Kit may have new facts — rematch Needs You / open applications from Your kit.
      if (processResult.fieldsWritten > 0 || processResult.kitFilled) {
        await refreshOpenApplicationsFromKit(input.supabase, input.actor);
      } else {
        await autoAttachKitAcrossOpenApplications(input.supabase, input.actor);
      }
      await input.postProcess?.();
    } catch (error) {
      logError("documents.background_process_failed", {
        versionId: input.versionId,
        error: String(error),
      });
      await input.supabase.from("document_versions").update({ status: "ready" }).eq("id", input.versionId);
    }
  });
}
