export function nextVersionLabel(existingLabels: string[]): string {
  let max = 0;
  for (const label of existingLabels) {
    const match = /^v(\d+)$/i.exec(label.trim());
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  return `v${max + 1}`;
}

export function formatDocumentType(type: string): string {
  return type.replace(/_/g, " ");
}
