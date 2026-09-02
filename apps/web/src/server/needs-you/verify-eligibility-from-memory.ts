import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { tryGetAiProvider } from "@/infra/ai/openai";
import { logError } from "@/lib/log";
import type { EligibilityGap } from "@/server/needs-you/resolve-eligibility-actions-ai";

const resultSchema = z.object({
  results: z.array(
    z.object({
      gapId: z.string(),
      verdict: z.enum(["met", "not_met", "needs_user"]),
      reason: z.string(),
      memoryRefs: z.array(z.string()).optional(),
    }),
  ),
});

function factText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text?: string }).text ?? "").trim();
  }
  return "";
}

async function buildMemorySummary(supabase: SupabaseClient, actor: Actor) {
  const [{ data: profile }, { data: facts }, { data: evidence }, { data: skills }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, headline, location_city, location_country, work_authorization, availability, preferences",
      )
      .eq("id", actor.userId)
      .maybeSingle(),
    supabase
      .from("profile_facts")
      .select("category, value, verification_status, excerpt")
      .eq("user_id", actor.userId)
      .limit(60),
    supabase
      .from("evidence_items")
      .select("title, kind, organization, situation, action, outcome, skills, verification_status")
      .eq("user_id", actor.userId)
      .eq("excluded_from_ai", false)
      .limit(35),
    supabase.from("skills").select("name, normalized_name").eq("user_id", actor.userId).limit(80),
  ]);

  const preferences =
    profile?.preferences && typeof profile.preferences === "object"
      ? (profile.preferences as Record<string, unknown>)
      : {};

  return {
    profile: {
      name: profile?.display_name ?? null,
      headline: profile?.headline ?? null,
      location: [profile?.location_city, profile?.location_country].filter(Boolean).join(", ") || null,
      workAuthorization: profile?.work_authorization ?? null,
      availability: profile?.availability ?? null,
      university: typeof preferences.university === "string" ? preferences.university : null,
      educationSummary: typeof preferences.educationSummary === "string" ? preferences.educationSummary : null,
    },
    skills: (skills ?? []).map((row) => String(row.name ?? row.normalized_name ?? "").trim()).filter(Boolean),
    facts: (facts ?? [])
      .map((row) => ({
        category: String(row.category ?? ""),
        value: factText(row.value).slice(0, 240),
        verified: row.verification_status === "verified",
        excerpt: String(row.excerpt ?? "").slice(0, 120),
      }))
      .filter((row) => row.value),
    evidence: (evidence ?? [])
      .map((row) => ({
        title: String(row.title ?? "").slice(0, 120),
        kind: String(row.kind ?? ""),
        organization: String(row.organization ?? "").slice(0, 80),
        skills: Array.isArray(row.skills) ? row.skills.slice(0, 12) : [],
        outcome: String(row.outcome ?? "").slice(0, 160),
        situation: String(row.situation ?? "").slice(0, 120),
        verified: row.verification_status === "verified",
      }))
      .filter((row) => row.title),
  };
}

/**
 * Ask the LLM whether Application Memory satisfies eligibility gaps the rules engine marked unclear.
 * Clears gaps that are supported by memory; leaves only unverifiable ones for Need You.
 */
