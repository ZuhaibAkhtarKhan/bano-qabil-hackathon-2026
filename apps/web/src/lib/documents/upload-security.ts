import { createHash } from "node:crypto";

export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;

export const TEXT_MIME_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export class UploadValidationError extends Error {
  constructor(
    readonly code: "required" | "upload" | "unsafe",
    message: string,
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? "document";
  const safe = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return safe || "document";
}

export function assertSafePathSegment(value: string): void {
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new UploadValidationError("unsafe", "Unsafe path segment");
  }
}

function extensionMime(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXTENSION)) {
    if (lower.endsWith(ext)) return mime;
  }
  return null;
}

export function resolveUploadMimeType(fileName: string, reported: string): string | null {
  const fromExt = extensionMime(fileName);
  if (!fromExt) return null;
  if (!reported || reported === "application/octet-stream") return fromExt;
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(reported)) return null;
  if (reported === fromExt) return fromExt;
  if (TEXT_MIME_TYPES.has(reported) && TEXT_MIME_TYPES.has(fromExt)) return fromExt;
  return null;
}

export function assertUploadMagicBytes(buffer: Buffer, mimeType: string): void {
  if (mimeType === "application/pdf") {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new UploadValidationError("upload", "File contents do not match the PDF type");
    }
    return;
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new UploadValidationError("upload", "File contents do not match the DOCX type");
    }
    return;
  }
  if (TEXT_MIME_TYPES.has(mimeType) && buffer.includes(0)) {
    throw new UploadValidationError("upload", "Text uploads cannot contain binary data");
  }
}

export function chunkDocumentText(text: string, chunkSize = 1600, maxChunks = 60): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 0 && chunks.length < maxChunks) {
    chunks.push(remaining.slice(0, chunkSize));
    remaining = remaining.slice(chunkSize);
  }
  return chunks;
}

export async function readValidatedUpload(file: File): Promise<{
  buffer: Buffer;
  mimeType: string;
  fileHash: string;
  originalFilename: string;
  sanitizedFilename: string;
  isText: boolean;
}> {
  if (!(file instanceof File) || file.size === 0) {
    throw new UploadValidationError("required", "File is required");
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new UploadValidationError("upload", "File exceeds size limit");
  }

  const originalFilename = file.name.trim() || "document";
  const sanitizedFilename = sanitizeFileName(originalFilename);
  const mimeType = resolveUploadMimeType(originalFilename, file.type);
  if (!mimeType) {
    throw new UploadValidationError("upload", "Unsupported file type");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    throw new UploadValidationError("upload", "Empty file");
  }
  if (buffer.length > DOCUMENT_MAX_BYTES) {
    throw new UploadValidationError("upload", "File exceeds size limit");
  }
  assertUploadMagicBytes(buffer, mimeType);

  return {
    buffer,
    mimeType,
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    originalFilename,
    sanitizedFilename,
    isText: TEXT_MIME_TYPES.has(mimeType),
  };
}

export { extractDocumentText, extractTextFromBuffer } from "@/lib/documents/extract-text";
