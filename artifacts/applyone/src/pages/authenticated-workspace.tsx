import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell,
  BriefcaseBusiness,
  Check,
  FileText,
  FolderSearch,
  Library,
  Link2,
  Menu,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { WORKSPACE_NAV, isNavActive } from "@/components/app/nav";
import { cn } from "@/lib/cn";
import { extractDocumentText } from "@/lib/document-extract";
import { supabase } from "@/lib/supabase";
import { useSupabaseAuth } from "@/lib/supabase-auth";

type Opportunity = { id: string; company: string; role: string; source: string; fit: number; deadline: string | null; stage: string; category: string; sourceUrl?: string | null };
type Application = { id: string; company: string; role: string; stage: string; fit: number; deadline?: string | null; category: string; persona?: string | null };
type Document = { id: string; title: string; kind: string; version: string; updatedAt: string; expiresAt?: string | null };
type DiscoveryResult = { id: string; title: string; organization: string | null; category: string; excerpt: string; sourceUrl: string; rankScore: number; fitPreview: number | null; alreadySaved: boolean };
type Workspace = { opportunities: Opportunity[]; applications: Application[]; documents: Document[]; memory: string; discoveryResults: DiscoveryResult[] };

const emptyWorkspace: Workspace = { opportunities: [], applications: [], documents: [], memory: "", discoveryResults: [] };

function sectionForPath(pathname: string) {
  if (pathname.includes("/opportunities")) return "opportunities";
  if (pathname.includes("/applications")) return "applications";
  if (pathname.includes("/documents") || pathname.includes("/resumes")) return "documents";
  if (pathname.includes("/memory")) return "memory";
  if (pathname.includes("/notifications")) return "notifications";
  if (pathname.includes("/integrations")) return "integrations";
  if (pathname.includes("/settings")) return "settings";
  return "dashboard";
}

