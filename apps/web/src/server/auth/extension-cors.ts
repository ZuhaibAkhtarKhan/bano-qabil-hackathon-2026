import { NextResponse } from "next/server";

export function extensionCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "";
  if (!origin.startsWith("chrome-extension://")) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

export function withExtensionCors(request: Request, response: NextResponse): NextResponse {
  const headers = extensionCorsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export function extensionPreflight(request: Request): NextResponse {
  return withExtensionCors(request, new NextResponse(null, { status: 204 }));
}