export async function verifyEligibilityFromMemory(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
  gaps: EligibilityGap[],
): Promise<{ cleared: number; remaining: EligibilityGap[] }> {
  const pending = gaps.filter((gap) => ["unclear", "partial", "needs_confirmation"].includes(gap.state));
  if (pending.length === 0) {
    return { cleared: 0, remaining: gaps };
  }

  const { data: uncheckedRows } = await supabase
    .from("eligibility_results")
    .select("id, memory_checked_at")
    .eq("application_id", applicationId)
    .eq("user_id", actor.userId)
    .in(
      "id",
      pending.map((gap) => gap.id),
    )
    .is("memory_checked_at", null);

  const uncheckedIds = new Set((uncheckedRows ?? []).map((row) => String(row.id)));
  const toCheck = pending.filter((gap) => uncheckedIds.has(gap.id));

  if (toCheck.length === 0) {
    return { cleared: 0, remaining: await loadRemainingGaps(supabase, actor.userId, applicationId, gaps) };
  }

  const provider = tryGetAiProvider();
  if (!provider) {
    return { cleared: 0, remaining: gaps };
  }

  const memory = await buildMemorySummary(supabase, actor);
  const checkedAt = new Date().toISOString();
  let cleared = 0;

  try {
    const raw = await provider.completeStructured({
      schemaName: "eligibilityMemoryVerify",
      instruction: `You verify job eligibility requirements against the applicant's Application Memory ONLY.

For each gap, return:
- verdict "met" when memory clearly supports that the applicant meets the requirement (skills list, projects, employment, education, location, work authorization, facts).
- verdict "not_met" ONLY when memory clearly contradicts a hard requirement.
- verdict "needs_user" when memory is silent, ambiguous, or too weak — the applicant must confirm manually in Need You.

Be practical: if skills include "Git" and requirement is Git experience, verdict is "met". If evidence mentions .NET or PHP and requirement is basic .NET/PHP knowledge, verdict is "met".
Do not invent credentials not present in memory. Prefer "needs_user" over guessing.

Return JSON: { "results": [ { "gapId", "verdict", "reason", "memoryRefs" } ] } for EVERY gapId.`,
      untrustedData: JSON.stringify({
        applicationMemory: memory,
        gaps: toCheck.map((gap) => ({
          id: gap.id,
          kind: gap.requirementKind,
          requirement: gap.requirementText.slice(0, 400),
          priorExplanation: gap.explanation.slice(0, 400),
          state: gap.state,
        })),
      }),
    });

    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) {
      await markMemoryChecked(supabase, actor.userId, toCheck.map((gap) => gap.id), checkedAt);
      return { cleared: 0, remaining: gaps };
    }

    const byGap = new Map(parsed.data.results.map((row) => [row.gapId, row]));

    for (const gap of toCheck) {
      const verdict = byGap.get(gap.id);
      if (!verdict) {
        await supabase
          .from("eligibility_results")
          .update({ memory_checked_at: checkedAt })
          .eq("id", gap.id)
          .eq("user_id", actor.userId);
        continue;
      }

      const refs = (verdict.memoryRefs ?? []).filter(Boolean).slice(0, 3).join("; ");
      const explanation =
        verdict.verdict === "met"
          ? `Verified from Application Memory${refs ? `: ${refs}` : ""}. ${verdict.reason}`.slice(0, 500)
          : verdict.verdict === "not_met"
            ? `Application Memory does not support this requirement. ${verdict.reason}`.slice(0, 500)
            : gap.explanation;

      if (verdict.verdict === "met") {
        await supabase
          .from("eligibility_results")
          .update({
            state: "met",
            needs_confirmation: false,
            explanation,
            memory_checked_at: checkedAt,
            ack_only: false,
          })
          .eq("id", gap.id)
          .eq("user_id", actor.userId);
        cleared += 1;
      } else if (verdict.verdict === "not_met") {
        await supabase
          .from("eligibility_results")
          .update({
            state: "not_met",
            needs_confirmation: false,
            explanation,
            memory_checked_at: checkedAt,
            ack_only: false,
          })
          .eq("id", gap.id)
          .eq("user_id", actor.userId);
      } else {
        await supabase
          .from("eligibility_results")
          .update({
            explanation: verdict.reason.slice(0, 500) || gap.explanation,
            memory_checked_at: checkedAt,
            ack_only: true,
          })
          .eq("id", gap.id)
          .eq("user_id", actor.userId);
      }
    }
  } catch (error) {
    logError("needs_you.eligibility_memory_verify_failed", {
      applicationId,
      message: error instanceof Error ? error.message : "unknown",
    });
    await markMemoryChecked(supabase, actor.userId, toCheck.map((gap) => gap.id), checkedAt);
  }

  return {
    cleared,
    remaining: await loadRemainingGaps(supabase, actor.userId, applicationId, gaps),
  };
}

async function loadRemainingGaps(
  supabase: SupabaseClient,
  userId: string,
  applicationId: string,
  originalGaps: EligibilityGap[],
): Promise<EligibilityGap[]> {
  const { data: refreshed } = await supabase
    .from("eligibility_results")
    .select("id, state, explanation, requirement_text, requirement_kind, user_confirmed_at")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .in(
      "id",
      originalGaps.map((gap) => gap.id),
    );

  return (refreshed ?? [])
    .filter(
      (row) =>
        !row.user_confirmed_at &&
        ["unclear", "partial", "needs_confirmation", "not_met"].includes(String(row.state ?? "")),
    )
    .map((row) => ({
      id: String(row.id),
      requirementText: String(row.requirement_text ?? ""),
      requirementKind: String(row.requirement_kind ?? "general"),
      explanation: String(row.explanation ?? ""),
      state: String(row.state ?? "unclear"),
    }));
}

async function markMemoryChecked(
  supabase: SupabaseClient,
  userId: string,
  gapIds: string[],
  checkedAt: string,
) {
  if (gapIds.length === 0) return;
  await supabase
    .from("eligibility_results")
    .update({ memory_checked_at: checkedAt })
    .eq("user_id", userId)
    .in("id", gapIds);
}
