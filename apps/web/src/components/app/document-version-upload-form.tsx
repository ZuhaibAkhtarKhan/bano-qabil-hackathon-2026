"use client";

import { KitDocumentUploadForm, UploadSubmitButton } from "@/components/app/kit-document-upload-form";
import { FileUpload } from "@/components/ui/field";
import { uploadDocumentVersion } from "@/server/documents/actions";

export function DocumentVersionUploadForm({ documentId }: { documentId: string }) {
  return (
    <KitDocumentUploadForm action={uploadDocumentVersion} className="mt-4 grid gap-4">
      <input type="hidden" name="documentId" value={documentId} />
      <FileUpload id="version-file" label="File" accept=".txt,.md,.pdf,.docx,text/plain,application/pdf" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="setAsCurrent" value="true" defaultChecked />
        Set as latest version after upload
      </label>
      <UploadSubmitButton variant="secondary" size="md">
        Upload version
      </UploadSubmitButton>
    </KitDocumentUploadForm>
  );
}
