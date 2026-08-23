"use server";

import { revalidatePath } from "next/cache";

import { z } from "zod";

import { requireWorkspace } from "@/server/auth/require-workspace";
import { logError } from "@/lib/log";
import { emitDomainEvent } from "@/server/notifications/service";
import { generateAnswer } from "./generate";

function revalidateApplication(id: string) {
  revalidatePath("/app");
  revalidatePath("/app/applications");
  revalidatePath(`/app/applications/${id}`);
}

// ─── Generate / regenerate ────────────────────────────────────────────────────

const generateInput = z.object({
  applicationId: z.string().uuid(),
  questionId: z.string().uuid(),
  intent: z.enum(["draft", "shorten", "expand", "adjust_tone"]).default("draft"),
  tone: z.enum(["formal", "enthusiastic", "concise", "detailed"]).default("formal"),
  previousAnswerId: z.string().uuid().nullable().optional(),
  previousAnswerText: z.string().nullable().optional(),
  previousGenerationCount: z.number().int().nonnegative().optional(),
});

export async function generateAnswerAction(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const parsed = generateInput.safeParse({
    applicationId: formData.get("applicationId"),
    questionId: formData.get("questionId"),
    intent: formData.get("intent") ?? "draft",
    tone: formData.get("tone") ?? "formal",
    previousAnswerId: formData.get("previousAnswerId") ?? null,
    previousAnswerText: formData.get("previousAnswerText") ?? null,
    previousGenerationCount: formData.get("previousGenerationCount")
      ? Number(formData.get("previousGenerationCount"))
      : 0,
  });

  if (!parsed.success) {
    return { error: "INVALID_INPUT" as const, result: null };
  }

  try {
    const result = await generateAnswer(supabase, actor, parsed.data);
    await emitDomainEvent(supabase, {
      name: result.state === "needs_review" || result.warnings.includes("INSUFFICIENT_EVIDENCE") ? "answer.needs_review" : "answer.generated",
      userId: actor.userId,
      applicationId: parsed.data.applicationId,
      subjectId: result.answerId,
      title: result.state === "needs_review" ? "Answer needs review" : "Answer draft ready",
      body:
        result.state === "needs_review"
          ? "A draft was stored but needs your review before it can be used in a snapshot."
          : "A grounded draft is ready. Review citations, then approve it.",
    });
    revalidateApplication(parsed.data.applicationId);
    return { error: null, result };
  } catch (err) {
    logError("answer.generate_action_failed", { err });
    const message = err instanceof Error ? err.message : "UNKNOWN";
    return { error: message as string, result: null };
  }
}

// ─── Edit (user writes their own text) ───────────────────────────────────────

export async function editAnswerAction(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const answerId = String(formData.get("answerId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "");
  const text = String(formData.get("text") ?? "");

  if (!answerId || !applicationId) {
    return { error: "INVALID_INPUT" as const };
  }

  // Verify ownership
  const { data: answer } = await supabase
    .from("application_answers")
    .select("id, user_id, question_id, evidence_ids")
    .eq("id", answerId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!answer) return { error: "NOT_FOUND" as const };

  await supabase
    .from("application_answers")
    .update({
      user_edited_text: text,
      state: "user_edited",
    })
    .eq("id", answerId);

  revalidateApplication(applicationId);
  return { error: null };
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveAnswerAction(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const answerId = String(formData.get("answerId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "");

  if (!answerId || !applicationId) return { error: "INVALID_INPUT" as const };

  const { data: answer } = await supabase
    .from("application_answers")
    .select("id, user_id, user_edited_text, original_ai_text")
    .eq("id", answerId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!answer) return { error: "NOT_FOUND" as const };

  const approvedText =
    (answer.user_edited_text as string | null) ?? (answer.original_ai_text as string | null) ?? "";

  await supabase
    .from("application_answers")
    .update({
      state: "approved",
      approved_text: approvedText,
    })
    .eq("id", answerId);

  await emitDomainEvent(supabase, {
    name: "answer.approved",
    userId: actor.userId,
    applicationId,
    subjectId: answerId,
    title: "Answer approved",
    body: "Approved text can now enter a submission snapshot.",
  });

  revalidateApplication(applicationId);
  return { error: null };
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectAnswerAction(formData: FormData) {
  const { supabase, actor } = await requireWorkspace();
  const answerId = String(formData.get("answerId") ?? "");
  const applicationId = String(formData.get("applicationId") ?? "");

  if (!answerId || !applicationId) return { error: "INVALID_INPUT" as const };

  const { data: answer } = await supabase
    .from("application_answers")
    .select("id, user_id")
    .eq("id", answerId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!answer) return { error: "NOT_FOUND" as const };

  await supabase
    .from("application_answers")
    .update({ state: "rejected" })
    .eq("id", answerId);

  revalidateApplication(applicationId);
  return { error: null };
}
