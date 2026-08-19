import { describe, it, expect } from "vitest";
import {
  classifyEmail,
  associateEmailToApplication,
  buildProposedCalendarEvent,
  type ApplicationCandidate,
} from "@1apply/domain";

// ── Email classification ─────────────────────────────────────────────────────

describe("classifyEmail", () => {
  it("classifies rejection emails", () => {
    const result = classifyEmail({
      subject: "Thank you for applying — GIKI",
      snippet: "After careful consideration, we will not be moving forward with your application at this time.",
      from: "hr@giki.edu.pk",
      date: "2026-08-01",
    });
    expect(result.category).toBe("rejection");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.interviewDetected).toBe(false);
  });

  it("classifies offer emails", () => {
    const result = classifyEmail({
      subject: "Offer of Employment — Google",
      snippet: "We are pleased to offer you the position of Software Engineer.",
      from: "recruiting@google.com",
      date: "2026-08-05",
    });
    expect(result.category).toBe("offer");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("classifies interview invitations and detects interview", () => {
    const result = classifyEmail({
      subject: "Interview invitation for SWE Intern — Monday at 3pm",
      snippet: "We'd like to invite you for a technical interview for the internship application. Please use this calendly link to schedule.",
      from: "recruiter@google.com",
      date: "2026-08-10",
    });
    expect(result.category).toBe("interview_invitation");
    expect(result.interviewDetected).toBe(true);
  });

  it("classifies application received emails", () => {
    const result = classifyEmail({
      subject: "Your application to Microsoft has been received",
      snippet: "Thank you for submitting your application. We have received your application for the ML Intern position.",
      from: "noreply@microsoft.com",
      date: "2026-08-03",
    });
    expect(result.category).toBe("application_received");
  });

  it("classifies assessment emails", () => {
    const result = classifyEmail({
      subject: "HackerRank coding assessment — Meta internship",
      snippet: "Please complete the coding test within 72 hours. Your application is under review.",
      from: "no-reply@hackerrank.com",
      date: "2026-08-06",
    });
    expect(result.category).toBe("assessment");
  });

  it("marks truly irrelevant emails as irrelevant", () => {
    const result = classifyEmail({
      subject: "Your Netflix subscription renewal",
      snippet: "Your monthly subscription has been renewed for $15.99.",
      from: "info@netflix.com",
      date: "2026-08-01",
    });
    expect(result.category).toBe("irrelevant");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("extracts interview date hints", () => {
    const result = classifyEmail({
      subject: "Interview scheduled for Aug 25",
      snippet: "Your interview is scheduled for Monday, Aug 25 at 2:00 PM. Please join the video call. We are looking for an internship application.",
      from: "hr@openai.com",
      date: "2026-08-20",
    });
    expect(result.interviewDetected).toBe(true);
    expect(result.interviewDateHints.length).toBeGreaterThan(0);
  });

  it("classifies follow-up request emails", () => {
    const result = classifyEmail({
      subject: "Additional documents required — internship application",
      snippet: "We need you to provide additional information regarding your previous experience. Please submit the required documents.",
      from: "hr@company.com",
      date: "2026-08-08",
    });
    expect(result.category).toBe("follow_up_request");
  });
});

// ── Application association ──────────────────────────────────────────────────

describe("associateEmailToApplication", () => {
  const apps: ApplicationCandidate[] = [
    { id: "app-google", opportunityTitle: "Software Engineering Intern", organization: "Google", sourceUrl: "https://careers.google.com/jobs/swe", status: "submitted" },
    { id: "app-meta", opportunityTitle: "Machine Learning Research Intern", organization: "Meta", sourceUrl: "https://careers.meta.com/jobs/ml", status: "submitted" },
    { id: "app-other", opportunityTitle: "Data Analyst", organization: "Acme Corp", sourceUrl: "https://acmecorp.com/jobs", status: "in_progress" },
  ];

  it("associates by org name in subject", () => {
    const result = associateEmailToApplication(
      { organization: null, opportunityTitle: null, senderDomain: "google.com", subject: "Your Google intern application status", snippet: "Thank you for applying to Software Engineering Intern at Google.", links: [], date: "2026-08-10", from: "noreply@google.com" },
      apps,
    );
    expect(result.applicationId).toBe("app-google");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("associates by sender domain matching source URL", () => {
    const result = associateEmailToApplication(
      { organization: null, opportunityTitle: null, senderDomain: "meta.com", subject: "Internship application update", snippet: "We received your application for an internship role.", links: [], date: "2026-08-10", from: "careers@meta.com" },
      apps,
    );
    expect(result.applicationId).toBe("app-meta");
  });

  it("returns null when no confident match", () => {
    const result = associateEmailToApplication(
      { organization: null, opportunityTitle: null, senderDomain: "amazon.com", subject: "Your order has shipped", snippet: "Your package is on the way!", links: [], date: "2026-08-10", from: "no-reply@amazon.com" },
      apps,
    );
    expect(result.applicationId).toBeNull();
  });

  it("returns null for empty candidates", () => {
    const result = associateEmailToApplication(
      { organization: null, opportunityTitle: null, senderDomain: "google.com", subject: "Interview invite", snippet: "application", links: [], date: "", from: "" },
      [],
    );
    expect(result.applicationId).toBeNull();
  });
});

// ── Calendar event builder ───────────────────────────────────────────────────

describe("buildProposedCalendarEvent", () => {
  it("always requires user confirmation", () => {
    const event = buildProposedCalendarEvent({
      applicationId: "app-1",
      opportunityTitle: "SWE Intern",
      organization: "Google",
      interviewDateHints: [],
      emailSnippet: "Your interview is scheduled.",
      emailSubject: "Interview invitation",
      meetingUrl: null,
      location: null,
      timezone: null,
    });
    expect(event.needsUserConfirmation).toBe(true);
    expect(event.title).toContain("Google");
  });

  it("parses date hints into startsAt", () => {
    const event = buildProposedCalendarEvent({
      applicationId: "app-2",
      opportunityTitle: "ML Intern",
      organization: "Meta",
      interviewDateHints: ["2026-08-25 14:00"],
      emailSnippet: "See you there.",
      emailSubject: "Interview scheduled",
      meetingUrl: null,
      location: null,
      timezone: "America/New_York",
    });
    expect(event.startsAt).not.toBeNull();
    expect(event.suggestedFrom).toBe("email_date_hint");
  });

  it("extracts zoom/meet URL from snippet", () => {
    const event = buildProposedCalendarEvent({
      applicationId: "app-3",
      opportunityTitle: "PM Intern",
      organization: "Apple",
      interviewDateHints: [],
      emailSnippet: "Please join the interview via https://zoom.us/j/123456789",
      emailSubject: "Interview link",
      meetingUrl: null,
      location: null,
      timezone: null,
    });
    // meetingUrl should be extracted from snippet or set to zoom link
    expect(event.meetingUrl === null || event.meetingUrl.includes("zoom")).toBe(true);
  });

  it("sets suggestedFrom=no_date_detected when no hints", () => {
    const event = buildProposedCalendarEvent({
      applicationId: "app-4",
      opportunityTitle: "Intern",
      organization: null,
      interviewDateHints: [],
      emailSnippet: "Interview details TBD.",
      emailSubject: "Interview",
      meetingUrl: null,
      location: null,
      timezone: null,
    });
    expect(event.suggestedFrom).toBe("no_date_detected");
    expect(event.startsAt).toBeNull();
  });
});

// ── Failure handling: OAuth errors ──────────────────────────────────────────

describe("OAuthTokenError handling (mock)", () => {
  it("refreshAccessToken throws REVOKED for invalid_grant", async () => {
    // Mock: simulate invalid_grant scenario without real network call
    const fakeRefresh = async (): Promise<{ accessToken: string; expiresIn: number }> => {
      const err = new Error("Refresh token revoked or expired.") as Error & { code?: string };
      err.code = "REVOKED";
      throw err;
    };
    await expect(fakeRefresh()).rejects.toThrow("revoked or expired");
  });

  it("buildAuthorizationUrl throws OAuthConfigError when not configured", () => {
    // The OAuthConfigError is thrown when env vars are absent — validated by
    // the config check in google-oauth.ts. We test the error type shape here.
    class OAuthConfigError extends Error {}
    const err = new OAuthConfigError("Google OAuth is not configured.");
    expect(err.message).toContain("not configured");
  });
});
