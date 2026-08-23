import { PageHeader, WorkspaceMain } from "@/components/app/page-header";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { DocumentCard } from "@/components/ui/product-cards";
import { loadDocumentsWorkspace } from "@/server/workspace/queries";

export default async function ResumesPage() {
  const { documents } = await loadDocumentsWorkspace();
  const resumes = documents.filter((document) => document.type === "resume");

  return (
    <WorkspaceMain>
      <PageHeader
        eyebrow="Resumes"
        title="Versions you can attach"
        body="Resumes live in your private vault. This list is empty until you upload one — nothing is invented for a demo."
        actions={<ButtonLink href="/app/documents">Upload a file</ButtonLink>}
      />
      {resumes.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            eyebrow="Empty"
            title="No resumes on file"
            body="Upload a resume in Documents. Match scoring stays blank until a real file exists."
            actions={<ButtonLink href="/app/documents">Open documents</ButtonLink>}
          />
        </div>
      ) : (
        <ul className="mt-8 grid max-w-2xl gap-4">
          {resumes.map((document) => (
            <li key={document.id}>
              <DocumentCard document={document} href="/app/documents" />
            </li>
          ))}
        </ul>
      )}
    </WorkspaceMain>
  );
}
