/** Coerce Gemini / loose JSON into arrays before Zod validation. */
function asStringArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["items", "skills", "values", "list"]) {
      if (key in obj) return asStringArray(obj[key]);
    }
    const values = Object.values(obj)
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function asObjectArray(value: unknown): Record<string, unknown>[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["items", "evidence", "entries", "links", "list"]) {
      if (key in obj) return asObjectArray(obj[key]);
    }
    if ("title" in obj || "url" in obj || "kind" in obj) return [obj];
    const values = Object.values(obj).filter(
      (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
    );
    return values.length > 0 ? values : undefined;
  }
  return undefined;
}

function normalizeLink(raw: Record<string, unknown>) {
  return {
    kind: String(raw.kind ?? raw.type ?? "other"),
    url: String(raw.url ?? raw.href ?? "").trim(),
    label: raw.label != null ? String(raw.label) : undefined,
  };
}

function normalizeEvidence(raw: Record<string, unknown>) {
  const skills = asStringArray(raw.skills) ?? [];
  return {
    title: String(raw.title ?? raw.name ?? "").trim(),
    kind: String(raw.kind ?? raw.type ?? "project"),
    organization: raw.organization != null ? String(raw.organization) : raw.org != null ? String(raw.org) : null,
    situation: raw.situation != null ? String(raw.situation) : null,
    action: raw.action != null ? String(raw.action) : null,
    outcome: raw.outcome != null ? String(raw.outcome) : null,
    skills,
    startDate: raw.startDate != null ? String(raw.startDate) : raw.start_date != null ? String(raw.start_date) : null,
    endDate: raw.endDate != null ? String(raw.endDate) : raw.end_date != null ? String(raw.end_date) : null,
    excerpt: raw.excerpt != null ? String(raw.excerpt) : null,
  };
}

function normalizeProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const pick = (camel: string, snake: string) => obj[camel] ?? obj[snake];
  return {
    displayName: pick("displayName", "display_name"),
    university: obj.university,
    educationSummary: pick("educationSummary", "education_summary"),
    headline: obj.headline,
    phone: obj.phone,
    locationCity: pick("locationCity", "location_city"),
    locationCountry: pick("locationCountry", "location_country"),
    availability: obj.availability,
    workAuthorization: pick("workAuthorization", "work_authorization"),
    linkedinUrl: pick("linkedinUrl", "linkedin_url"),
    githubUrl: pick("githubUrl", "github_url"),
    portfolioUrl: pick("portfolioUrl", "portfolio_url"),
    nationalId: pick("nationalId", "national_id"),
    timezone: obj.timezone,
  };
}

export function normalizeKitFillRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const profile = normalizeProfile(obj.profile);
  const skills = asStringArray(obj.skills);
  const evidence = asObjectArray(obj.evidence)?.map(normalizeEvidence).filter((item) => item.title);
  const links = asObjectArray(obj.links)?.map(normalizeLink).filter((item) => item.url);

  return {
    ...(profile ? { profile } : {}),
    ...(skills ? { skills } : {}),
    ...(evidence && evidence.length > 0 ? { evidence } : {}),
    ...(links && links.length > 0 ? { links } : {}),
  };
}

export function normalizeDocumentExtractionRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const evidence = asObjectArray(obj.evidence)?.map(normalizeEvidence).filter((item) => item.title) ?? [];
  const skills = asStringArray(obj.skills) ?? [];
  const links = asObjectArray(obj.links)?.map(normalizeLink).filter((item) => item.url) ?? [];

  return {
    displayName: obj.displayName ?? obj.display_name ?? null,
    headline: obj.headline ?? null,
    phone: obj.phone ?? null,
    locationCity: obj.locationCity ?? obj.location_city ?? null,
    locationCountry: obj.locationCountry ?? obj.location_country ?? null,
    links,
    skills,
    evidence,
  };
}
