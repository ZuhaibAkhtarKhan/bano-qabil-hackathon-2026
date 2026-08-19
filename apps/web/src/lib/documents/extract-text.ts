import { inflateRawSync, inflateSync } from "node:zlib";

const MAX_TEXT = 80_000;

function decodePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

function stringsFromPdfContent(content: string): string {
  const parts: string[] = [];
  const literal = /\((?:\\.|[^\\)])*\)/g;
  for (const match of content.matchAll(literal)) {
    parts.push(decodePdfString(match[0].slice(1, -1)));
  }
  const hex = /<([0-9A-Fa-f\s]+)>/g;
  for (const match of content.matchAll(hex)) {
    const hexes = (match[1] ?? "").replace(/\s+/g, "");
    if (hexes.length % 2 !== 0) continue;
    const chars: string[] = [];
    for (let i = 0; i < hexes.length; i += 2) {
      chars.push(String.fromCharCode(parseInt(hexes.slice(i, i + 2), 16)));
    }
    parts.push(chars.join(""));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function inflatePdfStream(bytes: Buffer): string | null {
  try {
    return inflateSync(bytes).toString("latin1");
  } catch {
    try {
      return inflateRawSync(bytes).toString("latin1");
    } catch {
      return null;
    }
  }
}

export function extractPdfText(buffer: Buffer): string | null {
  const source = buffer.toString("latin1");
  if (source.includes("/Encrypt")) return null;

  const chunks: string[] = [];
  const uncompressed = stringsFromPdfContent(source);
  if (uncompressed) chunks.push(uncompressed);

  const streamPattern = /stream\r?\n([\s\S]*?)endstream/g;
  for (const match of source.matchAll(streamPattern)) {
    const payload = Buffer.from(match[1] ?? "", "latin1");
    const inflated = inflatePdfStream(payload);
    if (!inflated) continue;
    const text = stringsFromPdfContent(inflated);
    if (text) chunks.push(text);
  }

  const joined = chunks.join(" ").replace(/\s+/g, " ").trim();
  return joined ? joined.slice(0, MAX_TEXT) : null;
}

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

export function extractTextFromBuffer(buffer: Buffer, mimeType: string): string | null {
  if (mimeType === "text/plain" || mimeType === "text/markdown" || mimeType === "text/x-markdown") {
    return buffer.toString("utf8").slice(0, MAX_TEXT);
  }
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocxText(buffer);
  }
  return null;
}
