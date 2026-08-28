import { afterEach, describe, expect, it, vi } from "vitest";

describe("extractPdfTextWithAi", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns structured text from the AI API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "Jane Doe\njane@example.com\n\nExperience\n- Built APIs" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { extractPdfTextWithAi } = await import("@/lib/documents/extract-pdf-ai");
    const text = await extractPdfTextWithAi(Buffer.from("%PDF-1.7\n"), { fileName: "resume.pdf" });

    expect(text).toContain("Jane Doe");
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content[0].text).toContain("professional resume/CV");
    expect(body.messages[1].content[1].file.filename).toBe("resume.pdf");
  });

  it("uses Gemini native generateContent for Google base URLs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
    vi.stubEnv("OPENAI_MODEL", "gemini-3.6-flash");
    const fetchMock = vi.fn(async () =>
      Response.json({
        candidates: [{ content: { parts: [{ text: "Jane Doe\n\nExperience\n- Built APIs" }] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { extractPdfTextWithAi } = await import("@/lib/documents/extract-pdf-ai");
    const text = await extractPdfTextWithAi(Buffer.from("%PDF-1.7\n"), { fileName: "resume.pdf" });

    expect(text).toContain("Jane Doe");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1beta/models/gemini-3.6-flash:generateContent");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });

  it("returns null when OpenAI is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { extractPdfTextWithAi } = await import("@/lib/documents/extract-pdf-ai");
    expect(await extractPdfTextWithAi(Buffer.from("%PDF-1.7\n"))).toBeNull();
  });
});
