import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  FileText,
  FolderSearch,
  Library,
  Link2,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";

import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { WORKSPACE_NAV, isNavActive } from "@/components/app/nav";
import { cn } from "@/lib/cn";

type Opportunity = { id: string; company: string; role: string; source: string; fit: number; deadline: string; stage: string };

const initialOpportunities: Opportunity[] = [
  { id: "orbital", company: "Orbital Studio", role: "Product Designer", source: "Design careers", fit: 92, deadline: "Aug 29", stage: "Ready to start" },
  { id: "moss", company: "Moss & Field", role: "Brand systems lead", source: "Referral", fit: 86, deadline: "Sep 3", stage: "In review" },
  { id: "gather", company: "Gather Labs", role: "Creative technologist", source: "Open call", fit: 78, deadline: "Sep 8", stage: "Saved" },
];

function chipTone(fit: number) {
  return fit >= 90 ? "bg-mint-soft text-mint-text" : fit >= 80 ? "bg-teal-soft text-teal-text" : "bg-sand-soft text-sand-text";
}

function sectionForPath(pathname: string) {
  if (pathname.includes("/opportunities")) return "opportunities";
  if (pathname.includes("/applications")) return "applications";
  if (pathname.includes("/documents") || pathname.includes("/resumes")) return "documents";
  if (pathname.includes("/memory")) return "memory";
  if (pathname.includes("/notifications")) return "notifications";
  if (pathname.includes("/integrations")) return "integrations";
  if (pathname.includes("/settings")) return "settings";
  if (pathname.includes("/onboarding")) return "onboarding";
  return "dashboard";
}

