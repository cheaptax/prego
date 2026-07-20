import type { AuditQuoteConfig } from "@/lib/audit-quote/config";
import {
  isAllowedOrigin,
  isJsonContentType,
  resolveRequestOrigin,
} from "@/lib/audit-quote/security";

export type HttpGuardResult =
  | { ok: true; rawBody: string; origin: string }
  | { ok: false; error: string; status: number };

export async function guardAuditQuoteRequest(
  req: Request,
  config: Pick<AuditQuoteConfig, "maxBodyBytes" | "allowedOrigins">
): Promise<HttpGuardResult> {
  if (!isJsonContentType(req.headers.get("content-type"))) {
    return { ok: false, error: "unsupported_media_type", status: 415 };
  }

  const origin = resolveRequestOrigin(req);
  if (!isAllowedOrigin(origin, config.allowedOrigins)) {
    return { ok: false, error: "origin_not_allowed", status: 403 };
  }

  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
      return { ok: false, error: "payload_too_large", status: 413 };
    }
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    return { ok: false, error: "invalid_json", status: 400 };
  }

  if (Buffer.byteLength(rawBody, "utf8") > config.maxBodyBytes) {
    return { ok: false, error: "payload_too_large", status: 413 };
  }

  return { ok: true, rawBody, origin };
}
