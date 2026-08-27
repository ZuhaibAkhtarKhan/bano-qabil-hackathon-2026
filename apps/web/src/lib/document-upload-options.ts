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
}): "stored_only" | "binary_stored" | "kit_updated" | "kit_updated_partial" | "kit_fill_failed" {
  if (!input.useInKit) return "stored_only";
  if (!input.textExtracted) return "binary_stored";
  if (input.kitFilled) {
    return (input.remainingBlanks ?? 0) > 0 ? "kit_updated_partial" : "kit_updated";
  }
  return "kit_fill_failed";
}
