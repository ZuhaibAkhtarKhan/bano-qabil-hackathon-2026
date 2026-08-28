import { deriveYearOfStudy, extractYearsFromText, type MemoryValue } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";

function detectStanding(value: string): string | null {
  const lower = value.toLowerCase();
  if (/\bfreshman\b|\bfirst year\b|\b1st(?:\s*year)?\b|\byear 1\b|\byear one\b/.test(lower)) return "1st year";
  if (/\bsophomore\b|\bsecond year\b|\b2nd(?:\s*year)?\b|\byear 2\b|\byear two\b/.test(lower)) return "2nd year";
  if (/\bjunior\b|\bthird year\b|\b3rd(?:\s*year)?\b|\byear 3\b|\byear three\b/.test(lower)) return "3rd year";
  if (/\bsenior\b|\bfourth year\b|\b4th(?:\s*year)?\b|\byear 4\b|\byear four\b|\bfinal year\b/.test(lower)) return "4th year";
  if (/\b5th(?:\s*year)?\b|\bfifth year\b/.test(lower)) return "5th year";
  if (/\bgraduate[ds]?\b|\bpost\s*graduat|\bmaster'?s\b|\bpostgraduate\b|\bphd\b/.test(lower)) return "Graduated / Post Graduated";
  return null;
}

function detectDegree(value: string): string | null {
  const lower = value.toLowerCase();
  if (/\bphd\b|\bdoctorate\b|\bdoctoral\b/.test(lower)) return "PhD";
  if (/\bmaster'?s\b|\bm\.?s\.?\b|\bm\.?a\.?\b|\bmsc\b|\bmba\b/.test(lower)) return "Master's";
  if (/\bbachelor'?s?\b|\bundergrad\b|\bb\.?s\.?\b|\bb\.?a\.?\b|\bbsc\b|\bbtech\b|\bbe\b/.test(lower)) return "Bachelor's";
  return null;
}

function pickInstitutionName(value: string): string | null {
  const parts = value
    .split(/\s*[—\-|,:]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (/^(education|employment|project|leadership|research|volunteering|achievement|certification)$/i.test(part)) continue;
    if (/^\d{4}/.test(part)) continue;
    if (/university|college|institute|school|academy|giki|nust|lums|fast\b|iba\b|pieas|itu\b/i.test(part)) {
      return part.length > 120 ? part.slice(0, 120) : part;
    }
  }
  // Short education fact values are usually the school name (e.g. "GIKI").
  if (value.trim().length > 0 && value.trim().length <= 64 && !/^\d{4}/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

export async function loadMemoryCatalog(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
): Promise<MemoryValue[]> {
  const [{ data: profile }, { data: facts }, { data: answers }, { data: questions }, { data: evidence }, { data: skills }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "display_name, email, phone, headline, location_city, location_country, linkedin_url, github_url, portfolio_url, availability, work_authorization, preferences",
        )
        .eq("id", actor.userId)
        .maybeSingle(),
      supabase.from("profile_facts").select("category, value, verification_status, fact_key").eq("user_id", actor.userId),
      supabase
        .from("application_answers")
        .select("question_id, approved_text, original_ai_text, user_edited_text")
        .eq("application_id", applicationId)
        .eq("user_id", actor.userId),
      supabase.from("applications").select("opportunity_id").eq("id", applicationId).eq("user_id", actor.userId).maybeSingle(),
      supabase
        .from("evidence_items")
        .select("title, organization, outcome, situation, action, skills, kind, verification_status, excluded_from_ai, start_date, end_date")
        .eq("user_id", actor.userId)
        .limit(40),
      supabase.from("skills").select("name").eq("user_id", actor.userId).limit(80),
    ]);

  const catalog: MemoryValue[] = [];
  const add = (path: string, value: string | null | undefined, aliases: string[], source = "Application Memory") => {
    if (!value?.trim()) return;
    catalog.push({ path, source, value: value.trim(), aliases });
  };

  const preferences =
    profile?.preferences && typeof profile.preferences === "object"
      ? (profile.preferences as Record<string, unknown>)
      : {};
  const university = typeof preferences.university === "string" ? preferences.university : "";
  const educationSummary = typeof preferences.educationSummary === "string" ? preferences.educationSummary : "";

  add("Profile → Full name", profile?.display_name, ["name", "full name"]);
  add("Profile → Email", profile?.email, ["email"]);
  add("Profile → Phone", profile?.phone, ["phone", "mobile", "whatsapp", "telephone", "contact", "contact number", "contact no"]);
  add("Profile → Location", [profile?.location_city, profile?.location_country].filter(Boolean).join(", "), [
    "location",
    "city",
    "state",
    "delhi ncr",
    "country",
    "place",
    "residence",
    "address",
  ]);
  add("Profile → GitHub", profile?.github_url, ["github", "link", "url", "portfolio"]);
  add("Profile → LinkedIn", profile?.linkedin_url, ["linkedin", "link", "url", "sample", "writing sample"]);
  add("Profile → Portfolio", profile?.portfolio_url, ["portfolio", "website", "link", "url", "writing sample", "work sample"]);
  add("Profile → Headline", profile?.headline, ["headline", "about", "summary"], "Profile");
  add(
    "Profile → Availability",
    profile?.availability,
    ["availability", "available", "start date", "when can you start"],
    "Profile",
  );
  add(
    "Profile → Work authorization",
    profile?.work_authorization,
    ["work authorization", "visa", "eligible to work", "right to work", "sponsorship"],
    "Profile",
  );

  const display = profile?.display_name?.trim() ?? "";
  const [first, ...rest] = display.split(/\s+/);
  add("Profile → First name", first, ["first name"]);
  add("Profile → Last name", rest.join(" ") || null, ["last name"]);

  const addYearOfStudy = (years: number[], source: string, explicit?: string | null) => {
    if (explicit) {
      add(
        "Education → Year of study",
        explicit,
        ["year", "year of study", "class standing", "1st", "2nd", "3rd", "4th", "5th"],
        source,
      );
    }
    const derived = deriveYearOfStudy(years);
    if (derived) {
      add(
        "Education → Year of study",
        derived,
        ["year", "year of study", "class standing", "1st", "2nd", "3rd", "4th", "5th", "graduated"],
        source,
      );
    }
  };

  const addEducationBlob = (value: string, source: string, hints?: { institution?: string | null; course?: string | null; years?: number[] }) => {
    add("Education → Detail", value, ["education", "university", "college", "school", "student"], source);

    const institution = hints?.institution?.trim() || pickInstitutionName(value);
    if (institution) {
      add("Education → Institution", institution, ["university", "college", "school", "institution", "campus", "uni"], source);
    } else if (/giki|nust|lums|fast|iba|pieas/i.test(value)) {
      const named = value.match(/\b(GIKI|NUST|LUMS|FAST|IBA|PIEAS)\b/i)?.[1];
      if (named) add("Education → Institution", named, ["university", "college", "school", "institution", "campus", "uni"], source);
    }

    if (hints?.course?.trim()) {
      add("Education → Course", hints.course.trim(), ["course", "major", "minor", "programme", "program", "field of study"], source);
    }

    const standing = detectStanding(value);
    const years = [...(hints?.years ?? []), ...extractYearsFromText(value)];
    addYearOfStudy(years, source, standing);

    const degree = detectDegree(value);
    if (degree) {
      add("Education → Degree", degree, ["degree", "qualification", "bachelor", "master", "phd"], source);
    }
    if (years.length) {
      const latest = Math.max(...years);
      add("Education → Graduation year", String(latest), ["graduation", "grad year", "class of", "expected graduation"], source);
    }
  };

  if (university.trim()) {
    addEducationBlob(university, "Your kit");
  }
  if (educationSummary.trim()) {
    addEducationBlob(educationSummary, "Your kit");
  }

  const sortedFacts = [...(facts ?? [])].sort((a, b) => {
    const av = a.verification_status === "verified" ? 0 : 1;
    const bv = b.verification_status === "verified" ? 0 : 1;
    return av - bv;
  });

  for (const fact of sortedFacts) {
    if (fact.verification_status === "rejected") continue;
    const raw = fact.value;
    const value =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object" && "text" in (raw as object)
          ? String((raw as { text: unknown }).text ?? "")
          : JSON.stringify(raw);
    if (!value.trim()) continue;
    const source = fact.verification_status === "verified" ? "Verified fact" : "Unverified fact";
    const factKey = String(fact.fact_key ?? "").toLowerCase();
    const labelHint =
      raw && typeof raw === "object" && "label" in (raw as object)
        ? String((raw as { label?: unknown }).label ?? "")
        : "";

    if (fact.category === "education") {
      addEducationBlob(value, source);
      continue;
    }
    if (fact.category === "skills") {
      add("Skills → Fact", value, ["skill", "skills", "technology", "tools"], source);
      continue;
    }
    if (fact.category === "answers") {
      const prompt = labelHint.trim() || "Saved answer";
      add(`Saved answer → ${prompt.slice(0, 48)}`, value, [prompt.toLowerCase().slice(0, 80), "motivation", "why", "essay", "cover letter"], source);
      continue;
    }
    if (fact.category === "personal" || /phone|mobile|whatsapp|cnic|nic|birth|dob/.test(factKey) || /birth|dob/i.test(labelHint)) {
      if (/cnic|nic|nadra|identity/.test(factKey) || /^\d{5}-?\d{7}-?\d$/.test(value.replace(/\s/g, ""))) {
        add("Profile → CNIC", value, ["cnic", "nic", "national identity", "identity card"], source);
      } else if (/phone|mobile|whatsapp|cell|contact/.test(factKey) || /^\+?[\d\s-]{10,}$/.test(value)) {
        add("Profile → Phone", value, ["phone", "mobile", "whatsapp", "telephone"], source);
      } else if (
        /birth|dob/.test(factKey) ||
        /date of birth|birthdate|\bdob\b/i.test(labelHint) ||
        /date of birth|birthdate|\bdob\b/i.test(value)
      ) {
        add("Profile → Date of birth", value, ["date of birth", "birthdate", "dob", "birthday"], source);
      }
    }
    add(`Fact → ${fact.category}`, value, [String(fact.category), "profile fact"], source);
  }

  let prompts: Array<{ id: string; prompt: string }> = [];
  if (questions?.opportunity_id) {
    const { data } = await supabase
      .from("opportunity_questions")
      .select("id, prompt")
      .eq("opportunity_id", questions.opportunity_id);
    prompts = (data ?? []) as Array<{ id: string; prompt: string }>;
  }

  const promptById = new Map(prompts.map((item) => [item.id, item.prompt]));
  for (const row of answers ?? []) {
    const prompt = promptById.get(row.question_id as string) ?? "application question";
    const text = (row.approved_text || row.user_edited_text || row.original_ai_text || "").trim();
    if (!text) continue;
    const source = row.approved_text ? "Approved answer" : row.user_edited_text ? "Edited draft" : "AI draft";
    add("Approved Application Answer", text, ["why are you interested", "motivation", "cover letter", "personal statement", "why join"], source);
    add(`Answer → ${prompt.slice(0, 40)}`, text, [prompt.toLowerCase().slice(0, 40)], source);
    addEducationBlob(text, source);
  }

  for (const row of evidence ?? []) {
    if (row.excluded_from_ai) continue;
    const years = extractYearsFromText([row.start_date, row.end_date, row.title, row.organization, row.outcome].filter(Boolean).join(" "));
    const value = [
      row.kind,
      row.title,
      row.organization,
      row.situation,
      row.action,
      row.outcome,
      Array.isArray(row.skills) ? row.skills.join(", ") : "",
      row.start_date,
      row.end_date,
    ]
      .filter(Boolean)
      .join(" — ");
    if (!value.trim()) continue;
    const source = "Evidence";
    add(`Evidence → ${(row.title as string | null)?.slice(0, 40) || "item"}`, value, ["experience", "project", "achievement", "degree", "years"], source);
    if (row.kind === "education" || /education|university|college|degree|student|giki/i.test(value)) {
      addEducationBlob(value, source, {
        institution: typeof row.organization === "string" ? row.organization : null,
        course: typeof row.title === "string" ? row.title : null,
        years,
      });
    }
    if (Array.isArray(row.skills)) {
      for (const skill of row.skills) {
        if (typeof skill === "string" && skill.trim()) {
          add("Skills → Evidence", skill.trim(), ["skill", "skills", "technology"], source);
        }
      }
    }
  }

  for (const skill of skills ?? []) {
    const name = typeof skill.name === "string" ? skill.name.trim() : "";
    if (!name) continue;
    add("Skills → Kit", name, ["skill", "skills", "technology", "tools"], "Your kit");
  }

  return catalog;
}
