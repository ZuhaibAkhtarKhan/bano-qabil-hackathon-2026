import type { FormPageCapture } from "@1apply/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import type { Actor } from "@/auth/actor";
import { logError } from "@/lib/log";
import { fillFormPageFromJson } from "@/server/extension/form-fill-from-json";
import { persistFormPageCapture } from "@/server/extension/persist-form-page-capture";

/** Store page JSON at save time; optionally pre-resolve fill plan in the background. */
export async function ingestFormPageCapture(input: {
  supabase: SupabaseClient;
  actor: Actor;
  userId: string;
  applicationId: string;
  opportunityId: string;
  formPage: FormPageCapture;
  prefill?: boolean;
}) {
  const count = await persistFormPageCapture(
    input.supabase,
    input.userId,
    input.applicationId,
    input.opportunityId,
    input.formPage,
  );
  if (!input.prefill || count === 0) return;

  after(async () => {
    try {
      await fillFormPageFromJson({
        supabase: input.supabase,
        actor: input.actor,
        applicationId: input.applicationId,
        page: input.formPage,
      });
    } catch (error) {
      logError("fill.form_page_prefill_failed", {
        applicationId: input.applicationId,
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  });
}
