import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";
import { emitDomainEvent } from "@/server/notifications/service";
import { recordApplicationEvent } from "@/services/platform";

import { freezeApplicationPacket } from "./freeze-packet";

export type HostSubmitJobRow = {
  id: string;
  application_id: string;
  source_url: string;
  due_at: string;
  status: string;
  attempt_count: number;
};

function publicFormUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function queueHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  applicationId: string;
  dueAt?: Date;
}): Promise<{ ok: true; jobId: string } | { ok: false; reason: string }> {
  const { supabase, actor, applicationId } = input;
  const dueAt = input.dueAt ?? new Date();

  const { data: application } = await supabase
    .from("applications")
    .select("id, status, deadline_at, opportunity_id, opportunities ( source_url, canonical_url, title )")
    .eq("id", applicationId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!application) return { ok: false, reason: "not_found" };
  if (["submitted", "rejected", "withdrawn", "archived", "offer"].includes(String(application.status))) {
    return { ok: false, reason: "already_closed" };
  }

  const opportunity = Array.isArray(application.opportunities)
    ? application.opportunities[0]
    : application.opportunities;
  const sourceUrl =
    publicFormUrl((opportunity as { canonical_url?: string | null } | null)?.canonical_url) ??
    publicFormUrl((opportunity as { source_url?: string | null } | null)?.source_url);
  if (!sourceUrl) return { ok: false, reason: "no_source_url" };

  const dayKey = (application.deadline_at as string | null)?.slice(0, 10) ?? dueAt.toISOString().slice(0, 10);
  const idempotencyKey = `${applicationId}:host_submit:${dayKey}`;

  const { data: existing } = await supabase
    .from("host_submit_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing && ["pending", "running", "submitted"].includes(String(existing.status))) {
    return { ok: true, jobId: String(existing.id) };
  }

  const { data: job, error } = await supabase
    .from("host_submit_jobs")
    .insert({
      user_id: actor.userId,
      application_id: applicationId,
      source_url: sourceUrl,
      due_at: dueAt.toISOString(),
      status: "pending",
      idempotency_key: idempotencyKey,
    })
    .select("id")
    .single();

  if (error || !job) return { ok: false, reason: error?.message ?? "insert_failed" };

  await supabase
    .from("applications")
    .update({
      next_action: "Queued for auto-submit before deadline. Keep Chrome open with the 1-Apply extension.",
    })
    .eq("id", applicationId)
    .eq("user_id", actor.userId);

  await emitDomainEvent(supabase, {
    name: "automation.host_submit",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:host_submit`,
    title: `Auto-submit queued — ${(opportunity as { title?: string } | null)?.title ?? "Application"}`,
    body: "1-Apply will fill and submit this form before the deadline. CAPTCHA, signature, or payment still need you.",
  });

  return { ok: true, jobId: String(job.id) };
}

export async function listPendingHostSubmitJobs(
  supabase: SupabaseClient,
  userId: string,
): Promise<HostSubmitJobRow[]> {
  const { data } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id, source_url, due_at, status, attempt_count")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .lte("due_at", new Date(Date.now() + 5 * 60 * 1000).toISOString())
    .order("due_at", { ascending: true })
    .limit(10);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    application_id: String(row.application_id),
    source_url: String(row.source_url),
    due_at: String(row.due_at),
    status: String(row.status),
    attempt_count: Number(row.attempt_count ?? 0),
  }));
}

export async function markHostSubmitJobRunning(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("host_submit_jobs")
    .select("id, attempt_count, status")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing || !["pending", "running"].includes(String(existing.status))) return false;

  const { data } = await supabase
    .from("host_submit_jobs")
    .update({
      status: "running",
      attempt_count: Number(existing.attempt_count ?? 0) + 1,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  return Boolean(data);
}

export async function completeHostSubmitJob(input: {
  supabase: SupabaseClient;
  actor: Actor;
  jobId: string;
  submitted: boolean;
  hostSubmitClicked: boolean;
  error?: string | null;
  blockedReason?: string | null;
}): Promise<{ ok: boolean }> {
  const { supabase, actor, jobId, submitted, hostSubmitClicked, error, blockedReason } = input;

  const { data: job } = await supabase
    .from("host_submit_jobs")
    .select("id, application_id, status")
    .eq("id", jobId)
    .eq("user_id", actor.userId)
    .maybeSingle();

  if (!job) return { ok: false };

  const applicationId = String(job.application_id);
  const now = new Date().toISOString();

  if (blockedReason) {
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "blocked",
        last_error: blockedReason.slice(0, 500),
        completed_at: now,
      })
      .eq("id", jobId);

    await emitDomainEvent(supabase, {
      name: "automation.account_action",
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:host_submit_blocked`,
      title: "Auto-submit blocked at host",
      body: blockedReason,
      payload: { captcha: /captcha/i.test(blockedReason) },
    });
    return { ok: true };
  }

  if (submitted && hostSubmitClicked) {
    await supabase
      .from("host_submit_jobs")
      .update({
        status: "submitted",
        host_submit_clicked: true,
        completed_at: now,
        last_error: null,
      })
      .eq("id", jobId);

    await freezeApplicationPacket({
      supabase,
      actor,
      applicationId,
      source: "silence",
      hostSubmitClicked: true,
    });

    await recordApplicationEvent(supabase, actor, applicationId, "application.host_submitted", {
      jobId,
      hostSubmitClicked: true,
    });

    await emitDomainEvent(supabase, {
      name: "submission.completed",
      userId: actor.userId,
      applicationId,
      subjectId: `${applicationId}:host_submit`,
      title: "Form submitted to host",
      body: "1-Apply filled and clicked Submit on the host form before the deadline.",
    });
    return { ok: true };
  }

  await supabase
    .from("host_submit_jobs")
    .update({
      status: "failed",
      host_submit_clicked: hostSubmitClicked,
      last_error: (error ?? "submit_failed").slice(0, 500),
      completed_at: now,
    })
    .eq("id", jobId);

  await emitDomainEvent(supabase, {
    name: "submission.failed",
    userId: actor.userId,
    applicationId,
    subjectId: `${applicationId}:host_submit_failed`,
    title: "Auto-submit failed",
    body: error ?? "Could not submit the host form. Open the form and submit manually.",
  });

  return { ok: true };
}
