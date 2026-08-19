/**
 * Gmail read-only sync service.
 * Reads recent threads, classifies application-related emails, associates with applications.
 * Minimizes stored data: subject, sender domain, snippet, category. No message body is stored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyEmail,
  associateEmailToApplication,
  buildProposedCalendarEvent,
  type ApplicationCandidate,
} from "@1apply/domain";

import { OAuthTokenError, refreshAccessToken } from "./google-oauth";

const GMAIL_MESSAGES_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const GMAIL_THREADS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/threads";
void GMAIL_THREADS_URL;

type GmailMessageHeader = { name: string; value: string };
type GmailPart = { mimeType: string; body: { data?: string }; parts?: GmailPart[] };
type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  payload: { headers: GmailMessageHeader[]; parts?: GmailPart[]; body?: { data?: string } };
  snippet: string;
};

function header(message: GmailMessage, name: string): string {
  return message.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function domainOf(email: string): string {
  const at = email.indexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

async function gmailFetch<T>(accessToken: string, url: string): Promise<T> {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    const code = (body.error as { status?: string } | null)?.status ?? "GMAIL_API_ERROR";
    throw new OAuthTokenError(`Gmail API error: ${resp.status} ${resp.statusText}`, code);
  }
  return resp.json() as Promise<T>;
}

export type GmailSyncResult = {
  processed: number;
  classified: number;
  associated: number;
  interviewsDetected: number;
  errors: string[];
};

export async function syncGmailMessages(input: {
  supabase: SupabaseClient;
  userId: string;
  integrationId: string;
  accessToken: string;
  refreshToken: string | null;
  applications: ApplicationCandidate[];
  maxMessages?: number;
}): Promise<GmailSyncResult> {
  const { supabase, userId, integrationId, applications } = input;
  const maxMessages = input.maxMessages ?? 50;
  const result: GmailSyncResult = { processed: 0, classified: 0, associated: 0, interviewsDetected: 0, errors: [] };

  let accessToken = input.accessToken;

  // Fetch recent message IDs from inbox
  let listData: { messages?: Array<{ id: string }> };
  try {
    listData = await gmailFetch<typeof listData>(
      accessToken,
      `${GMAIL_MESSAGES_URL}?maxResults=${maxMessages}&q=in:inbox category:primary`,
    );
  } catch (err) {
    if (err instanceof OAuthTokenError && err.code === "401" && input.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(input.refreshToken);
        accessToken = refreshed.accessToken;
        await supabase
          .from("integration_tokens")
          .update({ access_token: accessToken, expires_at: new Date(Date.now() + refreshed.expiresIn * 1000).toISOString() })
          .eq("integration_id", integrationId);
        listData = await gmailFetch<typeof listData>(
          accessToken,
          `${GMAIL_MESSAGES_URL}?maxResults=${maxMessages}&q=in:inbox category:primary`,
        );
      } catch (refreshErr) {
        if (refreshErr instanceof OAuthTokenError && refreshErr.code === "REVOKED") {
          await supabase.from("integrations").update({ status: "revoked" }).eq("id", integrationId);
        }
        result.errors.push(`Token refresh failed: ${String(refreshErr)}`);
        return result;
      }
    } else {
      result.errors.push(`Gmail list failed: ${String(err)}`);
      return result;
    }
  }

  const messageIds = (listData.messages ?? []).map((m) => m.id);

  for (const messageId of messageIds) {
    try {
      // Check for duplicate
      const { data: existing } = await supabase
        .from("email_events")
        .select("id")
        .eq("user_id", userId)
        .eq("external_id", messageId)
        .maybeSingle();
      if (existing) continue;

      const message = await gmailFetch<GmailMessage>(
        accessToken,
        `${GMAIL_MESSAGES_URL}/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      );
      result.processed++;

      const subject = header(message, "subject");
      const from = header(message, "from");
      const date = header(message, "date");
      const snippet = message.snippet ?? "";
      const senderDomain = domainOf(from.replace(/^.*</, "").replace(/>.*$/, "").trim());

      const classification = classifyEmail({ subject, snippet, from, date });
      if (classification.category === "irrelevant") continue;
      result.classified++;

      // Extract any links from snippet (simplified – no full body to minimize stored data)
      const linkPattern = /https?:\/\/[^\s"<>]+/g;
      const links = [...snippet.matchAll(linkPattern)].map((m) => m[0]);

      const association = associateEmailToApplication(
        { organization: null, opportunityTitle: null, senderDomain, subject, snippet, links, date, from },
        applications,
      );
      const applicationId = association.applicationId;
      if (applicationId) result.associated++;

      // Store minimal email event — no message body, no thread content
      const { data: emailEvent } = await supabase
        .from("email_events")
        .insert({
          user_id: userId,
          integration_id: integrationId,
          application_id: applicationId,
          occurred_at: new Date(date).toISOString(),
          external_id: messageId,
          event_kind: classification.category,
          subject: subject.slice(0, 500),
          from_address: from.slice(0, 320),
          snippet: snippet.slice(0, 800),
          sender_domain: senderDomain,
          association_confidence: association.confidence,
          association_signals: association.signals,
          interview_detected: classification.interviewDetected,
          interview_date_hints: classification.interviewDateHints,
          user_corrected: false,
        })
        .select("id")
        .single();

      // Record application event for timeline
      if (applicationId) {
        await supabase.from("application_events").insert({
          user_id: userId,
          application_id: applicationId,
          event_name: classification.category,
          payload: { emailEventId: emailEvent?.id, subject, senderDomain, confidence: association.confidence },
        });

        // Notify user of significant categories
        const significant = ["rejection", "offer", "interview_invitation"];
        if (significant.includes(classification.category)) {
          const titles: Record<string, string> = {
            rejection: "Rejection email detected",
            offer: "Offer email detected",
            interview_invitation: "Interview invitation detected",
          };
          await supabase.from("notifications").insert({
            user_id: userId,
            application_id: applicationId,
            title: titles[classification.category] ?? classification.category,
            body: `Email from ${senderDomain}: "${subject.slice(0, 120)}"`,
          });
        }
      }

      // Propose calendar event for interviews (always needs user confirmation)
      if (classification.interviewDetected && applicationId && emailEvent) {
        const app = applications.find((a) => a.id === applicationId);
        const proposed = buildProposedCalendarEvent({
          applicationId,
          opportunityTitle: app?.opportunityTitle ?? "Interview",
          organization: app?.organization ?? null,
          interviewDateHints: classification.interviewDateHints,
          emailSnippet: snippet,
          emailSubject: subject,
          meetingUrl: null,
          location: null,
          timezone: null,
        });

        if (proposed.needsUserConfirmation) {
          await supabase.from("calendar_events").insert({
            user_id: userId,
            integration_id: integrationId,
            application_id: applicationId,
            starts_at: proposed.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            ends_at: proposed.endsAt,
            title: proposed.title,
            external_id: null,
            location: proposed.location,
            meeting_url: proposed.meetingUrl,
            timezone: proposed.timezone,
            confirmed: false,
            email_event_id: emailEvent.id,
            notes: proposed.notes,
          });
          result.interviewsDetected++;

          await supabase.from("notifications").insert({
            user_id: userId,
            application_id: applicationId,
            title: "Interview detected — confirm calendar event",
            body: `${proposed.title}. ${proposed.notes} Confirm in Integrations to add to your calendar.`,
          });
        }
      }
    } catch (err) {
      result.errors.push(`Message ${messageId}: ${String(err)}`);
    }
  }

  return result;
}
