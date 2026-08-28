import { envSchema } from "@1apply/contracts";

export type AppConfig = {
  appUrl: string;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceRoleKeyConfigured: boolean;
  openaiConfigured: boolean;
  groqConfigured: boolean;
  aiConfigured: boolean;
  openaiBaseUrl: string;
  openaiModel: string;
  groqModel: string;
  embeddingProvider: string;
  embeddingModel: string;
  storageBucket: string;
  extensionOrigin: string | null;
  googleOAuthConfigured: boolean;
  gmailSyncEnabled: boolean;
  calendarSyncEnabled: boolean;
};

function looksLikeSecretPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value.startsWith("replace-with") || value === "placeholder";
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_GEMINI_CHAT_MODEL = "gemini-2.0-flash";
const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";

export function loadAppConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.parse({
    NEXT_PUBLIC_APP_URL: emptyToUndefined(source.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000",
    NEXT_PUBLIC_SUPABASE_URL: emptyToUndefined(source.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: emptyToUndefined(source.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: emptyToUndefined(source.SUPABASE_SERVICE_ROLE_KEY),
    OPENAI_API_KEY: emptyToUndefined(source.OPENAI_API_KEY),
    OPENAI_BASE_URL: emptyToUndefined(source.OPENAI_BASE_URL),
    OPENAI_MODEL: emptyToUndefined(source.OPENAI_MODEL),
    EMBEDDING_PROVIDER: emptyToUndefined(source.EMBEDDING_PROVIDER),
    EMBEDDING_MODEL: emptyToUndefined(source.EMBEDDING_MODEL),
    STORAGE_BUCKET: emptyToUndefined(source.STORAGE_BUCKET),
    NEXT_PUBLIC_EXTENSION_ORIGIN: emptyToUndefined(source.NEXT_PUBLIC_EXTENSION_ORIGIN),
    GOOGLE_OAUTH_CLIENT_ID: emptyToUndefined(source.GOOGLE_OAUTH_CLIENT_ID),
    GOOGLE_OAUTH_CLIENT_SECRET: emptyToUndefined(source.GOOGLE_OAUTH_CLIENT_SECRET),
    GMAIL_SYNC_ENABLED: emptyToUndefined(source.GMAIL_SYNC_ENABLED),
    CALENDAR_SYNC_ENABLED: emptyToUndefined(source.CALENDAR_SYNC_ENABLED),
    GROQ_API_KEY: emptyToUndefined(source.GROQ_API_KEY),
    GROQ_MODEL: emptyToUndefined(source.GROQ_MODEL),
  });

  const openaiKey = parsed.OPENAI_API_KEY ?? "";
  const groqKey = parsed.GROQ_API_KEY ?? "";
  const openaiConfigured = Boolean(openaiKey) && !looksLikeSecretPlaceholder(openaiKey);
  const groqConfigured = Boolean(groqKey) && !looksLikeSecretPlaceholder(groqKey);
  return {
    appUrl: parsed.NEXT_PUBLIC_APP_URL,
    supabaseUrl: parsed.NEXT_PUBLIC_SUPABASE_URL ?? null,
    supabaseAnonKey: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
    supabaseServiceRoleKeyConfigured: !looksLikeSecretPlaceholder(parsed.SUPABASE_SERVICE_ROLE_KEY),
    openaiConfigured,
    groqConfigured,
    aiConfigured: openaiConfigured || groqConfigured,
    openaiBaseUrl: (parsed.OPENAI_BASE_URL ?? GEMINI_BASE_URL).replace(/\/$/, ""),
    openaiModel: parsed.OPENAI_MODEL ?? DEFAULT_GEMINI_CHAT_MODEL,
    groqModel: parsed.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    embeddingProvider: parsed.EMBEDDING_PROVIDER ?? "openai-compatible",
    embeddingModel: parsed.EMBEDDING_MODEL ?? DEFAULT_GEMINI_EMBEDDING_MODEL,
    storageBucket: parsed.STORAGE_BUCKET ?? "application-documents",
    extensionOrigin: parsed.NEXT_PUBLIC_EXTENSION_ORIGIN ?? null,
    googleOAuthConfigured:
      !looksLikeSecretPlaceholder(parsed.GOOGLE_OAUTH_CLIENT_ID) &&
      !looksLikeSecretPlaceholder(parsed.GOOGLE_OAUTH_CLIENT_SECRET),
    gmailSyncEnabled: parsed.GMAIL_SYNC_ENABLED !== "false",
    calendarSyncEnabled: parsed.CALENDAR_SYNC_ENABLED !== "false",
  };
}

export const STORAGE_PREFIX: Record<string, string> = {
  resume: "resumes",
  resume_variant: "resume-variants",
  cover_letter: "cover-letters",
  transcript: "transcripts",
  certificate: "certificates",
  portfolio: "portfolios",
  supporting_document: "supporting",
  identity_document: "identity",
  family_document: "family",
  other: "supporting",
};

export const EMBEDDING_DIMENSIONS = 1536;
export const JOB_MAX_ATTEMPTS = 3;
