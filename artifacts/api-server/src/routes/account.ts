import { createClient } from "@supabase/supabase-js";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

function configuredClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_CONFIGURATION_MISSING");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function authenticatedUser(req: { headers: { authorization?: string } }, res: { status: (value: number) => { json: (body: unknown) => void } }) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) { res.status(401).json({ error: "Authentication is required." }); return null; }
  const { data, error } = await configuredClient().auth.getUser(token);
  if (error || !data.user) { res.status(401).json({ error: "Your session is no longer valid." }); return null; }
  return data.user;
}

router.get("/account/export", async (req, res): Promise<void> => {
  try {
    const user = await authenticatedUser(req, res);
    if (!user) return;
    const supabase = configuredClient();
    const [profile, opportunities, applications, documents, facts, evidence, questions] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("opportunities").select("*").eq("user_id", user.id),
      supabase.from("applications").select("*").eq("user_id", user.id),
      supabase.from("documents").select("*,document_versions(*)").eq("user_id", user.id),
      supabase.from("profile_facts").select("*").eq("user_id", user.id),
      supabase.from("evidence_items").select("*").eq("user_id", user.id),
      supabase.from("application_questions").select("*,answer_versions(*)").eq("user_id", user.id),
    ]);
    const error = [profile, opportunities, applications, documents, facts, evidence, questions].find((item) => item.error)?.error;
    if (error) throw error;
    res.setHeader("content-disposition", `attachment; filename="1apply-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.type("application/json").send(JSON.stringify({ exported_at: new Date().toISOString(), profile: profile.data, opportunities: opportunities.data, applications: applications.data, documents: documents.data, profile_facts: facts.data, evidence: evidence.data, questions: questions.data }, null, 2));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Export could not be created." });
  }
});

router.delete("/account", async (req, res): Promise<void> => {
  try {
    const user = await authenticatedUser(req, res);
    if (!user) return;
    if (req.body?.confirmEmail !== user.email) { res.status(400).json({ error: "Enter your account email exactly to confirm deletion." }); return; }
    const supabase = configuredClient();
    const { data: versions, error: versionsError } = await supabase.from("document_versions").select("storage_path").eq("user_id", user.id);
    if (versionsError) throw versionsError;
    const paths = (versions ?? []).map((version) => version.storage_path).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const { error: storageError } = await supabase.storage.from("application-documents").remove(paths);
      if (storageError) throw storageError;
    }
    const { error } = await supabase.from("profiles").delete().eq("id", user.id);
    if (error) throw error;
    const { error: authError } = await supabase.auth.admin.deleteUser(user.id);
    if (authError) throw authError;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Account deletion could not be completed." });
  }
});

export default router;