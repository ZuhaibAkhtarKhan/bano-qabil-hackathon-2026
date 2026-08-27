import { DeleteDocumentButton } from "@/components/app/delete-document-button";
import { UploadFeedback } from "@/components/app/upload-feedback";
import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ResumeAwareUploadForm } from "@/components/app/resume-aware-upload-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/feedback";
import { DocumentCard } from "@/components/ui/product-cards";
import { uploadDocument } from "@/server/documents/actions";
import { loadDocumentsWorkspace } from "@/server/workspace/queries";

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
        eyebrow="Vault"
        title="Version history for kit files"
        body="Resumes use categories for your remembrance. Re-uploading the same category creates the next version by time. Deleting a file also removes extracted memory from that file."
      />
      <UploadFeedback notice={notice} error={error} />

      <Card className="mt-8 max-w-xl p-6">
        <ResumeAwareUploadForm action={uploadDocument} mode="documents" submitLabel="Upload" />
      </Card>

      {documents.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No files yet"
            body="Upload a resume or supporting document. Same resume category appends versions without deleting history."
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-2xl gap-4">
          {documents.map((document) => (
            <li key={document.id} className="grid gap-2">
              <DocumentCard document={document} href={`/app/documents/${document.id}`} />
              <div className="flex justify-end">
                <DeleteDocumentButton
                  documentId={document.id}
                  returnTo="/app/documents"
                  label="Delete document"
                  confirmMessage={`Delete “${document.label}” permanently? Extracted facts from it will also be removed from Application Memory.`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
