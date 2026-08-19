import type { MemoryValue } from "@1apply/form-engine";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Actor } from "@/auth/actor";

export async function loadMemoryCatalog(
  supabase: SupabaseClient,
  actor: Actor,
  applicationId: string,
): Promise<MemoryValue[]> {
  const [{ data: profile }, { data: facts }, { data: answers }, { data: questions }] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, email, phone, headline, location_city, location_country, linkedin_url, github_url, portfolio_url")
      .eq("id", actor.userId)
      .maybeSingle(),
    supabase.from("profile_facts").select("category, value, verification_status").eq("user_id", actor.userId),
    supabase
      .from("application_answers")
      .select("question_id, approved_text")
      .eq("application_id", applicationId)
      .eq("user_id", actor.userId),
    supabase.from("applications").select("opportunity_id").eq("id", applicationId).eq("user_id", actor.userId).maybeSingle(),
  ]);

  const catalog: MemoryValue[] = [];
  const add = (path: string, value: string | null | undefined, aliases: string[], source = "Application Memory") => {
    if (!value?.trim()) return;
    catalog.push({ path, source, value: value.trim(), aliases });
  };

  add("Profile → Full name", profile?.display_name, ["name", "full name"]);
  add("Profile → Email", profile?.email, ["email"]);
  add("Profile → Phone", profile?.phone, ["phone"]);
  add("Profile → Location", [profile?.location_city, profile?.location_country].filter(Boolean).join(", "), ["location", "city"]);
  add("Profile → GitHub", profile?.github_url, ["github"]);
  add("Profile → LinkedIn", profile?.linkedin_url, ["linkedin"]);
  add("Profile → Portfolio", profile?.portfolio_url, ["portfolio", "website"]);

  const display = profile?.display_name?.trim() ?? "";
  const [first, ...rest] = display.split(/\s+/);
  add("Profile → First name", first, ["first name"]);
  add("Profile → Last name", rest.join(" ") || null, ["last name"]);

  for (const fact of facts ?? []) {
    if (fact.verification_status !== "verified") continue;
    const value = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
    if (fact.category === "education") {
      add("Education → Institution", value, ["university", "school"], "Verified fact");
    }
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
  const approved = (answers ?? []).find((row) => row.approved_text);
  if (approved?.approved_text) {
    add(
      "Approved Application Answer",
      approved.approved_text,
      ["why are you interested", "motivation", "cover letter", "personal statement"],
      "Approved answer",
    );
  }
  for (const row of answers ?? []) {
    const prompt = promptById.get(row.question_id as string);
    if (row.approved_text && prompt) {
      add(`Answer → ${prompt.slice(0, 40)}`, row.approved_text, [prompt.toLowerCase().slice(0, 40)], "Approved answer");
    }
  }

  return catalog;
}
