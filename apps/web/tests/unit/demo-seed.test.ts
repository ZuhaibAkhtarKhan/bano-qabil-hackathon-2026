import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNT } from "@/lib/demo-account";

const seed = readFileSync(path.resolve(__dirname, "../../../../supabase/seed.sql"), "utf8");

describe("demo seed", () => {
  it("ships a sign-in account that covers kit, need-you, deadline, host wall, and submitted packets", () => {
    expect(seed).toContain(DEMO_ACCOUNT.email);
    expect(seed).toContain(DEMO_ACCOUNT.password);
    expect(seed).toContain("review_required");
    expect(seed).toContain("in_progress");
    expect(seed).toContain("submitted");
    expect(seed).toContain("interview");
    expect(seed).toContain("captcha");
    expect(seed).toContain("prepareAndSendIfSilent");
    expect(seed).toContain("identity_document");
  });
});
