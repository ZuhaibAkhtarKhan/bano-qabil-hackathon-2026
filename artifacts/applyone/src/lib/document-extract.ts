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
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    }));
    return pages.join("\n\n");
  }
  throw new Error("Use PDF, DOCX, TXT, or Markdown files.");
}