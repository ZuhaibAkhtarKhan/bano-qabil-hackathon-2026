import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function looksLikePlaceholder(value: string): boolean {
  return !value || value.startsWith("replace-with") || value === "placeholder";
}

function encryptionKey(): Buffer | null {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  if (looksLikePlaceholder(secret)) return null;
  return createHash("sha256").update(`1apply-integration-tokens:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!plain) return "";
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_UNAVAILABLE");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) {
    throw new Error("TOKEN_ENCRYPTION_REQUIRED");
  }
  const key = encryptionKey();
  if (!key) throw new Error("TOKEN_ENCRYPTION_UNAVAILABLE");
  const payload = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

export function unwrapTokenRow(row: { access_token: string; refresh_token: string | null }) {
  return {
    accessToken: decryptSecret(row.access_token),
    refreshToken: row.refresh_token ? decryptSecret(row.refresh_token) : null,
  };
}
