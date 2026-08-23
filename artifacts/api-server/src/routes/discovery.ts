import { createClient } from "@supabase/supabase-js";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const catalog = [
  ["Google Summer of Code", "Google Open Source", "internship", "Remote", true, "https://summerofcode.withgoogle.com/", "Mentored open-source internships for students and beginners.", 86],
  ["Outreachy Internships", "Outreachy", "internship", "Remote", true, "https://www.outreachy.org/", "Paid remote internships in open source and open science.", 84],
  ["MLH Fellowship", "Major League Hacking", "fellowship", "Remote", true, "https://fellowship.mlh.io/", "Remote software engineering fellowship.", 78],
  ["DAAD scholarships", "DAAD", "scholarship", "Germany", false, "https://www.daad.de/en/studying-in-germany/scholarships/", "Official scholarship overview for study and research in Germany.", 82],
  ["Kaggle competitions", "Kaggle", "hackathon", "Remote", true, "https://www.kaggle.com/competitions", "Official machine learning competitions index.", 70],
  ["Hugging Face jobs", "Hugging Face", "job", "Remote", true, "https://huggingface.co/jobs", "Official jobs board for AI and machine-learning roles.", 76],
  ["UN Careers job search", "United Nations", "internship", "Remote", true, "https://careers.un.org/jobsearch", "Official careers search for internships and job listings.", 74],
  ["Internshala internships in Pakistan", "Internshala", "internship", "Pakistan", false, "https://www.internshala.com/internships/internship-in-pakistan/", "Official index for internships in Pakistan; verify individual postings.", 48],
] as const;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_CONFIGURATION_MISSING");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function userFrom(req: { headers: { authorization?: string } }, res: { status: (value: number) => { json: (body: unknown) => void } }) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, ""); if (!token) { res.status(401).json({ error: "Authentication is required." }); return null; }
  const { data } = await client().auth.getUser(token); if (!data.user) { res.status(401).json({ error: "Your session is no longer valid." }); return null; } return data.user;
}
function tokens(value: string) { return value.toLowerCase().match(/[a-z0-9+#.-]{3,}/g) ?? []; }

router.post("/discovery", async (req, res): Promise<void> => {
  try {
    const user = await userFrom(req, res); if (!user) return;
    const query = String(req.body?.query ?? "").trim(); if (!query) { res.status(400).json({ error: "A search query is required." }); return; }
    const supabase = client(); const { data: facts } = await supabase.from("profile_facts").select("value").eq("user_id", user.id).eq("verification_status", "verified");
    const queryTerms = tokens(query); const evidenceTerms = tokens(JSON.stringify(facts ?? []));
    const { data: request, error: requestError } = await supabase.from("discovery_requests").insert({ user_id: user.id, query, status: "processing", filters: {} }).select("id").single();
    if (requestError || !request) throw requestError ?? new Error("Discovery request could not be created.");
    const ranked = catalog.map(([title, organization, category, location, remote, sourceUrl, excerpt, quality]) => {
      const blob = `${title} ${organization} ${category} ${location} ${excerpt}`;
      const relevance = Math.round((queryTerms.filter((term) => blob.toLowerCase().includes(term)).length / Math.max(1, queryTerms.length)) * 100);
      const fit = evidenceTerms.length ? Math.round((evidenceTerms.filter((term) => blob.toLowerCase().includes(term)).length / evidenceTerms.length) * 100) : null;
      const rank = Math.round(quality * 0.25 + relevance * 0.55 + (fit ?? 35) * 0.2 + (remote && query.toLowerCase().includes("remote") ? 8 : 0));
      return { title, organization, category, location, remote, sourceUrl, excerpt, quality, relevance, fit, rank };
    }).filter((item) => item.relevance > 0 || queryTerms.length === 0).sort((a, b) => b.rank - a.rank);
    const { error: resultsError } = await supabase.from("discovery_results").insert(ranked.map((item) => ({ user_id: user.id, request_id: request.id, provider: "program_catalog", source_url: item.sourceUrl, canonical_url: item.sourceUrl, title: item.title, organization: item.organization, category: item.category, location: item.location, remote: item.remote, excerpt: item.excerpt, quality: item.quality, rank_score: item.rank, relevance: item.relevance, fit_preview: item.fit, reasons: item.fit === null ? ["Fit preview unavailable until verified evidence exists."] : ["Fit preview based only on verified application-memory facts."], requirements: [] })));
    if (resultsError) throw resultsError;
    await supabase.from("discovery_requests").update({ status: "completed", result_summary: `${ranked.length} official-source results`, completed_at: new Date().toISOString() }).eq("id", request.id);
    res.json({ count: ranked.length });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Discovery could not run." }); }
});

export default router;