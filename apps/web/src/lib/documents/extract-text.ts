import { inflateRawSync } from "node:zlib";

import { extractPdfTextWithAi, PDF_MAX_TEXT } from "@/lib/documents/extract-pdf-ai";

const MAX_TEXT = PDF_MAX_TEXT;

function zipEntry(buffer: Buffer, fileName: string): Buffer | null {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) return null;
    if (name === fileName) {
      const data = buffer.subarray(dataStart, dataEnd);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

export function extractDocxText(buffer: Buffer): string | null {
  try {
    const xml = zipEntry(buffer, "word/document.xml");
    if (!xml) return null;
    const texts = [...xml.toString("utf8").matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((item) => item[1]);
    const joined = texts.join(" ").replace(/\s+/g, " ").trim();
    return joined ? joined.slice(0, MAX_TEXT) : null;
  } catch {
    return null;
  }
}

/** PDF text extraction via the configured OpenAI-compatible vision/document API. */
export async function extractPdfText(
  buffer: Buffer,
  options?: { fileName?: string },
): Promise<string | null> {
  return extractPdfTextWithAi(buffer, options);
}

async function extractDocxWithMammoth(buffer: Buffer): Promise<string | null> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const cleaned = String(result.value ?? "").replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.slice(0, MAX_TEXT) : null;
  } catch {
    return null;
  }
}

/** Sync helpers for plain text / DOCX fallback. PDF requires async AI extraction via extractDocumentText. */
export function extractTextFromBuffer(buffer: Buffer, mimeType: string): string | null {
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/x-markdown") {
    return buffer.toString("utf8").slice(0, MAX_TEXT);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocxText(buffer);
  }
  if (mimeType === "application/pdf") {
    return null;
  }
  return null;
}

export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  options?: { fileName?: string },
): Promise<string | null> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer, options);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return (await extractDocxWithMammoth(buffer)) ?? extractDocxText(buffer);
  }
  return extractTextFromBuffer(buffer, mimeType);
}
