import { lookup } from "node:dns/promises";

import { isPrivateIpAddress, parsePublicHttpUrl, UnsafeUrlError } from "@/lib/security/public-url";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

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
    headers: { "User-Agent": "1-Apply/0.1 (+https://1-apply.local)" },
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
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim() ?? finalUrl.hostname;
    return { url: finalUrl.toString(), text: htmlToText(html), title };
  }

  throw new UnsafeUrlError("Too many redirects.");
}
