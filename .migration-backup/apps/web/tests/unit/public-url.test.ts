import { describe, expect, it } from "vitest";

import { parsePublicHttpUrl, UnsafeUrlError } from "@/lib/security/public-url";

describe("parsePublicHttpUrl", () => {
  it("accepts a public https URL", () => {
    const url = parsePublicHttpUrl("https://careers.example.com/jobs/123");
    expect(url.hostname).toBe("careers.example.com");
  });

  it("rejects localhost and loopback", () => {
    expect(() => parsePublicHttpUrl("http://localhost:3000/secret")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("http://127.0.0.1/admin")).toThrow(UnsafeUrlError);
  });

  it("rejects IPv6-mapped loopback", () => {
    expect(() => parsePublicHttpUrl("http://[::ffff:127.0.0.1]/admin")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("http://[::ffff:7f00:1]/admin")).toThrow(UnsafeUrlError);
  });

  it("rejects metadata and private networks", () => {
    expect(() => parsePublicHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("http://10.0.0.8/internal")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("http://192.168.1.1")).toThrow(UnsafeUrlError);
  });

  it("rejects credentials and non-http schemes", () => {
    expect(() => parsePublicHttpUrl("https://user:pass@example.com")).toThrow(UnsafeUrlError);
    expect(() => parsePublicHttpUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
  });
});
