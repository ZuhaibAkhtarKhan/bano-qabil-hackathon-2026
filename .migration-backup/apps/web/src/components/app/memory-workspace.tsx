import Link from "next/link";
import type { ReactNode } from "react";
import type { MemoryCategory } from "@1apply/contracts";
import { MEMORY_SECTIONS } from "@1apply/domain";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ApplicationCard, DocumentCard, EvidenceCard } from "@/components/ui/product-cards";
import { SemanticBadge } from "@/components/ui/status-pill";
import { factSemanticStatus } from "@/lib/status";
import {
  addMemoryEvidence,
  addMemoryLink,
  addMemorySkill,
  deleteMemoryEvidence,
  deleteMemoryLink,
  deleteMemorySkill,
  deleteProfileFact,
  resolveMemoryConflictAction,
  setEvidenceExclusion,
  setEvidenceVerification,
  updateIdentity,
  uploadMemoryDocument,
  verifyProfileFact,
} from "@/server/memory/actions";
import type { loadMemoryWorkspace } from "@/server/memory/queries";

type MemoryData = Awaited<ReturnType<typeof loadMemoryWorkspace>>;

const SECTION_KIND: Partial<Record<MemoryCategory, string>> = {
  education: "education",
  experience: "employment",
  projects: "project",
  achievements: "achievement",
  certifications: "certification",
  leadership: "leadership",
  research: "research",
  supporting: "volunteering",
};

function factText(value: Record<string, unknown>): string {
  if (typeof value.text === "string") return value.text;
  return JSON.stringify(value);
}

function sourceLabel(
  item: { source: string | null; source_document_id: string | null },
  documentById: MemoryData["documentById"],
): string | null {
  if (item.source_document_id) {
    return documentById.get(item.source_document_id)?.label ?? "Document";
  }
  if (item.source?.startsWith("document:")) return "Uploaded document";
  if (item.source === "manual") return "Manual entry";
  return item.source;
}

