import { createApiEnvelopeSchema, uuidSchema } from "@1apply/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { loadAppConfig } from "@/config/env";
import { ApiAuthError, apiAuthResponse, requireApiSession } from "@/server/auth/require-api";
import { extensionPreflight, withExtensionCors } from "@/server/auth/extension-cors";

const envelope = createApiEnvelopeSchema(
  z.object({
    versionId: uuidSchema,
    documentId: uuidSchema,
    filename: z.string(),
    mimeType: z.string(),
    byteSize: z.number(),
    base64: z.string(),
  }),
);

export function OPTIONS(request: Request) {
  return extensionPreflight(request);
}

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const requestId = crypto.randomUUID();
  const { versionId } = await context.params;
  const parsedId = uuidSchema.safeParse(versionId);
  if (!parsedId.success) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "VALIDATION", message: "Invalid document version." }, requestId }),
        { status: 400 },
      ),
    );
  }

  let session;
  try {
    session = await requireApiSession(request);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return withExtensionCors(request, apiAuthResponse(error, envelope, requestId));
    }
    throw error;
  }

  const { data: version } = await session.supabase
    .from("document_versions")
    .select("id, document_id, storage_path, mime_type, byte_size, original_filename, user_id")
    .eq("id", parsedId.data)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!version) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "NOT_FOUND", message: "Document version not found." }, requestId }),
        { status: 404 },
      ),
    );
  }

  if (!String(version.storage_path).startsWith(`${session.user.id}/`)) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "FORBIDDEN", message: "Document path is not owned by this user." }, requestId }),
        { status: 403 },
      ),
    );
  }

  const bucket = loadAppConfig().storageBucket;
  const { data: blob, error } = await session.supabase.storage.from(bucket).download(String(version.storage_path));
  if (error || !blob) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "STORAGE", message: "Could not download document bytes." }, requestId }),
        { status: 502 },
      ),
    );
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  if (buffer.byteLength > 8 * 1024 * 1024) {
    return withExtensionCors(
      request,
      NextResponse.json(
        envelope.parse({ data: null, error: { code: "TOO_LARGE", message: "Document exceeds the 8 MB extension attach limit." }, requestId }),
        { status: 413 },
      ),
    );
  }

  return withExtensionCors(
    request,
    NextResponse.json(
      envelope.parse({
        data: {
          versionId: version.id,
          documentId: version.document_id,
          filename: version.original_filename || "document.pdf",
          mimeType: version.mime_type || "application/pdf",
          byteSize: version.byte_size ?? buffer.byteLength,
          base64: buffer.toString("base64"),
        },
        error: null,
        requestId,
      }),
    ),
  );
}
