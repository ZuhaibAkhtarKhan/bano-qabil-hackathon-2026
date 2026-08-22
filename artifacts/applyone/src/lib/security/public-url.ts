const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function parseIpv4(hostname: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => Number.isNaN(octet) || octet > 255)) return [255, 255, 255, 255];
  return octets;
}

export function isPrivateIpv4(hostname: string): boolean {
  const octets = parseIpv4(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return true;
  if (a === 10 || a === 127 || a === 0 || a === 255) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function mappedIpv4(host: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (dotted) return dotted[1] ?? null;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex || !hex[1] || !hex[2]) return null;
  const hi = Number.parseInt(hex[1], 16);
  const lo = Number.parseInt(hex[2], 16);
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

export function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  const mapped = mappedIpv4(host);
  if (mapped && isPrivateIpv4(mapped)) return true;
  return false;
}

export function isPrivateIpAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "");
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

export class UnsafeUrlError extends Error {
  readonly code = "UNSAFE_URL" as const;

  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function parsePublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("Enter a valid http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Only public http(s) URLs can be ingested.");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError("URLs must not include credentials.");
  }
  if (isBlockedHostname(parsed.hostname) || isPrivateIpv4(parsed.hostname) || isPrivateIpv6(parsed.hostname)) {
    throw new UnsafeUrlError("Private, local, and metadata addresses are blocked.");
  }
  return parsed;
}
