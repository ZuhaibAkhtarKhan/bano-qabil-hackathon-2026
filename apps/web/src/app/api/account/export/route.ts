import { createApiEnvelopeSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";

const envelope = createApiEnvelopeSchema(z.unknown());

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, user, profile } = await requireApiSession(request);
    const [
      { data: facts },
      { data: evidence },
      { data: documents },
      { data: versions },
      { data: opportunities },
      { data: applications },
      { data: answers },
      { data: snapshots },
      { data: notifications },
      { data: reminders },
      { data: eligibility },
    ] = await Promise.all([
      supabase.from("profile_facts").select("id, category, fact_key, value, verification_status, updated_at").eq("user_id", user.id),
      supabase.from("evidence_items").select("id, title, kind, organization, verification_status, excluded_from_ai").eq("user_id", user.id),
      supabase.from("documents").select("id, type, label, current_version_id").eq("user_id", user.id),
      supabase.from("document_versions").select("id, document_id, version_label, mime_type, byte_size, status, original_filename, created_at").eq("user_id", user.id),
      supabase.from("opportunities").select("id, title, organization, category, source, source_url, location, deadline_at, analysis_status").eq("user_id", user.id),
      supabase.from("applications").select("id, status, submitted_at, deadline_at, deadline_timezone, persona, opportunity_id").eq("user_id", user.id),
      supabase.from("application_answers").select("id, application_id, question_id, approved_text, state").eq("user_id", user.id),
      supabase.from("submission_snapshots").select("id, application_id, submitted_at, answer_manifest, document_manifest").eq("user_id", user.id),
      supabase.from("notifications").select("id, title, category, read_at, created_at, application_id").eq("user_id", user.id),
      supabase.from("reminders").select("id, application_id, fire_at, channel, status, idempotency_key").eq("user_id", user.id),
      supabase.from("eligibility_results").select("id, application_id, state, explanation, requirement_text").eq("user_id", user.id),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      profile: {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        headline: profile.headline,
        timezone: profile.timezone ?? null,
      },
      facts: facts ?? [],
      evidence: evidence ?? [],
      documents: documents ?? [],
      documentVersions: versions ?? [],
      opportunities: opportunities ?? [],
      applications: applications ?? [],
      answers: answers ?? [],
      snapshots: snapshots ?? [],
      notifications: notifications ?? [],
      reminders: reminders ?? [],
      eligibility: eligibility ?? [],
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="1apply-export-${user.id.slice(0, 8)}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) return apiAuthResponse(error, envelope, requestId);
    throw error;
  }
}
