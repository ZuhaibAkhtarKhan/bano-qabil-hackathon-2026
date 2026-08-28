export async function extractDocumentText(file: File): Promise<string> {
  const mime = file.type;
  if (mime === "text/plain" || mime === "text/markdown" || file.name.match(/\.(txt|md)$/i)) {
    return file.text();
  }
  const buffer = await file.arrayBuffer();
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }
  if (mime === "application/pdf" || file.name.endsWith(".pdf")) {
    throw new Error("PDF text extraction runs on the server via AI. Upload through the document pipeline.");
  }
  throw new Error("Use PDF, DOCX, TXT, or Markdown files.");
}