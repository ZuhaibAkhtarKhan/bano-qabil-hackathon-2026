import { documentTypeSchema } from "@1apply/contracts";

import { FlashBanner } from "@/components/app/flash-banner";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { Field, FileUpload, Input, Select } from "@/components/ui/field";
import { DocumentCard } from "@/components/ui/product-cards";
import { formatDocumentType } from "@/lib/documents/versioning";
import { uploadDocument } from "@/server/documents/actions";
import { loadDocumentsWorkspace } from "@/server/workspace/queries";

const TYPE_LABELS: Record<string, string> = {
  resume: "Resume",
  resume_variant: "Resume variant",
  cover_letter: "Cover letter",
  transcript: "Transcript",
  certificate: "Certificate",
  portfolio: "Portfolio",
  supporting_document: "Supporting document",
  other: "Other application document",
};

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
  const { documents } = await loadDocumentsWorkspace();

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Documents"
        title="Private vault with version history"
        body="Every upload creates a version. Attach an explicit version to applications; frozen snapshots preserve what you submitted."
      />
      <FlashBanner notice={notice} error={error} />

      <Card className="mt-8 max-w-xl p-6">
        <form action={uploadDocument} className="grid gap-4">
          <Field label="Label" htmlFor="document-label">
            <Input id="document-label" name="label" required placeholder="General resume" />
          </Field>
          <Field label="Type" htmlFor="document-type">
            <Select id="document-type" name="type" defaultValue="resume">
              {documentTypeSchema.options.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type] ?? formatDocumentType(type)}
                </option>
              ))}
            </Select>
          </Field>
          <FileUpload
            id="document-file"
            label="File"
            accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
          />
          <Button type="submit">Upload first version</Button>
        </form>
      </Card>

      {documents.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No files yet"
            body="Upload a resume or supporting document. Re-uploads create new versions without deleting history."
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-2xl gap-4">
          {documents.map((document) => (
            <li key={document.id}>
              <DocumentCard document={document} href={`/app/documents/${document.id}`} />
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
