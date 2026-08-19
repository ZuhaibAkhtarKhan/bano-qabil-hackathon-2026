import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { opportunityIngestRequestSchema } from "@1apply/contracts";

import { GET as healthGet } from "@/app/api/health/route";
import { isPrivilegedJwt, jwtRole } from "@/lib/security/jwt";
import { createOAuthState, oauthStateMatches, parseOAuthState, serializeOAuthState } from "@/server/integrations/oauth-state";
import { decryptSecret, encryptSecret } from "@/server/integrations/token-crypto";

const envExample = readFileSync(path.resolve(__dirname, "../../../../.env.example"), "utf8");
const hardening = readFileSync(
  path.resolve(__dirname, "../../../../supabase/migrations/20260819160000_security_hardening.sql"),
  "utf8",
);

describe("secrets are not committed", () => {
  it("keeps env example values as placeholders", () => {
    expect(envExample).toContain("replace-with-anon-key");
    expect(envExample).toContain("replace-with-service-role-key");
    expect(envExample).not.toMatch(/eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\./);
    expect(envExample).not.toContain("wlscwrcwkufmumydhqyg");
  });
});

describe("health endpoint", () => {
  it("does not advertise AI or database configuration", async () => {
    const response = await healthGet();
    const json = (await response.json()) as { data: { ok: true; openai?: boolean; supabase?: boolean } };
    expect(json.data.ok).toBe(true);
    expect(json.data.openai).toBeUndefined();
    expect(json.data.supabase).toBeUndefined();
  });
});

describe("privileged JWTs", () => {
  it("rejects service_role payloads without verifying a signature", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const token = `header.${payload}.sig`;
    expect(jwtRole(token)).toBe("service_role");
    expect(isPrivilegedJwt(token)).toBe(true);
    expect(isPrivilegedJwt("not-a-jwt")).toBe(false);
  });
});

describe("oauth state binding", () => {
  it("requires cookie token, user, and kind to match", () => {
    const payload = createOAuthState("gmail", "user-1");
    const cookie = serializeOAuthState(payload);
    expect(oauthStateMatches({ cookie, state: payload.token, userId: "user-1", kind: "gmail" })).toBe(true);
    expect(oauthStateMatches({ cookie, state: payload.token, userId: "user-2", kind: "gmail" })).toBe(false);
    expect(oauthStateMatches({ cookie, state: "other", userId: "user-1", kind: "gmail" })).toBe(false);
    expect(oauthStateMatches({ cookie, state: payload.token, userId: "user-1", kind: "google_calendar" })).toBe(false);
    expect(parseOAuthState(JSON.stringify(payload))).toBeNull();
  });
});

describe("integration token crypto", () => {
  it("round-trips when an encryption secret is present", () => {
    const previous = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-oauth-secret";
    const stored = encryptSecret("ya29.access");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(stored)).toBe("ya29.access");
    expect(() => decryptSecret("legacy-plain")).toThrow(/TOKEN_ENCRYPTION_REQUIRED/);
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = previous;
  });
});

describe("ingest contract", () => {
  it("rejects oversized page text and private URLs stay a parse concern", () => {
    const huge = opportunityIngestRequestSchema.safeParse({
      url: "https://example.com/job",
      metadata: { pageText: "x".repeat(20_001) },
    });
    expect(huge.success).toBe(false);
    const ok = opportunityIngestRequestSchema.safeParse({
      url: "https://example.com/job",
      metadata: { pageText: "Apply now" },
    });
    expect(ok.success).toBe(true);
  });
});

describe("security hardening migration", () => {
  it("adds consent immutability, token select, and server-only audit inserts", () => {
    expect(hardening).toContain("protect_profile_gates");
    expect(hardening).toContain("integration_tokens_select_own");
    expect(hardening).toContain("record_audit_event");
    expect(hardening).toContain("grant execute on function public.record_audit_event");
    expect(hardening).not.toContain("create policy audit_events_insert");
  });
});
