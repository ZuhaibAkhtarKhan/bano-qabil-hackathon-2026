import Link from "next/link";
import type { ReactNode } from "react";
import type { MemoryCategory } from "@1apply/contracts";
import { MEMORY_SECTIONS, CNIC_PHARM_B_LABEL, kitStatus } from "@1apply/domain";
import { parseWorkspacePreferences } from "@/lib/workspace-preferences";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { KitDocumentUploadForm, UploadSubmitButton } from "@/components/app/kit-document-upload-form";
import { UseInKitField } from "@/components/app/use-in-kit-field";
import { SubmitButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DocumentCard } from "@/components/ui/product-cards";
import { cn } from "@/lib/cn";
import {
  addMemoryEvidence,
  addMemoryLink,
  addMemorySkill,
  deleteMemoryEvidence,
  deleteMemoryLink,
  deleteMemorySkill,
  updateIdentity,
  uploadMemoryDocument,
} from "@/server/memory/actions";
import { SavedAnswersPanel } from "@/components/app/saved-answers-panel";
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

function sourceLabel(
  item: { source: string | null; source_document_id: string | null; extraction_status?: string | null },
  documentById: MemoryData["documentById"],
): string | null {
  if (item.source_document_id) {
    return documentById.get(item.source_document_id)?.label ?? "Uploaded document";
  }
  if (item.source?.startsWith("document:")) return "Uploaded document";
  if (item.source === "manual" || item.extraction_status === "manual") return "Manual entry";
  if (item.extraction_status === "extracted") return "Auto-filled from document";
  return item.source;
}