export function PortedWorkspace() {
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [query, setQuery] = useState("");
  const [memory, setMemory] = useState("Led visual systems for multi-product platforms, turning complex workflows into calm, accessible interfaces.");
  const [notice, setNotice] = useState<string | null>(null);
  const section = sectionForPath(location);
  const visibleOpportunities = useMemo(
    () => opportunities.filter((item) => `${item.company} ${item.role}`.toLowerCase().includes(query.toLowerCase())),
    [opportunities, query],
  );

  function addOpportunity(event: FormEvent) {
    event.preventDefault();
    const next = { id: `saved-${Date.now()}`, company: "New opportunity", role: "Untitled role", source: "Manual save", fit: 72, deadline: "Not set", stage: "Saved" };
    setOpportunities((current) => [next, ...current]);
    setNotice("Opportunity saved to your workspace.");
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden">
        <Link href="/app"><Wordmark size="sm" /></Link>
        <Button variant="secondary" size="sm" onClick={() => setMenuOpen(true)}><Menu className="h-4 w-4" />Menu</Button>
      </header>
      <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[255px_minmax(0,1fr)]">
        <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-line bg-white px-4 py-6 transition-transform lg:static lg:w-auto lg:translate-x-0", menuOpen ? "translate-x-0" : "-translate-x-full")}>
          <div className="flex items-center justify-between px-2">
            <Link href="/app" onClick={() => setMenuOpen(false)}><Wordmark /></Link>
            <button className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-3 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">Application OS</p>
          <nav className="mt-8 grid gap-6" aria-label="Workspace">
            {WORKSPACE_NAV.map((group) => (
              <div key={group.id}>
                <p className="px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">{group.label}</p>
                <div className="mt-2 grid gap-1">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isNavActive(location, href);
                    return <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition", active ? "bg-canvas text-ink" : "text-ink-muted hover:bg-canvas hover:text-ink")}><Icon className="h-4 w-4" />{label}</Link>;
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-auto border-t border-line px-2 pt-4">
            <p className="text-sm font-medium">Applicant workspace</p>
            <p className="mt-1 text-xs text-ink-muted">Local port preview</p>
            <Link href="/sign-in" className="mt-3 inline-flex text-sm text-ink-muted hover:text-ink">Sign out</Link>
          </div>
        </aside>
        {menuOpen && <button className="fixed inset-0 z-30 bg-ink/20 lg:hidden" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />}
        <main className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          {notice && <div className="mb-6 flex items-center justify-between rounded-2xl border border-mint-300 bg-mint-soft px-4 py-3 text-sm text-mint-text"><span className="flex items-center gap-2"><Check className="h-4 w-4" />{notice}</span><button onClick={() => setNotice(null)}><X className="h-4 w-4" /></button></div>}
          {section === "dashboard" && <Dashboard opportunities={opportunities} onAdd={addOpportunity} />}
          {section === "opportunities" && <Opportunities opportunities={visibleOpportunities} query={query} setQuery={setQuery} onAdd={addOpportunity} />}
          {section === "applications" && <Applications opportunities={opportunities} onNotice={setNotice} />}
          {section === "documents" && <Documents onNotice={setNotice} />}
          {section === "memory" && <Memory value={memory} setValue={setMemory} onSave={() => setNotice("Application memory saved locally.")} />}
          {section === "notifications" && <Notifications />}
          {section === "integrations" && <Integrations />}
          {section === "settings" && <SettingsPanel />}
          {section === "onboarding" && <Onboarding onNotice={setNotice} />}
        </main>
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">{eyebrow}</p><h1 className="mt-3 font-display text-5xl leading-none sm:text-6xl">{title}</h1>{children}</>;
}

function Dashboard({ opportunities, onAdd }: { opportunities: Opportunity[]; onAdd: (event: FormEvent) => void }) {
  return <div>
    <PageIntro eyebrow="Good morning" title="Keep the signal, lose the scramble."><p className="mt-5 max-w-2xl text-sm leading-6 text-ink-muted">Your application workspace keeps opportunities, evidence, documents, and approved answers in one deliberate loop.</p></PageIntro>
    <div className="mt-9 grid gap-4 sm:grid-cols-3">
      {[["Active applications", "3", BriefcaseBusiness], ["Saved opportunities", String(opportunities.length), FolderSearch], ["Evidence ready", "14", Library]].map(([label, number, Icon]) => {
        const MetricIcon = Icon as typeof BriefcaseBusiness;
        return <div key={label as string} className="rounded-2xl border border-line bg-white p-5"><MetricIcon className="h-5 w-5 text-mint-text" /><p className="mt-5 font-display text-4xl">{number as string}</p><p className="mt-1 text-sm text-ink-muted">{label as string}</p></div>;
      })}
    </div>
    <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_360px]">
      <section className="rounded-3xl border border-line bg-white p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">Opportunity queue</p><h2 className="mt-2 font-display text-3xl">What deserves attention next.</h2></div><Link href="/app/opportunities" className="text-sm underline">Open all</Link></div>
        <div className="mt-6 divide-y divide-line">{opportunities.slice(0, 3).map((item) => <OpportunityRow key={item.id} item={item} />)}</div>
      </section>
      <section className="rounded-3xl bg-obsidian p-6 text-white sm:p-8"><Sparkles className="h-5 w-5 text-mint" /><p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">Quick capture</p><h2 className="mt-2 font-display text-3xl">Save a lead while it’s fresh.</h2><p className="mt-3 text-sm leading-6 text-zinc-300">Add it now; enrich the details when you have the link and deadline.</p><form onSubmit={onAdd}><Button variant="inverse" className="mt-6 w-full"><Plus className="h-4 w-4" />Save opportunity</Button></form></section>
    </div>
  </div>;
}

function Opportunities({ opportunities, query, setQuery, onAdd }: { opportunities: Opportunity[]; query: string; setQuery: (value: string) => void; onAdd: (event: FormEvent) => void }) {
  return <div><PageIntro eyebrow="Discover" title="Opportunities with context."><p className="mt-5 text-sm text-ink-muted">Ranked against the experience you’ve chosen to keep in your application memory.</p></PageIntro><div className="mt-8 flex flex-col gap-4 sm:flex-row"><label className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3"><Search className="h-4 w-4 text-ink-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search role or organization" /></label><form onSubmit={onAdd}><Button className="w-full sm:w-auto"><Plus className="h-4 w-4" />Save opportunity</Button></form></div><div className="mt-7 grid gap-4">{opportunities.map((item) => <div key={item.id} className="rounded-2xl border border-line bg-white p-5 sm:p-6"><OpportunityRow item={item} expanded /></div>)}{opportunities.length === 0 && <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-muted">No opportunities match this search.</p>}</div></div>;
}

function OpportunityRow({ item, expanded = false }: { item: Opportunity; expanded?: boolean }) {
  return <div className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium">{item.role}</p><p className="mt-1 text-sm text-ink-muted">{item.company} · {item.source}</p>{expanded && <p className="mt-3 text-xs text-ink-muted">Deadline {item.deadline} · {item.stage}</p>}</div><div className="flex items-center gap-3"><span className={cn("rounded-full px-3 py-1 text-xs font-medium", chipTone(item.fit))}>{item.fit}% fit</span><ChevronRight className="h-4 w-4 text-ink-muted" /></div></div>;
}

function Applications({ opportunities, onNotice }: { opportunities: Opportunity[]; onNotice: (message: string) => void }) {
  return <div><PageIntro eyebrow="Operate" title="Applications in motion."><p className="mt-5 text-sm text-ink-muted">Every answer stays tied to evidence, an opportunity, and your final review.</p></PageIntro><div className="mt-8 overflow-hidden rounded-3xl border border-line bg-white"><div className="grid grid-cols-[1.5fr_1fr_auto] gap-4 border-b border-line px-5 py-4 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-muted sm:px-7"><span>Application</span><span>Stage</span><span>Fit</span></div>{opportunities.map((item, index) => <button key={item.id} onClick={() => onNotice(`${item.role} opened for review.`)} className="grid w-full grid-cols-[1.5fr_1fr_auto] gap-4 border-b border-line px-5 py-5 text-left last:border-0 hover:bg-canvas sm:px-7"><span><strong className="block text-sm font-medium">{item.role}</strong><small className="mt-1 block text-xs text-ink-muted">{item.company}</small></span><span className="text-sm text-ink-muted">{index === 0 ? "Draft answers" : index === 1 ? "In review" : "Saved"}</span><span className={cn("h-fit rounded-full px-2 py-1 text-xs", chipTone(item.fit))}>{item.fit}%</span></button>)}</div></div>;
}

function Documents({ onNotice }: { onNotice: (message: string) => void }) {
  const docs = [["Product portfolio", "Portfolio · Version 3", "Updated today"], ["Resume — product design", "Resume · Version 5", "Updated Aug 20"], ["Case study evidence", "Supporting material · 14 facts", "Reviewed Aug 18"]];
  return <div><PageIntro eyebrow="Memory" title="Documents you can trust."><p className="mt-5 text-sm text-ink-muted">Keep source materials versioned so drafts can stay grounded in the evidence you approved.</p></PageIntro><div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{docs.map(([name, type, date]) => <button onClick={() => onNotice(`${name} selected.`)} key={name} className="rounded-3xl border border-line bg-white p-6 text-left transition hover:-translate-y-0.5 hover:shadow-lg"><FileText className="h-6 w-6 text-coral-text" /><h2 className="mt-8 font-display text-3xl">{name}</h2><p className="mt-3 text-sm text-ink-muted">{type}</p><p className="mt-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">{date}</p></button>)}</div></div>;
}

function Memory({ value, setValue, onSave }: { value: string; setValue: (value: string) => void; onSave: () => void }) {
  return <div><PageIntro eyebrow="Memory" title="The facts you want to carry forward."><p className="mt-5 max-w-2xl text-sm text-ink-muted">Use short, reviewable statements. When connected services are enabled, this becomes the private source for assisted drafts and fit checks.</p></PageIntro><div className="mt-8 max-w-3xl rounded-3xl border border-line bg-white p-6 sm:p-8"><div className="flex items-center gap-3"><Library className="h-5 w-5 text-violet-text" /><h2 className="text-sm font-medium">Professional evidence</h2></div><textarea value={value} onChange={(event) => setValue(event.target.value)} className="mt-6 min-h-44 w-full rounded-2xl border border-line bg-canvas p-4 text-sm leading-6 outline-none focus:border-ink" /><div className="mt-5 flex justify-end"><Button onClick={onSave}>Save memory</Button></div></div></div>;
}

function Notifications() { return <div><PageIntro eyebrow="Account" title="Stay calm, stay current."><p className="mt-5 text-sm text-ink-muted">Deadline and review notifications appear here when they matter.</p></PageIntro><div className="mt-8 rounded-3xl border border-line bg-white p-8 text-center"><Bell className="mx-auto h-8 w-8 text-teal-text" /><h2 className="mt-5 font-display text-3xl">Nothing urgent right now.</h2><p className="mt-3 text-sm text-ink-muted">You’ll see confirmed milestones, deadlines, and review reminders here.</p></div></div>; }
function Integrations() { return <div><PageIntro eyebrow="Account" title="Connect only what helps."><p className="mt-5 text-sm text-ink-muted">The imported app supports secure email and calendar connections. They stay disabled until their original provider settings are configured.</p></PageIntro><div className="mt-8 grid gap-4 md:grid-cols-2">{[["Email sync", "Bring application conversations into your private activity timeline."], ["Calendar sync", "See deadlines and interviews without duplicating your schedule."]].map(([title, body]) => <div key={title} className="rounded-3xl border border-line bg-white p-7"><Link2 className="h-6 w-6 text-teal-text" /><h2 className="mt-7 font-display text-3xl">{title}</h2><p className="mt-3 text-sm leading-6 text-ink-muted">{body}</p><Button variant="secondary" className="mt-6" disabled>Configure provider</Button></div>)}</div></div>; }
function SettingsPanel() { return <div><PageIntro eyebrow="Account" title="Settings and safeguards."><p className="mt-5 text-sm text-ink-muted">Review the boundaries that keep this workspace private and deliberate.</p></PageIntro><div className="mt-8 grid gap-4"><div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5"><Settings className="h-5 w-5 text-ink-muted" /><div><p className="font-medium text-sm">Ported workspace</p><p className="mt-1 text-sm text-ink-muted">Original Vercel routes are available through this Replit Vite shell.</p></div></div><div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-5"><Check className="h-5 w-5 text-mint-text" /><div><p className="font-medium text-sm">Manual submission safeguard</p><p className="mt-1 text-sm text-ink-muted">1-Apply never submits an application for you.</p></div></div></div></div>; }
function Onboarding({ onNotice }: { onNotice: (message: string) => void }) { return <div><PageIntro eyebrow="Onboarding" title="Build your memory deliberately."><p className="mt-5 text-sm text-ink-muted">Add consent, profile details, documents, and review evidence before you ask the workspace to help with an application.</p></PageIntro><div className="mt-8 grid gap-4 md:grid-cols-2">{[["1", "Consent", "Understand what is stored and how assisted drafts use it."], ["2", "Profile", "Capture your goals and preferred application style."], ["3", "Documents", "Bring in resumes, portfolios, and supporting material."], ["4", "Review", "Approve the evidence that can support an answer."]].map(([number, title, body]) => <button onClick={() => onNotice(`${title} step marked ready to review.`)} key={number} className="rounded-3xl border border-line bg-white p-6 text-left"><p className="font-mono text-xs text-ink-muted">{number}</p><h2 className="mt-7 font-display text-3xl">{title}</h2><p className="mt-3 text-sm leading-6 text-ink-muted">{body}</p></button>)}</div></div>; }