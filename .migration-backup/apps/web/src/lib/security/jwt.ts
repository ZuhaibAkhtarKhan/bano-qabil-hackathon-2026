/** Decode JWT payload without verifying signatures. Used only to reject privileged roles. */

export function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function isPrivilegedJwt(token: string): boolean {
  const role = jwtRole(token);
  return role === "service_role" || role === "supabase_admin";
}