export function MemoryWorkspace({
  data,
  section,
}: {
  data: MemoryData;
  section: MemoryCategory;
}) {
  const nav = (
    <nav className="flex flex-wrap gap-2" aria-label="Memory sections">
      {MEMORY_SECTIONS.map((item) => {
        const active = section === item.id;
        return (
          <Link
            key={item.id}
            href={`/app/memory?section=${item.id}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition-colors",
              active
                ? "border-teal/30 bg-mint-soft font-medium text-teal-text"
                : "border-line bg-white text-ink-muted hover:border-teal/20 hover:bg-canvas hover:text-ink",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const hiddenSection = <input type="hidden" name="section" value={section} />;
  const prefs = parseWorkspacePreferences(data.preferences);
  const kit = kitStatus({
    displayName: data.profile.display_name,
    university: prefs.university,
    educationSummary: prefs.educationSummary,
    documents: data.documents,
  });

  const personalPanel = (
    <form action={updateIdentity} className="grid gap-4" data-tour="kit-identity">
      {hiddenSection}
      <Field label="Name" htmlFor="displayName">
          <Input id="displayName" name="displayName" defaultValue={data.profile.display_name ?? ""} required />
        </Field>
        <Field label="University" htmlFor="university">
          <Input id="university" name="university" defaultValue={prefs.university} />
        </Field>
        <Field label="Education" htmlFor="educationSummary">
          <Input id="educationSummary" name="educationSummary" defaultValue={prefs.educationSummary} placeholder="BS Computer Science, 2026" />
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
        <Field label="Timezone" htmlFor="timezone" hint="IANA name used for deadline reminders, for example Asia/Karachi">
          <Input id="timezone" name="timezone" defaultValue={data.profile.timezone ?? ""} placeholder="Asia/Karachi" />
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
        <SubmitButton>Save personal information</SubmitButton>
    </form>
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
    const entryList =
      items.length > 0 ? (
        <ul className="grid gap-4">
          {items.map((item) => (
            <li key={item.id}>
              <Card as="article" className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-medium">{item.title}</h3>
                    {item.organization ? (
                      <p className="mt-1 text-sm text-ink-muted">{item.organization}</p>
                    ) : null}
                    {(item.start_date || item.end_date) && (
                      <p className="mt-1 text-xs text-ink-muted">
                        {[item.start_date, item.end_date].filter(Boolean).join(" – ")}
                      </p>
                    )}
                    {item.situation ? (
                      <p className="mt-2 text-sm text-ink-muted">{item.situation}</p>
                    ) : null}
                    {item.action ? (
                      <p className="mt-1 text-sm text-ink-muted">{item.action}</p>
                    ) : null}
                    {item.outcome ? (
                      <p className="mt-1 text-sm text-ink-muted">{item.outcome}</p>
                    ) : null}
                    {sourceLabel(item, data.documentById) ? (
                      <p className="mt-2 text-xs text-ink-muted">
                        Source: {sourceLabel(item, data.documentById)}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={deleteMemoryEvidence}>
                    {hiddenSection}
                    <input type="hidden" name="evidenceId" value={item.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-sand/60 px-4 py-3 text-sm text-ink-muted">
          No entries in this section yet. Upload a resume with “Update Your kit” checked, or add one manually below.
        </p>
      );

    return (
      <div className="grid gap-6">
        <div className="grid gap-3">
          <p className="text-sm font-medium">
            {items.length} {items.length === 1 ? "entry" : "entries"} in {MEMORY_SECTIONS.find((s) => s.id === category)?.label ?? category}
          </p>
          {entryList}
        </div>

        <form action={addMemoryEvidence} className="grid gap-4 rounded-xl border border-sand/50 p-4">
          {hiddenSection}
          <p className="text-sm font-medium">Add entry manually</p>
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
          <SubmitButton variant="secondary">Add entry</SubmitButton>
        </form>
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
        <SubmitButton variant="secondary">
          Add skill
        </SubmitButton>
      </form>
      {data.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {data.skills.map((skill) => (
            <li key={skill.id}>
              <form action={deleteMemorySkill} className="inline">
                {hiddenSection}
                <input type="hidden" name="skillId" value={skill.id} />
                <SubmitButton
                  variant="ghost"
                  size="sm"
                  className="rounded-full border border-sand/60 bg-white px-3 py-1 text-sm hover:border-coral/40"
                  pendingText="Removing…"
                  title={`Remove ${skill.name}`}
                >
                  {skill.name} ×
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
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
        <SubmitButton variant="secondary">
          Add link
        </SubmitButton>
      </form>
      {data.links.length > 0 ? (
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
                <SubmitButton variant="ghost" size="sm">
                  Delete
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const supportingPanel = (
    <div className="grid gap-8">
      {evidencePanel("supporting")}
      <div className="grid gap-4 rounded-xl border border-sand/50 p-4">
        <p className="text-sm font-medium">Upload resumes and supporting documents</p>
        <ResumeAwareUploadForm
          action={uploadMemoryDocument}
          mode="supporting"
          hiddenFields={{ section: "supporting" }}
          submitLabel="Upload and extract"
        />
      </div>

      {data.documents.length > 0 ? (
        <section>
          <h3 className="text-sm font-medium">Your documents</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {data.documents.map((doc) => (
              <li key={doc.id}>
                <DocumentCard document={doc} href={`/app/documents`} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );

  const answersPanel = (
    <SavedAnswersPanel
      facts={data.facts
        .filter((fact) => fact.category === "answers")
        .map((fact) => {
          const value = fact.value as { text?: string; label?: string };
          return {
            id: fact.id,
            label: String(value.label ?? fact.excerpt ?? "Saved question").trim() || "Saved question",
            text: String(value.text ?? "").trim(),
            source: fact.source,
          };
        })}
    />
  );

  let panel: ReactNode;
  if (section === "personal") panel = personalPanel;
  else if (section === "skills") panel = skillsPanel;
  else if (section === "links") panel = linksPanel;
  else if (section === "supporting") panel = supportingPanel;
  else if (section === "answers") panel = answersPanel;
  else if (evidenceSections.includes(section)) panel = evidencePanel(section);
  else panel = personalPanel;

  const activeLabel = MEMORY_SECTIONS.find((item) => item.id === section)?.label ?? "Personal";

  const documentUploadBar = (
    <Card className="p-4" data-tour="kit-uploads">
      <p className="text-xs text-ink-muted">
        Resume {kit.hasResume ? "ready" : "missing"} · {CNIC_PHARM_B_LABEL}{" "}
        {kit.hasCnicPharmB ? "ready" : "missing"}. Name other documents exactly as application forms ask — we match
        and attach them automatically.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl border border-sand/50 p-3">
          <p className="text-sm font-medium">Resume / CV</p>
          <div className="mt-2">
            <ResumeAwareUploadForm
              action={uploadMemoryDocument}
              mode="kit"
              compact
              hiddenFields={{ section }}
              submitLabel="Upload resume"
            />
          </div>
        </div>
        <KitDocumentUploadForm
          action={uploadMemoryDocument}
          className="rounded-xl border border-sand/50 p-3"
          compactUseInKit
          showUseInKit={false}
        >
          {hiddenSection}
          <p className="text-sm font-medium">{CNIC_PHARM_B_LABEL}</p>
          <Field label="Document type" htmlFor="kit-id-doc-type">
            <Select id="kit-id-doc-type" name="type" defaultValue="identity_document">
              <option value="identity_document">CNIC</option>
              <option value="family_document">Pharm-B</option>
            </Select>
          </Field>
          <input type="hidden" name="label" value={CNIC_PHARM_B_LABEL} />
          <Input id="kit-id-doc-file" name="file" type="file" required accept=".txt,.md,.pdf,.docx" />
          <UseInKitField defaultChecked compact />
          <UploadSubmitButton>Upload</UploadSubmitButton>
        </KitDocumentUploadForm>
        <KitDocumentUploadForm
          action={uploadMemoryDocument}
          className="grid gap-2 rounded-xl border border-sand/50 p-3 md:col-span-2 lg:col-span-1"
          compactUseInKit
          showUseInKit={false}
        >
          {hiddenSection}
          <input type="hidden" name="type" value="other" />
          <p className="text-sm font-medium">Other document</p>
          <Field label="Document name" htmlFor="kit-other-label" hint="Use the same name as on the application form">
            <Input
              id="kit-other-label"
              name="label"
              required
              placeholder="e.g. Official transcript, Cover letter"
              maxLength={120}
            />
          </Field>
          <Input id="kit-other-file" name="file" type="file" required accept=".txt,.md,.pdf,.docx" />
          <UseInKitField defaultChecked compact />
          <UploadSubmitButton>Upload</UploadSubmitButton>
        </KitDocumentUploadForm>
      </div>
    </Card>
  );

  return (
    <div className="mt-8 grid gap-6">
      {documentUploadBar}
      {nav}
      <Card className="p-6">
        <h2 className="text-lg font-medium">{activeLabel}</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Upload once — resume, {CNIC_PHARM_B_LABEL}, named documents, and supporting files auto-fill every kit section from extracted text.
        </p>
        <p className="mt-2 text-xs text-ink-muted">
          Kit loaded: {data.evidence.length} entries · {data.skills.length} skills
          {data.evidence.length === 0
            ? " — if you just uploaded, wait for processing then refresh."
            : null}
        </p>
        <div className="mt-6">{panel}</div>
      </Card>
    </div>
  );
}
