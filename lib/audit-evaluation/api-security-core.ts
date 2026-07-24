const JSON_MEDIA_TYPE = "application/json";

export class AuditEvaluationApiSecurityError extends Error {
  constructor(
    readonly code:
      | "invalid_origin"
      | "invalid_content_type"
      | "payload_too_large"
      | "invalid_json"
      | "rate_limited",
  ) {
    super(code);
    this.name = "AuditEvaluationApiSecurityError";
  }
}

export function assertTrustedMutationRequest(
  request: Request,
  options: { requireJson?: boolean } = {},
) {
  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set<string>([requestUrl.origin]);
  expandLoopbackOrigins(allowedOrigins, requestUrl);
  const configured = process.env.AUDIT_EVALUATION_BASE_URL?.trim();
  if (configured) {
    try {
      const configuredUrl = new URL(configured);
      allowedOrigins.add(configuredUrl.origin);
      expandLoopbackOrigins(allowedOrigins, configuredUrl);
    } catch {
      // Invalid server configuration never broadens the origin allowlist.
    }
  }

  const requestOrigin = resolveTrustedRequestOrigin(request);
  if (!requestOrigin || !allowedOrigins.has(requestOrigin)) {
    throw new AuditEvaluationApiSecurityError("invalid_origin");
  }
  if (options.requireJson !== false) {
    const mediaType = request.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== JSON_MEDIA_TYPE) {
      throw new AuditEvaluationApiSecurityError("invalid_content_type");
    }
  }
}

function resolveTrustedRequestOrigin(request: Request) {
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin;
  // Some browsers/automation omit Origin on same-site POSTs; Referer is then
  // the next-best same-site signal and must still match the allowlist.
  const referer = request.headers.get("referer")?.trim();
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function expandLoopbackOrigins(origins: Set<string>, url: URL) {
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return;
  const port = url.port ? `:${url.port}` : "";
  origins.add(`${url.protocol}//localhost${port}`);
  origins.add(`${url.protocol}//127.0.0.1${port}`);
}

export async function readLimitedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new AuditEvaluationApiSecurityError("payload_too_large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) {
    throw new AuditEvaluationApiSecurityError("payload_too_large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AuditEvaluationApiSecurityError("invalid_json");
  }
}

export function nextRateLimitState(
  current: {
    count?: unknown;
    windowStartedAt?: unknown;
  } | null,
  now: string,
  windowMs: number,
  maximumAttempts: number,
) {
  const nowMs = Date.parse(now);
  const currentStartedAt =
    typeof current?.windowStartedAt === "string"
      ? Date.parse(current.windowStartedAt)
      : Number.NaN;
  const withinWindow =
    Number.isFinite(currentStartedAt) &&
    nowMs - currentStartedAt < windowMs;
  const count =
    withinWindow && typeof current?.count === "number" &&
      Number.isInteger(current.count)
      ? current.count + 1
      : 1;
  return {
    allowed: count <= maximumAttempts,
    count,
    windowStartedAt:
      withinWindow && typeof current?.windowStartedAt === "string"
        ? current.windowStartedAt
        : now,
  };
}
