"use client";

import { useState } from "react";

import { ResumeCategoryFields } from "@/components/app/resume-category-fields";
import { UseInKitField } from "@/components/app/use-in-kit-field";
import { SubmitButton } from "@/components/ui/button";
import { Field, FileUpload, Input, Select } from "@/components/ui/field";
import { DOCUMENT_TYPE_LABELS, documentTypeSchema } from "@1apply/contracts";
import { formatDocumentType } from "@/lib/documents/versioning";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  mode: "kit" | "documents" | "supporting";
  hiddenFields?: Record<string, string>;
  submitLabel?: string;
  compact?: boolean;
  showUseInKit?: boolean;
  defaultUseInKit?: boolean;
};

export function ResumeAwareUploadForm({
  action,
  mode,
  hiddenFields,
  submitLabel,
  compact = false,
  showUseInKit = true,
  defaultUseInKit = true,
}: Props) {
  const [type, setType] = useState(mode === "kit" ? "resume" : "resume");
  const isResume = type === "resume" || type === "resume_variant";

  return (
    <form action={action} className={compact ? "grid gap-2" : "grid gap-4"}>
      {hiddenFields
        ? Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      {mode === "kit" ? <input type="hidden" name="type" value="resume" /> : null}

      {mode === "documents" || mode === "supporting" ? (
        <Field label="Type" htmlFor={`${mode}-type`}>
          <Select id={`${mode}-type`} name="type" value={type} onChange={(event) => setType(event.target.value)} required>
            {mode === "supporting" ? (
              <>
                <option value="resume">Resume / CV</option>
                <option value="identity_document">CNIC / national ID</option>
                <option value="family_document">B-form / family document</option>
                <option value="transcript">Transcript</option>
                <option value="other">Supporting document</option>
              </>
            ) : (
              documentTypeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {DOCUMENT_TYPE_LABELS[option] ?? formatDocumentType(option)}
                </option>
              ))
            )}
          </Select>
        </Field>
      ) : null}

      {isResume ? (
        <ResumeCategoryFields idPrefix={`${mode}-resume`} compact={compact} />
      ) : mode !== "kit" ? (
        <Field label="Label" htmlFor={`${mode}-label`}>
          <Input id={`${mode}-label`} name="label" required placeholder="Document label" />
        </Field>
      ) : null}

      <FileUpload
        id={`${mode}-file`}
        label={isResume ? "Resume file" : "File"}
        accept=".txt,.md,.pdf,.docx,text/plain,application/pdf"
        hint={
          compact || !isResume
            ? undefined
            : "Same category on Memory, onboarding, or Documents appends the next version (v1, v2, …)."
        }
      />
      {showUseInKit ? <UseInKitField defaultChecked={defaultUseInKit} compact={compact} /> : null}
      <SubmitButton pendingText="Uploading" size={compact ? "sm" : "md"}>
        {submitLabel ?? (isResume ? "Upload resume" : "Upload")}
      </SubmitButton>
    </form>
  );
}