export function MemoryWorkspace({
  data,
  section,
}: {
  data: MemoryData;
  section: MemoryCategory;
}) {
  const openConflicts = data.conflicts.filter((item) => item.status === "open");
  const conflictFactIds = new Set(openConflicts.flatMap((item) => item.fact_ids));

  const factById = new Map<string, { label: string; source: string | null; excerpt: string | null }>();
  for (const item of data.evidence) {
    factById.set(item.id, {
      label: item.end_date ? `${item.title} · ends ${item.end_date}` : item.title,
      source: sourceLabel(item, data.documentById),
      excerpt: item.source_location,
    });
  }
  for (const item of data.facts) {
    factById.set(item.id, {
      label: factText(item.value),
      source: sourceLabel(item, data.documentById),
      excerpt: item.excerpt ?? item.source_location,
    });
  }

  const nav = (
    <nav className="flex flex-wrap gap-2" aria-label="Memory sections">
      {MEMORY_SECTIONS.map((item) => (
        <Link
          key={item.id}
          href={`/app/memory?section=${item.id}`}
          className={`rounded-full px-3 py-1.5 text-sm ${
            section === item.id ? "bg-ink text-paper" : "bg-sand/40 text-ink-muted hover:bg-sand/70"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );

  const conflictsPanel =
    openConflicts.length > 0 ? (
      <Card className="border-coral/30 bg-coral/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-coral">Conflicts</p>
            <h2 className="mt-1 text-lg font-medium">Sources disagree — pick the value to keep</h2>
            <p className="mt-1 text-sm text-ink-muted">
              1-Apply never auto-resolves conflicts. Rejected sources stay in history.
            </p>
          </div>
          <SemanticBadge status="conflict" />
        </div>
        <ul className="mt-4 grid gap-4">
          {openConflicts.map((conflict) => (
            <li key={conflict.id} className="rounded-xl border border-coral/20 bg-paper p-4">
              <p className="text-sm font-medium">{conflict.fact_key.replace(/:/g, " · ")}</p>
              <ul className="mt-3 grid gap-2">
                {conflict.fact_ids.map((factId) => {
                  const meta = factById.get(factId);
                  return (
                    <li key={factId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sand/20 px-3 py-2">
                      <div>
                        <p className="text-sm">{meta?.label ?? factId}</p>
                        <p className="text-xs text-ink-muted">
                          Source: {meta?.source ?? "Unknown"}
                          {meta?.excerpt ? ` · "${meta.excerpt.slice(0, 120)}"` : ""}
                        </p>
                      </div>
                      <form action={resolveMemoryConflictAction}>
                        <input type="hidden" name="conflictId" value={conflict.id} />
                        <input type="hidden" name="chosenFactId" value={factId} />
                        <Button type="submit" variant="secondary" size="sm">
                          Use this value
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
    ) : null;

  const hiddenSection = <input type="hidden" name="section" value={section} />;

  const personalPanel = (
    <div className="grid gap-8">
      <form action={updateIdentity} className="grid gap-4">
        {hiddenSection}
        <Field label="Name" htmlFor="displayName">
          <Input id="displayName" name="displayName" defaultValue={data.profile.display_name ?? ""} required />
        </Field>
        <Field label="Headline" htmlFor="headline">
          <Input id="headline" name="headline" defaultValue={data.profile.headline ?? ""} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={data.profile.phone ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="locationCity">
            <Input id="locationCity" name="locationCity" defaultValue={data.profile.location_city ?? ""} />
          </Field>
          <Field label="Country" htmlFor="locationCountry">
            <Input id="locationCountry" name="locationCountry" defaultValue={data.profile.location_country ?? ""} />
          </Field>
        </div>
        <Field label="Availability" htmlFor="availability">
          <Input id="availability" name="availability" defaultValue={data.profile.availability ?? ""} />
        </Field>
        <Field label="Work authorization" htmlFor="workAuthorization">
          <Input id="workAuthorization" name="workAuthorization" defaultValue={data.profile.work_authorization ?? ""} />
        </Field>
        <Field label="LinkedIn" htmlFor="linkedinUrl">
          <Input id="linkedinUrl" name="linkedinUrl" defaultValue={data.profile.linkedin_url ?? ""} />
        </Field>
        <Field label="GitHub" htmlFor="githubUrl">
          <Input id="githubUrl" name="githubUrl" defaultValue={data.profile.github_url ?? ""} />
        </Field>
        <Field label="Portfolio" htmlFor="portfolioUrl">
          <Input id="portfolioUrl" name="portfolioUrl" defaultValue={data.profile.portfolio_url ?? ""} />
        </Field>
        <Button type="submit">Save personal information</Button>
      </form>

      {data.facts.filter((item) => item.category === "personal").length > 0 ? (
        <section>
          <h3 className="text-sm font-medium">Extracted personal facts</h3>
          <ul className="mt-3 grid gap-3">
            {data.facts
              .filter((item) => item.category === "personal")
              .map((item) => (
                <li key={item.id}>
                  <Card as="article" className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{factText(item.value)}</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {item.fact_key} · {sourceLabel(item, data.documentById) ?? "Unknown source"}
                        </p>
                        {item.excerpt ? (
                          <p className="mt-2 text-xs italic text-ink-muted">&ldquo;{item.excerpt}&rdquo;</p>
                        ) : null}
                      </div>
                      <SemanticBadge
                        status={factSemanticStatus({
                          verificationStatus: item.verification_status,
                          extractionStatus: item.extraction_status,
                          hasOpenConflict: conflictFactIds.has(item.id),
                        })}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={verifyProfileFact}>
                        {hiddenSection}
                        <input type="hidden" name="factId" value={item.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          Verify
                        </Button>
                      </form>
                      <form action={deleteProfileFact}>
                        {hiddenSection}
                        <input type="hidden" name="factId" value={item.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </Card>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-medium">Opportunities you are pursuing</h3>
        {data.applications.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No active applications yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {data.applications.map((row) => (
              <li key={row.id}>
                <ApplicationCard row={row} />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          {data.snapshotCount} submission snapshot{data.snapshotCount === 1 ? "" : "s"} frozen from prior applies.
        </p>
      </section>
    </div>
  );

  const evidenceSections: MemoryCategory[] = [
    "education",
    "projects",
    "experience",
    "achievements",
    "certifications",
    "leadership",
    "research",
    "supporting",
  ];

  const evidencePanel = (category: MemoryCategory) => {
    const items = data.evidence.filter((item) => item.category === category);
    const defaultKind = SECTION_KIND[category] ?? "project";
    return (
      <div className="grid gap-6">
        <form action={addMemoryEvidence} className="grid gap-4 rounded-xl border border-sand/50 p-4">
          {hiddenSection}
          <p className="text-sm font-medium">Add unverified entry</p>
          <Field label="Title" htmlFor={`${category}-title`}>
            <Input id={`${category}-title`} name="title" required />
          </Field>
          <input type="hidden" name="kind" value={defaultKind} />
          <Field label="Organization" htmlFor={`${category}-org`}>
            <Input id={`${category}-org`} name="organization" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor={`${category}-start`}>
              <Input id={`${category}-start`} name="startDate" type="date" />
            </Field>
            <Field label="End date" htmlFor={`${category}-end`}>
              <Input id={`${category}-end`} name="endDate" type="date" />
            </Field>
          </div>
          <Field label="Situation" htmlFor={`${category}-situation`}>
            <Textarea id={`${category}-situation`} name="situation" rows={2} />
          </Field>
          <Field label="Action" htmlFor={`${category}-action`}>
            <Textarea id={`${category}-action`} name="action" rows={2} />
          </Field>
          <Field label="Outcome" htmlFor={`${category}-outcome`}>
            <Textarea id={`${category}-outcome`} name="outcome" rows={2} />
          </Field>
          <Field label="Skills (comma separated)" htmlFor={`${category}-skills`}>
            <Input id={`${category}-skills`} name="skills" />
          </Field>
          <Button type="submit" variant="secondary">
            Add — needs review
          </Button>
        </form>

        {items.length === 0 ? (
          <EmptyState
            eyebrow="Empty"
            title={`No ${category} memory yet`}
            body="Upload a resume in Supporting Evidence or add an entry manually. Extracted facts stay unverified until you confirm them."
          />
        ) : (
          <ul className="grid gap-4">
            {items.map((item) => (
              <li key={item.id}>
                <EvidenceCard
                  title={item.title}
                  kind={item.kind}
                  organization={item.organization}
                  outcome={item.outcome}
                  startDate={item.start_date}
                  endDate={item.end_date}
                  verificationStatus={item.verification_status}
                  excludedFromAi={item.excluded_from_ai}
                  extractionStatus={item.extraction_status}
                  sourceLabel={sourceLabel(item, data.documentById)}
                  sourceExcerpt={item.source_location}
                  hasOpenConflict={conflictFactIds.has(item.id)}
                  actions={
                    <>
                      <form action={setEvidenceVerification}>
                        {hiddenSection}
                        <input type="hidden" name="evidenceId" value={item.id} />
                        <input type="hidden" name="status" value="verified" />
                        <Button type="submit" variant="secondary" size="sm">
                          Verify
                        </Button>
                      </form>
                      <form action={setEvidenceVerification}>
                        {hiddenSection}
                        <input type="hidden" name="evidenceId" value={item.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <Button type="submit" variant="ghost" size="sm">
                          Reject
                        </Button>
                      </form>
                      <form action={setEvidenceExclusion}>
                        {hiddenSection}
                        <input type="hidden" name="evidenceId" value={item.id} />
                        <input type="hidden" name="excluded" value={item.excluded_from_ai ? "false" : "true"} />
                        <Button type="submit" variant="ghost" size="sm">
                          {item.excluded_from_ai ? "Include in AI" : "Exclude from AI"}
                        </Button>
                      </form>
                      <form action={deleteMemoryEvidence}>
                        {hiddenSection}
                        <input type="hidden" name="evidenceId" value={item.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          Delete
                        </Button>
                      </form>
                    </>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const skillsPanel = (
    <div className="grid gap-6">
      <form action={addMemorySkill} className="flex flex-wrap items-end gap-3">
        {hiddenSection}
        <div className="min-w-[14rem] flex-1">
          <Field label="Skill" htmlFor="skill-name">
            <Input id="skill-name" name="name" required placeholder="TypeScript" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Add skill
        </Button>
      </form>
      {data.skills.length === 0 ? (
        <EmptyState eyebrow="Empty" title="No skills yet" body="Extract from a resume or add skills manually." />
      ) : (
        <ul className="flex flex-wrap gap-2">
          {data.skills.map((skill) => (
            <li key={skill.id}>
              <form action={deleteMemorySkill} className="inline">
                {hiddenSection}
                <input type="hidden" name="skillId" value={skill.id} />
                <button
                  type="submit"
                  className="rounded-full border border-sand/60 bg-paper px-3 py-1 text-sm hover:border-coral/40"
                  title={`Remove ${skill.name}`}
                >
                  {skill.name} ×
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const linksPanel = (
    <div className="grid gap-6">
      <form action={addMemoryLink} className="grid gap-4 rounded-xl border border-sand/50 p-4">
        {hiddenSection}
        <Field label="Kind" htmlFor="link-kind">
          <Select id="link-kind" name="kind" defaultValue="portfolio">
            <option value="linkedin">LinkedIn</option>
            <option value="github">GitHub</option>
            <option value="portfolio">Portfolio</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="URL" htmlFor="link-url">
          <Input id="link-url" name="url" type="url" required placeholder="https://" />
        </Field>
        <Field label="Label" htmlFor="link-label">
          <Input id="link-label" name="label" />
        </Field>
        <Button type="submit" variant="secondary">
          Add link
        </Button>
      </form>
      {data.links.length === 0 ? (
        <EmptyState eyebrow="Empty" title="No links yet" body="Add portfolio and profile links here." />
      ) : (
        <ul className="grid gap-3">
          {data.links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{link.label ?? link.kind}</p>
                <a href={link.url} className="text-sm text-teal underline" target="_blank" rel="noreferrer">
                  {link.url}
                </a>
              </div>
              <form action={deleteMemoryLink}>
                {hiddenSection}
                <input type="hidden" name="linkId" value={link.id} />
                <Button type="submit" variant="ghost" size="sm">
                  Delete
                </Button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const supportingPanel = (
    <div className="grid gap-8">
      <form action={uploadMemoryDocument} className="grid gap-4 rounded-xl border border-sand/50 p-4">
        {hiddenSection}
        <p className="text-sm font-medium">Upload resumes and supporting documents</p>
        <Field label="Label" htmlFor="doc-label">
          <Input id="doc-label" name="label" defaultValue="Resume" />
        </Field>
        <Field label="Type" htmlFor="doc-type">
          <Select id="doc-type" name="type" defaultValue="resume">
            <option value="resume">Resume</option>
            <option value="other">Supporting document</option>
          </Select>
        </Field>
        <Field label="Files (.txt, .md, .pdf, .docx — max 8 MB each)" htmlFor="doc-file">
          <Input id="doc-file" name="file" type="file" multiple required accept=".txt,.md,.pdf,.docx" />
        </Field>
        <Button type="submit">Upload and extract</Button>
      </form>

      <section>
        <h3 className="text-sm font-medium">Your documents</h3>
        {data.documents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No documents uploaded yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {data.documents.map((doc) => (
              <li key={doc.id}>
                <DocumentCard document={doc} href={`/app/documents`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-medium">All extracted evidence (by source)</h3>
        <ul className="mt-3 grid gap-4">
          {data.evidence
            .filter((item) => item.extraction_status === "extracted")
            .map((item) => (
              <li key={item.id}>
                <EvidenceCard
                  title={item.title}
                  kind={item.kind}
                  organization={item.organization}
                  outcome={item.outcome}
                  verificationStatus={item.verification_status}
                  excludedFromAi={item.excluded_from_ai}
                  extractionStatus={item.extraction_status}
                  sourceLabel={sourceLabel(item, data.documentById)}
                  sourceExcerpt={item.source_location}
                  hasOpenConflict={conflictFactIds.has(item.id)}
                />
              </li>
            ))}
        </ul>
      </section>
    </div>
  );

  let panel: ReactNode;
  if (section === "personal") panel = personalPanel;
  else if (section === "skills") panel = skillsPanel;
  else if (section === "links") panel = linksPanel;
  else if (section === "supporting") panel = supportingPanel;
  else if (evidenceSections.includes(section)) panel = evidencePanel(section);
  else panel = personalPanel;

  const activeLabel = MEMORY_SECTIONS.find((item) => item.id === section)?.label ?? "Personal";

  return (
    <div className="mt-8 grid gap-6">
      {conflictsPanel}
      {nav}
      <Card className="p-6">
        <h2 className="text-lg font-medium">{activeLabel}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Verified facts can power drafts. AI extracted and conflicting items need your review first.
        </p>
        <div className="mt-6">{panel}</div>
      </Card>
    </div>
  );
}
