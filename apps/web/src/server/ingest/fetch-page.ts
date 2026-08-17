import { parsePublicHttpUrl } from "@/lib/security/public-url";

const MAX_BYTES = 1_000_000;

export function htmlToText(html: string, max = 20_000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function fetchPublicPageText(rawUrl: string): Promise<{ url: string; text: string; title: string }> {
  const initial = parsePublicHttpUrl(rawUrl);
  const response = await fetch(initial.toString(), {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "1-Apply/0.1 (+https://1-apply.local)" },
    signal: AbortSignal.timeout(12_000),
  });

  const finalUrl = parsePublicHttpUrl(response.url || initial.toString());
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) {
    throw new Error("PAGE_TOO_LARGE");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
    throw new Error("UNSUPPORTED_CONTENT_TYPE");
  }
  const html = (await response.text()).slice(0, MAX_BYTES);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? finalUrl.hostname;
  return { url: finalUrl.toString(), text: htmlToText(html), title };
}
