export function parseUseInKit(formData: FormData): boolean {
  return String(formData.get("useInKit") ?? "") === "on";
}

export function uploadQueuedNotice(useInKit: boolean): "stored_only" | "document_processing" {
  return useInKit ? "document_processing" : "stored_only";
}

export function uploadProcessingNotice(input: {
  useInKit: boolean;
  textExtracted: boolean;
  kitFilled?: boolean;
  remainingBlanks?: number;
  fieldsWritten?: number;
}): "stored_only" | "binary_stored" | "kit_updated" | "kit_updated_partial" | "kit_fill_failed" {
  if (!input.useInKit) return "stored_only";
  if (!input.textExtracted) return "binary_stored";
  // Only treat as filled when THIS run wrote something — not pre-existing kit content.
  if ((input.fieldsWritten ?? 0) > 0) {
    return (input.remainingBlanks ?? 0) > 0 ? "kit_updated_partial" : "kit_updated";
  }
  return "kit_fill_failed";
}
