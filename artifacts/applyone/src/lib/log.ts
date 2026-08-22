const SENSITIVE_KEY =
  /password|secret|token|authorization|cookie|email|phone|resume|document|prompt|answer|content|api[-_]?key|ssn/i;

function redact(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)]),
    );
  }
  return value;
}

export function logInfo(event: string, metadata: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      level: "info",
      event,
      metadata: redact(metadata),
      time: new Date().toISOString(),
    }),
  );
}

export function logError(event: string, metadata: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      metadata: redact(metadata),
      time: new Date().toISOString(),
    }),
  );
}