export function AuthenticatedWorkspace() {
  const [location] = useLocation();
  const { user } = useSupabaseAuth();
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const section = sectionForPath(location);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      if (!user) throw new Error("Your Supabase session has expired. Please sign in again.");
      const [opportunitiesResult, applicationsResult, documentsResult, profileResult, discoveryResult] = await Promise.all([
        supabase.from("opportunities").select("id,title,organization,source,source_url,deadline_at,analysis_status,category").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("applications").select("id,status,deadline_at,persona,opportunities(title,organization,category),fit_evaluations(score)").eq("user_id", user.id).order("updated_at", { ascending: false }),
        supabase.from("documents").select("id,type,label,created_at,document_versions(version_label,expires_at)").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("profiles").select("headline").eq("id", user.id).maybeSingle(),
        supabase.from("discovery_results").select("id,title,organization,category,excerpt,source_url,rank_score,fit_preview,already_saved").eq("user_id", user.id).order("rank_score", { ascending: false }).limit(30),
      ]);
      const firstError = [opportunitiesResult, applicationsResult, documentsResult, profileResult, discoveryResult].find((result) => result.error)?.error;
      if (firstError) throw firstError;
      setWorkspace({
        opportunities: (opportunitiesResult.data ?? []).map((item) => ({ id: item.id, company: item.organization ?? "Unspecified organization", role: item.title, source: item.source, sourceUrl: item.source_url, fit: 0, deadline: item.deadline_at, stage: item.analysis_status, category: item.category })),
        applications: (applicationsResult.data ?? []).map((item) => {
          const opportunity = Array.isArray(item.opportunities) ? item.opportunities[0] : item.opportunities;
          const fit = Array.isArray(item.fit_evaluations) ? item.fit_evaluations[0] : item.fit_evaluations;
          return { id: item.id, company: opportunity?.organization ?? "Unspecified organization", role: opportunity?.title ?? "Application", stage: item.status, fit: fit?.score ?? 0, deadline: item.deadline_at, category: opportunity?.category ?? "other", persona: item.persona };
        }),
        documents: (documentsResult.data ?? []).map((item) => ({ id: item.id, title: item.label, kind: item.type, version: Array.isArray(item.document_versions) ? item.document_versions[0]?.version_label ?? "v1" : "v1", expiresAt: Array.isArray(item.document_versions) ? item.document_versions[0]?.expires_at : null, updatedAt: item.created_at })),
        memory: profileResult.data?.headline ?? "",
        discoveryResults: (discoveryResult.data ?? []).map((item) => ({ id: item.id, title: item.title, organization: item.organization, category: item.category, excerpt: item.excerpt, sourceUrl: item.source_url, rankScore: item.rank_score, fitPreview: item.fit_preview, alreadySaved: item.already_saved })),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load your workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, [user]);

  async function createOpportunity(data: { company: string; role: string; source: string; fit: number; deadline: string }) {
    if (!user) throw new Error("Your Supabase session has expired. Please sign in again.");
    const { data: opportunity, error } = await supabase.from("opportunities").insert({
      user_id: user.id,
      title: data.role,
      organization: data.company,
      source: "manual",
      category: "other",
      deadline_at: data.deadline || null,
      analysis_status: "needs_input",
    }).select("id").single();
    if (error || !opportunity) throw error ?? new Error("Could not save the opportunity.");
    const application = await supabase.from("applications").insert({
      user_id: user.id,
      opportunity_id: opportunity.id,
      status: "draft",
      deadline_at: data.deadline || null,
    }).select("id").single();
    if (application.error) throw application.error;
    setNotice("Opportunity saved to your private workspace.");
    await refresh();
  }

  async function createApplication(data: { company: string; role: string; fit: number; persona: string }) {
    if (!user) throw new Error("Your Supabase session has expired. Please sign in again.");
    const { data: opportunity, error: opportunityError } = await supabase.from("opportunities").insert({
      user_id: user.id,
      title: data.role,
      organization: data.company,
      source: "manual",
      category: "other",
      analysis_status: "needs_input",
    }).select("id").single();
    if (opportunityError || !opportunity) throw opportunityError ?? new Error("Could not create the opportunity.");
    const { error } = await supabase.from("applications").insert({ user_id: user.id, opportunity_id: opportunity.id, status: "draft", persona: data.persona });
    if (error) throw error;
    setNotice("Application draft created.");
    await refresh();
  }

  async function discover(query: string) {
    if (!user || !query.trim()) throw new Error("Describe the role, program, or opportunity you want to find.");
    const { data: session } = await supabase.auth.getSession();
    if (!session.session?.access_token) throw new Error("Your session has expired. Sign in again.");
    const response = await fetch("/api/discovery", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.session.access_token}` }, body: JSON.stringify({ query }) });
    if (!response.ok) throw new Error((await response.json()).error ?? "Discovery could not run.");
    const result = await response.json() as { count: number };
    setNotice(`${result.count} ranked official-source result${result.count === 1 ? "" : "s"} ready.`);
    await refresh();
  }

  async function saveDiscoveryResult(result: DiscoveryResult) {
    if (!user || result.alreadySaved) return;
    const { data: opportunity, error } = await supabase.from("opportunities").insert({ user_id: user.id, title: result.title, organization: result.organization, source: "discovery", source_url: result.sourceUrl, canonical_url: result.sourceUrl, category: result.category, analysis_status: "pending" }).select("id").single();
    if (error || !opportunity) throw error ?? new Error("Could not save this discovery result.");
    await supabase.from("discovery_results").update({ already_saved: true, opportunity_id: opportunity.id }).eq("id", result.id);
    setNotice("Discovery result saved to your opportunity queue.");
    await refresh();
  }

  async function createDocument(data: { file: File; kind: string; expiresAt: string }) {
    if (!user) throw new Error("Your Supabase session has expired. Please sign in again.");
    const text = await extractDocumentText(data.file);
    const documentId = crypto.randomUUID(); const versionId = crypto.randomUUID();
    const storagePath = `${user.id}/${documentId}/${versionId}-${data.file.name.replace(/[^\w.-]/g, "_")}`;
    const uploaded = await supabase.storage.from("application-documents").upload(storagePath, data.file, { contentType: data.file.type || "application/octet-stream", upsert: false });
    if (uploaded.error) throw uploaded.error;
    const { error: documentError } = await supabase.from("documents").insert({ id: documentId, user_id: user.id, type: data.kind, label: data.file.name.replace(/\.[^.]+$/, "") });
    if (documentError) throw documentError;
    const { error: versionError } = await supabase.from("document_versions").insert({ id: versionId, document_id: documentId, user_id: user.id, version_label: "v1", storage_path: storagePath, file_hash: `${data.file.name}:${data.file.size}:${data.file.lastModified}`, mime_type: data.file.type || "application/octet-stream", byte_size: data.file.size, status: "ready", expires_at: data.expiresAt || null });
    if (versionError) throw versionError;
    const chunks = text.trim().match(/[\s\S]{1,4000}/g) ?? [];
    if (chunks.length) {
      const { error: chunkError } = await supabase.from("document_chunks").insert(chunks.map((content, index) => ({ user_id: user.id, document_version_id: versionId, chunk_index: index, content })));
      if (chunkError) throw chunkError;
    }
    const factCandidates = text.split(/\n+/).map((line) => line.trim()).filter((line) => line.length >= 25).slice(0, 12);
    if (factCandidates.length) {
      const { error: factError } = await supabase.from("profile_facts").insert(factCandidates.map((value) => ({
        user_id: user.id,
        fact_type: "document_extraction",
        value: { text: value, document_id: documentId, document_version_id: versionId },
        source: "document_extract",
        confidence: 0.5,
        verification_status: "unverified",
      })));
      if (factError) throw factError;
    }
    const { error: currentError } = await supabase.from("documents").update({ current_version_id: versionId }).eq("id", documentId);
    if (currentError) throw currentError;
    setNotice(`Uploaded ${chunks.length ? `${chunks.length} text chunk${chunks.length === 1 ? "" : "s"}` : "an empty document"} and ${factCandidates.length} unverified fact candidate${factCandidates.length === 1 ? "" : "s"}.`);
    await refresh();
  }

  async function saveMemory(summary: string) {
    if (!user) throw new Error("Your Supabase session has expired. Please sign in again.");
    const { error } = await supabase.from("profiles").update({ headline: summary }).eq("id", user.id);
    if (error) throw error;
    setWorkspace((current) => ({ ...current, memory: summary }));
    setNotice("Application memory saved.");
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
        <Link href="/app"><Wordmark size="sm" /></Link>
        <Button variant="secondary" size="sm" onClick={() => setMenuOpen(true)}><Menu className="h-4 w-4" />Menu</Button>
      </header>
      <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[255px_minmax(0,1fr)]">
        <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-line bg-white px-4 py-6 transition-transform lg:static lg:w-auto lg:translate-x-0", menuOpen ? "translate-x-0" : "-translate-x-full")}>
          <div className="flex items-center justify-between px-2"><Link href="/app" onClick={() => setMenuOpen(false)}><Wordmark /></Link><button className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
          <p className="mt-3 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Application OS</p>
          <nav className="mt-8 grid gap-6" aria-label="Workspace">{WORKSPACE_NAV.map((group) => <div key={group.id}><p className="px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">{group.label}</p><div className="mt-2 grid gap-1">{group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition", isNavActive(location, href) ? "bg-canvas text-ink" : "text-ink-muted hover:bg-canvas hover:text-ink")}><Icon className="h-4 w-4" />{label}</Link>)}</div></div>)}</nav>
          <div className="mt-auto border-t border-line px-2 pt-4"><p className="truncate text-sm font-medium">{user?.user_metadata?.display_name ?? user?.email ?? "Your workspace"}</p><p className="mt-1 truncate text-xs text-ink-muted">{user?.email}</p><button onClick={() => void supabase.auth.signOut()} className="mt-3 text-sm text-ink-muted hover:text-ink">Sign out</button></div>
        </aside>
        {menuOpen && <button className="fixed inset-0 z-30 bg-ink/20 lg:hidden" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />}
        <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          {notice && <div className="mb-6 flex items-center justify-between rounded-2xl border border-mint-300 bg-mint-soft px-4 py-3 text-sm text-mint-text"><span className="flex items-center gap-2"><Check className="h-4 w-4" />{notice}</span><button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}
          {error && <div className="mb-6 rounded-2xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-text">{error}</div>}
          {loading ? <Loading /> : <WorkspacePage section={section} workspace={workspace} onOpportunity={createOpportunity} onApplication={createApplication} onDocument={createDocument} onMemory={saveMemory} onDiscover={discover} onSaveDiscovery={saveDiscoveryResult} />}
        </main>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">{eyebrow}</p><h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">{title}</h1><p className="mt-5 max-w-2xl text-sm leading-6 text-ink-muted">{body}</p></>;
}

function WorkspacePage({ section, workspace, onOpportunity, onApplication, onDocument, onMemory, onDiscover, onSaveDiscovery }: { section: string; workspace: Workspace; onOpportunity: (data: { company: string; role: string; source: string; fit: number; deadline: string }) => Promise<void>; onApplication: (data: { company: string; role: string; fit: number; persona: string }) => Promise<void>; onDocument: (data: { file: File; kind: string; expiresAt: string }) => Promise<void>; onMemory: (summary: string) => Promise<void>; onDiscover: (query: string) => Promise<void>; onSaveDiscovery: (result: DiscoveryResult) => Promise<void> }) {
  if (section === "opportunities") return <Opportunities items={workspace.opportunities} discoveryResults={workspace.discoveryResults} create={onOpportunity} discover={onDiscover} saveDiscovery={onSaveDiscovery} />;
  if (section === "applications") return <Applications items={workspace.applications} create={onApplication} />;
  if (section === "documents") return <Documents items={workspace.documents} create={onDocument} />;
  if (section === "memory") return <Memory summary={workspace.memory} save={onMemory} />;
  if (section === "settings") return <SettingsPage />;
  if (section === "notifications" || section === "integrations") return <AccountPlaceholder section={section} />;
  return <Dashboard workspace={workspace} create={onOpportunity} />;
}

function Dashboard({ workspace, create }: { workspace: Workspace; create: (data: { company: string; role: string; source: string; fit: number; deadline: string }) => Promise<void> }) {
  return <div><PageIntro eyebrow="Private workspace" title="Keep the signal, lose the scramble." body="Your application data is saved to your account and is visible only after a secure sign-in." /><div className="mt-9 grid gap-4 sm:grid-cols-3">{[[workspace.applications.length, "Active applications", BriefcaseBusiness], [workspace.opportunities.length, "Saved opportunities", FolderSearch], [workspace.documents.length, "Documents tracked", Library]].map(([number, label, Icon]) => { const MetricIcon = Icon as typeof BriefcaseBusiness; return <div key={label as string} className="rounded-2xl border border-line bg-white p-5"><MetricIcon className="h-5 w-5 text-mint-text" /><p className="mt-5 font-display text-4xl">{number as number}</p><p className="mt-1 text-sm text-ink-muted">{label as string}</p></div>; })}</div><div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_360px]"><section className="rounded-3xl border border-line bg-white p-6 sm:p-8"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Opportunity queue</p><h2 className="mt-2 font-display text-3xl">What deserves attention next.</h2><div className="mt-6 divide-y divide-line">{workspace.opportunities.length ? workspace.opportunities.slice(0, 4).map((item) => <OpportunityRow key={item.id} item={item} />) : <p className="py-6 text-sm text-ink-muted">No saved opportunities yet. Capture one on the right to begin.</p>}</div></section><QuickCapture create={create} /></div></div>;
}

function QuickCapture({ create }: { create: (data: { company: string; role: string; source: string; fit: number; deadline: string }) => Promise<void> }) {
  const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); setError(null); try { await create({ company, role, source: "Manual save", fit: 0, deadline: "" }); setCompany(""); setRole(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the opportunity."); } finally { setPending(false); } }
  return <section className="rounded-3xl bg-obsidian p-6 text-white sm:p-8"><Plus className="h-5 w-5 text-mint" /><p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Quick capture</p><h2 className="mt-2 font-display text-3xl">Save a lead while it’s fresh.</h2><form onSubmit={submit} className="mt-5 grid gap-3"><input required value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Organization" className="h-10 rounded-xl border border-white/20 bg-white/10 px-3 text-sm outline-none placeholder:text-zinc-400" /><input required value={role} onChange={(event) => setRole(event.target.value)} placeholder="Role or program" className="h-10 rounded-xl border border-white/20 bg-white/10 px-3 text-sm outline-none placeholder:text-zinc-400" />{error && <p className="text-xs text-rose-300">{error}</p>}<Button variant="inverse" type="submit" disabled={pending}>{pending ? "Saving…" : "Save opportunity"}</Button></form></section>;
}

function Opportunities({ items, discoveryResults, create, discover, saveDiscovery }: { items: Opportunity[]; discoveryResults: DiscoveryResult[]; create: (data: { company: string; role: string; source: string; fit: number; deadline: string }) => Promise<void>; discover: (query: string) => Promise<void>; saveDiscovery: (result: DiscoveryResult) => Promise<void> }) {
  const [query, setQuery] = useState(""); const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [pending, setPending] = useState(false);
  const visible = useMemo(() => items.filter((item) => `${item.company} ${item.role}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); try { await create({ company, role, source: "Manual save", fit: 0, deadline: "" }); setCompany(""); setRole(""); } finally { setPending(false); } }
  async function runDiscovery(event: FormEvent) { event.preventDefault(); setPending(true); try { await discover(query); } finally { setPending(false); } }
  return <div><PageIntro eyebrow="Discover" title="Opportunities with context." body="Search your growing opportunity index, inspect rank and Fit previews, then save only the leads worth pursuing." />
    <form onSubmit={runDiscovery} className="mt-8 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row"><label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-canvas px-3"><Search className="h-4 w-4 text-ink-muted" /><input required value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="e.g. remote data internship or engineering scholarship" /></label><Button disabled={pending}>{pending ? "Ranking…" : "Search & rank"}</Button></form>
    <div className="mt-5 grid gap-4">{discoveryResults.length ? discoveryResults.map((result) => <article key={result.id} className="rounded-2xl border border-line bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><p className="font-medium">{result.title}</p><p className="mt-1 text-sm text-ink-muted">{result.organization ?? "Unknown organization"} · {result.category}</p><p className="mt-3 text-sm text-ink-muted">{result.excerpt || "No source excerpt available."}</p></div><div className="flex shrink-0 items-start gap-2"><span className="rounded-full bg-mint-soft px-3 py-1 text-xs text-mint-text">{result.fitPreview ? `${result.fitPreview}% Fit` : `${result.rankScore}% match`}</span><Button size="sm" variant={result.alreadySaved ? "secondary" : undefined} disabled={result.alreadySaved} onClick={() => void saveDiscovery(result)}>{result.alreadySaved ? "Saved" : "Save result"}</Button></div></div></article>) : <Empty title="Search results will appear here." body="Search terms are ranked against the opportunities already in your private index. Imported discovery providers can add more sources as they are connected." />}</div>
    <div className="mt-10 flex flex-col gap-4 lg:flex-row"><form onSubmit={submit} className="grid flex-1 gap-2 rounded-2xl border border-line bg-white p-4 sm:grid-cols-[1fr_1fr_auto]"><input required value={company} onChange={(event) => setCompany(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm" placeholder="Organization" /><input required value={role} onChange={(event) => setRole(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm" placeholder="Role or program" /><Button disabled={pending}>{pending ? "Saving…" : "Save lead"}</Button></form></div>
    <h2 className="mt-10 font-display text-3xl">Saved opportunity queue</h2><div className="mt-4 grid gap-4">{visible.map((item) => <div key={item.id} className="rounded-2xl border border-line bg-white p-5 sm:p-6"><OpportunityRow item={item} expanded /></div>)}{!visible.length && <Empty title="No saved opportunities match." body="Add a lead above to grow your search index." />}</div></div>;
}

function Applications({ items, create }: { items: Application[]; create: (data: { company: string; role: string; fit: number; persona: string }) => Promise<void> }) {
  const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [persona, setPersona] = useState("technical"); const [status, setStatus] = useState("all"); const [category, setCategory] = useState("all"); const [pending, setPending] = useState(false);
  const visible = items.filter((item) => (status === "all" || item.stage === status) && (category === "all" || item.category === category));
  const columns = ["draft", "preparing", "ready", "submitted"] as const;
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); try { await create({ company, role, fit: 0, persona }); setCompany(""); setRole(""); } finally { setPending(false); } }
  return <div><PageIntro eyebrow="Operate" title="Applications in motion." body="Group work by status, filter the queue, and select the storytelling angle that should guide each draft." />
    <form onSubmit={submit} className="mt-8 grid gap-2 rounded-2xl border border-line bg-white p-4 lg:grid-cols-[1fr_1fr_180px_auto]"><input required value={company} onChange={(event) => setCompany(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm" placeholder="Organization" /><input required value={role} onChange={(event) => setRole(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm" placeholder="Role" /><select value={persona} onChange={(event) => setPersona(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm"><option value="technical">Technical</option><option value="academic">Academic</option><option value="leadership">Leadership</option><option value="impact">Impact</option></select><Button disabled={pending}>{pending ? "Creating…" : "Create draft"}</Button></form>
    <div className="mt-5 flex flex-wrap gap-2"><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-line bg-white px-3 text-sm"><option value="all">All statuses</option>{columns.map((value) => <option key={value}>{value}</option>)}</select><select value={category} onChange={(event) => setCategory(event.target.value)} className="h-10 rounded-xl border border-line bg-white px-3 text-sm"><option value="all">All categories</option>{Array.from(new Set(items.map((item) => item.category))).map((value) => <option key={value}>{value}</option>)}</select></div>
    <div className="mt-6 grid gap-4 xl:grid-cols-4">{columns.map((column) => <section key={column} className="rounded-2xl border border-line bg-white/70 p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-medium capitalize">{column}</h2><span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-muted">{visible.filter((item) => item.stage === column).length}</span></div><div className="mt-4 grid gap-3">{visible.filter((item) => item.stage === column).map((item) => <article key={item.id} className="rounded-xl border border-line bg-white p-4"><p className="font-medium">{item.role}</p><p className="mt-1 text-sm text-ink-muted">{item.company}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-canvas px-2 py-1">{item.category}</span><span className="rounded-full bg-violet-soft px-2 py-1 text-violet-text">{item.persona ?? "No persona"}</span></div><p className="mt-3 text-xs text-ink-muted">{item.fit ? `${item.fit}% Fit` : "Fit pending"}</p></article>)}{!visible.some((item) => item.stage === column) && <p className="py-4 text-xs text-ink-muted">No applications</p>}</div></section>)}</div>
    {!visible.length && <div className="mt-6"><Empty title="No applications match these filters." body="Adjust the status or category filters, or create a new draft." /></div>}<PreviousAnswerSuggestions /></div>;
}

function PreviousAnswerSuggestions() {
  const { user } = useSupabaseAuth(); const [query, setQuery] = useState(""); const [answers, setAnswers] = useState<Array<{ id: string; text: string; prompt: string }>>([]);
  useEffect(() => { if (!user) return; void supabase.from("answer_versions").select("id,text,application_questions(prompt)").eq("user_id", user.id).eq("approved", true).order("created_at", { ascending: false }).limit(30).then(({ data }) => setAnswers((data ?? []).map((answer) => ({ id: answer.id, text: answer.text, prompt: (Array.isArray(answer.application_questions) ? answer.application_questions[0] : answer.application_questions)?.prompt ?? "Previous approved answer" })))); }, [user]);
  const visible = answers.filter((answer) => `${answer.prompt} ${answer.text}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="mt-10 rounded-3xl border border-line bg-white p-6"><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Answer memory</p><h2 className="mt-2 font-display text-3xl">Reuse approved work, never invent it.</h2><p className="mt-2 text-sm text-ink-muted">Search previous approved answers for a grounded starting point. Suggestions are never applied automatically.</p><input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-5 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm" placeholder="Search previous questions or answers" />{visible.length ? <div className="mt-5 grid gap-3">{visible.slice(0, 5).map((answer) => <article key={answer.id} className="rounded-xl border border-line p-4"><p className="text-xs font-medium text-ink-muted">{answer.prompt}</p><p className="mt-2 text-sm leading-6">{answer.text}</p></article>)}</div> : <p className="mt-5 text-sm text-ink-muted">{answers.length ? "No approved answers match this search." : "Approved answers will appear here once you review and approve them."}</p>}</section>;
}

function Documents({ items, create }: { items: Document[]; create: (data: { file: File; kind: string; expiresAt: string }) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [kind, setKind] = useState("other"); const [expiresAt, setExpiresAt] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) { event.preventDefault(); if (!file) return; setPending(true); setError(null); try { await create({ file, kind, expiresAt }); setFile(null); setExpiresAt(""); (document.getElementById("document-upload") as HTMLInputElement | null)?.value && ((document.getElementById("document-upload") as HTMLInputElement).value = ""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload could not be completed."); } finally { setPending(false); } }
  const expiryLabel = (value?: string | null) => { if (!value) return "No expiry set"; const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000); return days < 0 ? `Expired ${Math.abs(days)}d ago` : days <= 30 ? `Expires in ${days}d` : `Expires ${new Date(value).toLocaleDateString()}`; };
  return <div><PageIntro eyebrow="Memory" title="Documents you can trust." body="PDF, DOCX, TXT, and Markdown uploads are stored privately and extracted into reviewable text chunks." /><form onSubmit={submit} className="mt-8 grid gap-3 rounded-2xl border border-line bg-white p-4 lg:grid-cols-[1fr_170px_170px_auto]"><input id="document-upload" required type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="min-h-11 text-sm" /><select value={kind} onChange={(event) => setKind(event.target.value)} className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm"><option value="resume">Resume</option><option value="cover_letter">Cover letter</option><option value="transcript">Transcript</option><option value="certificate">Certificate</option><option value="portfolio">Portfolio</option><option value="other">Other</option></select><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="date" className="h-11 rounded-xl border border-line bg-canvas px-3 text-sm" aria-label="Document expiry" /><Button disabled={pending}>{pending ? "Extracting…" : "Upload & extract"}</Button>{error && <p className="text-sm text-rose-700 lg:col-span-4">{error}</p>}</form><div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => { const warning = item.expiresAt && new Date(item.expiresAt).getTime() - Date.now() < 30 * 86_400_000; return <div key={item.id} className="rounded-3xl border border-line bg-white p-6"><FileText className="h-6 w-6 text-coral-text" /><h2 className="mt-8 font-display text-3xl">{item.title}</h2><p className="mt-3 text-sm text-ink-muted">{item.kind} · {item.version}</p><p className={cn("mt-3 text-xs", warning ? "font-medium text-coral-text" : "text-ink-muted")}>{expiryLabel(item.expiresAt)}</p></div>; })}{!items.length && <div className="md:col-span-2 xl:col-span-3"><Empty title="No documents registered." body="Upload a source document to extract reviewable text and track its freshness." /></div>}</div></div>;
}

function Memory({ summary, save }: { summary: string; save: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(summary); const [pending, setPending] = useState(false);
  useEffect(() => setValue(summary), [summary]);
  async function submit(event: FormEvent) { event.preventDefault(); setPending(true); try { await save(value); } finally { setPending(false); } }
  return <div><PageIntro eyebrow="Memory" title="The facts you want to carry forward." body="Save short, reviewable evidence statements to your private account. Assisted generation remains unavailable until the original AI services are separately configured." /><form onSubmit={submit} className="mt-8 max-w-3xl rounded-3xl border border-line bg-white p-6 sm:p-8"><div className="flex items-center gap-3"><Library className="h-5 w-5 text-violet-text" /><h2 className="text-sm font-medium">Professional evidence</h2></div><textarea value={value} onChange={(event) => setValue(event.target.value)} className="mt-6 min-h-44 w-full rounded-2xl border border-line bg-canvas p-4 text-sm leading-6 outline-none focus:border-ink" placeholder="Add a concise, truthful statement about an accomplishment, skill, or preference." /><div className="mt-5 flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save memory"}</Button></div></form></div>;
}

function SettingsPage() {
  const { user } = useSupabaseAuth(); const [confirmEmail, setConfirmEmail] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  async function accessToken() { const { data } = await supabase.auth.getSession(); if (!data.session?.access_token) throw new Error("Your session has expired. Sign in again."); return data.session.access_token; }
  async function downloadExport() {
    setPending(true); setError(null);
    try { const response = await fetch("/api/account/export", { headers: { authorization: `Bearer ${await accessToken()}` } }); if (!response.ok) throw new Error((await response.json()).error ?? "Export could not be created."); const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "1apply-export.json"; link.click(); URL.revokeObjectURL(link.href); } catch (caught) { setError(caught instanceof Error ? caught.message : "Export could not be created."); } finally { setPending(false); }
  }
  async function deleteAccount(event: FormEvent) {
    event.preventDefault(); setPending(true); setError(null);
    try { const response = await fetch("/api/account", { method: "DELETE", headers: { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` }, body: JSON.stringify({ confirmEmail }) }); if (!response.ok) throw new Error((await response.json()).error ?? "Account deletion could not be completed."); await supabase.auth.signOut(); window.location.assign("/"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Account deletion could not be completed."); } finally { setPending(false); }
  }
  return <div><PageIntro eyebrow="Account" title="Settings and safeguards." body="Download your user-owned data at any time or permanently remove your application memory after confirming your email." /><div className="mt-8 grid max-w-3xl gap-5"><section className="rounded-3xl border border-line bg-white p-6"><h2 className="text-lg font-medium">Export your data</h2><p className="mt-2 text-sm text-ink-muted">Download profile facts, evidence, documents, applications, questions, and approved-answer history as JSON.</p><Button className="mt-5" variant="secondary" disabled={pending} onClick={() => void downloadExport()}>Download export</Button></section><section className="rounded-3xl border border-coral/30 bg-white p-6"><h2 className="text-lg font-medium text-coral-text">Delete Application Memory</h2><p className="mt-2 text-sm text-ink-muted">This permanently removes your profile and cascading application records from the original Supabase project. It cannot be undone.</p><form onSubmit={deleteAccount} className="mt-5 flex flex-col gap-3 sm:flex-row"><input required type="email" value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} placeholder={user?.email ?? "Enter your email"} className="h-11 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm" /><Button type="submit" variant="secondary" disabled={pending}>Delete my data</Button></form></section>{error && <p className="text-sm text-rose-700">{error}</p>}</div></div>;
}
function AccountPlaceholder({ section }: { section: string }) { const title = section === "integrations" ? "Connect only what helps." : "Stay calm, stay current."; const Icon = section === "integrations" ? Link2 : Bell; return <div><PageIntro eyebrow="Account" title={title} body="This service area needs its provider-specific migration before it can be enabled." /><div className="mt-8 rounded-3xl border border-line bg-white p-8 text-center"><Icon className="mx-auto h-8 w-8 text-teal-text" /><h2 className="mt-5 font-display text-3xl">Service migration pending.</h2></div></div>; }
function OpportunityRow({ item, expanded = false }: { item: Opportunity; expanded?: boolean }) { return <div className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{item.role}</p><p className="mt-1 text-sm text-ink-muted">{item.company} · {item.source}</p>{expanded && <p className="mt-3 text-xs text-ink-muted">{item.deadline ? `Deadline ${item.deadline} · ` : ""}{item.stage}</p>}</div><span className={cn("h-fit rounded-full px-3 py-1 text-xs font-medium", item.fit >= 80 ? "bg-mint-soft text-mint-text" : "bg-canvas text-ink-muted")}>{item.fit ? `${item.fit}% fit` : "Unscored"}</span></div>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="rounded-2xl border border-dashed border-line p-8 text-center"><h2 className="font-display text-3xl">{title}</h2><p className="mt-3 text-sm text-ink-muted">{body}</p></div>; }
function Loading() { return <div className="grid min-h-96 place-items-center"><div className="text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-ink border-r-transparent" /><p className="mt-4 text-sm text-ink-muted">Loading your workspace…</p></div></div>; }