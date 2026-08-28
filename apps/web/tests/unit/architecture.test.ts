import { describe, expect, it, vi } from "vitest";

import { toJobLifecycle } from "@1apply/contracts";

import { loadAppConfig } from "@/config/env";
import { resolveChatProvider } from "@/infra/ai/openai";
import { documentStoragePath } from "@/infra/storage/documents";

describe("configuration", () => {
  it("loads public urls without treating placeholders as live secrets", () => {
    const config = loadAppConfig({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "replace-with-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "replace-with-service-role-key",
      OPENAI_API_KEY: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "replace-with-secret",
    });
    expect(config.openaiConfigured).toBe(false);
    expect(config.groqConfigured).toBe(false);
    expect(config.aiConfigured).toBe(false);
    expect(config.supabaseServiceRoleKeyConfigured).toBe(false);
    expect(config.googleOAuthConfigured).toBe(false);
    expect(config.storageBucket).toBe("application-documents");
  });

  it("treats Groq as a configured AI provider without requiring OpenAI", () => {
    const config = loadAppConfig({
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      GROQ_API_KEY: "gsk_test_placeholder_not_real",
    });
    expect(config.groqConfigured).toBe(true);
    expect(config.aiConfigured).toBe(true);
    expect(config.openaiConfigured).toBe(false);
    expect(config.aiChatProvider).toBe("auto");
  });

  it("prefers Groq for interactive chat in auto mode", () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_test");
    vi.stubEnv("OPENAI_API_KEY", "gemini-key");
    const config = loadAppConfig({
      GROQ_API_KEY: "gsk_test",
      OPENAI_API_KEY: "gemini-key",
      OPENAI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
      AI_CHAT_PROVIDER: "auto",
    });
    const interactive = resolveChatProvider(config, "groundedDraft");
    expect(interactive.provider).toBe("groq");
    const heavy = resolveChatProvider(config, "opportunityExtraction");
    expect(heavy.provider).toBe("openai");
  });
});

describe("job lifecycle", () => {
  it("maps persisted aliases onto queued/processing/completed/failed", () => {
    expect(toJobLifecycle("running")).toBe("processing");
    expect(toJobLifecycle("succeeded")).toBe("completed");
    expect(toJobLifecycle("queued")).toBe("queued");
  });
});

describe("private storage paths", () => {
  it("nests files under the session user id and document type", () => {
    const path = documentStoragePath({
      actor: {
        userId: "11111111-1111-4111-8111-111111111111",
        email: "a@example.com",
        profile: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "a@example.com",
          display_name: "A",
          headline: null,
          phone: null,
          terms_accepted_at: null,
          ai_processing_accepted_at: null,
          onboarding_completed_at: null,
          onboarding_step: "consent",
          preferences: {},
          timezone: null,
        },
      },
      documentId: "d1",
      versionId: "v1",
      type: "resume",
      fileName: "Resume (final).pdf",
    });
    expect(path.startsWith("11111111-1111-4111-8111-111111111111/resumes/")).toBe(true);
    expect(path).not.toContain("..");
  });
});
