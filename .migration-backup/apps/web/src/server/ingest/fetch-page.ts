import { lookup } from "node:dns/promises";

import { isPrivateIpAddress, parsePublicHttpUrl, UnsafeUrlError } from "@/lib/security/public-url";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number(dec);
      return Number.isNaN(code) ? "" : String.fromCodePoint(code);
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToText(html: string, max = 20_000): string {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, max);
}

export async function assertResolvedHostIsPublic(hostname: string): Promise<void> {
  const { address } = await lookup(hostname);
  if (isPrivateIpAddress(address)) {
    throw new UnsafeUrlError("Private, local, and metadata addresses are blocked.");
  }
}

async function fetchHop(url: URL): Promise<Response> {
  await assertResolvedHostIsPublic(url.hostname);
  return fetch(url.toString(), {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(12_000),
  });
}

export async function fetchPublicPageText(rawUrl: string): Promise<{ url: string; text: string; title: string }> {
  let current = parsePublicHttpUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchHop(current);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new UnsafeUrlError("Redirect without a location is blocked.");
      current = parsePublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    const finalUrl = parsePublicHttpUrl(response.url || current.toString());
    await assertResolvedHostIsPublic(finalUrl.hostname);
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      throw new Error("PAGE_TOO_LARGE");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) {
      throw new Error("UNSUPPORTED_CONTENT_TYPE");
    }
    const html = (await response.text()).slice(0, MAX_BYTES);
    const title =
      decodeHtmlEntities(
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? finalUrl.hostname,
      ) || finalUrl.hostname;
    return { url: finalUrl.toString(), text: htmlToText(html), title };
  }

  throw new UnsafeUrlError("Too many redirects.");
}
