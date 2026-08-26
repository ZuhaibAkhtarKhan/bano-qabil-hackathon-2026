/**
 * Built-in resume categories for user remembrance only.
 * Job matching scores every resume with AI and must not filter by these keys.
 * Keep "other" as a separate freeform option in the upload UI — not in this list.
 */
export const RESUME_CATEGORY_PRESETS = [
  { key: "general", label: "General / all-purpose" },
  { key: "fresh_graduate", label: "Fresh graduate / internship" },
  { key: "software_engineering", label: "Software engineering" },
  { key: "frontend", label: "Frontend" },
  { key: "backend", label: "Backend" },
  { key: "full_stack", label: "Full stack" },
  { key: "mern_stack", label: "MERN stack" },
  { key: "mobile", label: "Mobile (Android / iOS)" },
  { key: "devops", label: "DevOps" },
  { key: "cloud", label: "Cloud / AWS / Azure" },
  { key: "data_science", label: "Data science" },
  { key: "machine_learning", label: "Machine learning / AI" },
  { key: "cybersecurity", label: "Cybersecurity" },
  { key: "qa_testing", label: "QA / testing" },
  { key: "ui_ux", label: "UI / UX design" },
  { key: "product_management", label: "Product management" },
  { key: "business_marketing", label: "Business / marketing" },
  { key: "finance_accounting", label: "Finance / accounting" },
  { key: "research_academia", label: "Research / academia" },
  { key: "scholarship", label: "Scholarship / fellowship" },
] as const;

export type ResumeCategoryPresetKey = (typeof RESUME_CATEGORY_PRESETS)[number]["key"] | "other";

export type ResolvedResumeCategory = {
  key: string;
  label: string;
};

const PRESET_BY_KEY = new Map(RESUME_CATEGORY_PRESETS.map((item) => [item.key, item.label]));

function slugifyCategory(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Category is for user remembrance only — matching must score every resume.
 */
export function resolveResumeCategory(input: {
  preset?: string | null;
  otherLabel?: string | null;
}): ResolvedResumeCategory | null {
  const preset = String(input.preset ?? "").trim().toLowerCase();
  if (!preset) return null;

  if (preset === "other") {
    const label = String(input.otherLabel ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!label) return null;
    const key = `other_${slugifyCategory(label)}`;
    if (!key || key === "other_") return null;
    return { key, label };
  }

  const label = PRESET_BY_KEY.get(preset as (typeof RESUME_CATEGORY_PRESETS)[number]["key"]);
  if (!label) return null;
  return { key: preset, label };
}

export function resumeCategoryDisplayLabel(categoryKey: string | null | undefined, fallbackLabel?: string | null) {
  if (!categoryKey) return fallbackLabel?.trim() || "Uncategorized";
  const preset = PRESET_BY_KEY.get(categoryKey as (typeof RESUME_CATEGORY_PRESETS)[number]["key"]);
  if (preset) return preset;
  if (categoryKey.startsWith("other_")) {
    return fallbackLabel?.trim() || categoryKey.replace(/^other_/, "").replace(/_/g, " ");
  }
  if (categoryKey.startsWith("legacy-")) return fallbackLabel?.trim() || "Uncategorized";
  return fallbackLabel?.trim() || categoryKey.replace(/_/g, " ");
}
