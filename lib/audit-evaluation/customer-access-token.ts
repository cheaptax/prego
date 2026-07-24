import { createHmac, randomBytes } from "node:crypto";

type EnvMap = Record<string, string | undefined>;

export const AUDIT_EVALUATION_SESSION_COOKIE =
  "nh_audit_evaluation_session";

export class AuditEvaluationAccessConfigurationError extends Error {
  readonly code = "audit_evaluation_access_not_configured";

  constructor() {
    super("A server-only audit evaluation access secret is required.");
    this.name = "AuditEvaluationAccessConfigurationError";
  }
}

export function getAuditEvaluationAccessSecret(
  env: EnvMap = process.env,
) {
  const secret = env.AUDIT_EVALUATION_ACCESS_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new AuditEvaluationAccessConfigurationError();
  }
  return secret;
}

export function createAuditEvaluationAccessToken() {
  return randomBytes(32).toString("base64url");
}

export function createAuditEvaluationCaseId() {
  return `aec_${randomBytes(18).toString("base64url")}`;
}

export function createAuditEvaluationSubjectId() {
  return `aes_${randomBytes(18).toString("base64url")}`;
}

export function hashAuditEvaluationAccessToken(
  token: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`access-token|${token}`, "utf8")
    .digest("hex");
}

export function hashAuditEvaluationSessionToken(
  token: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`session-token|${token}`, "utf8")
    .digest("hex");
}

export function auditEvaluationCaseMappingId(
  quoteRequestId: string,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(`case-mapping|${quoteRequestId}`, "utf8")
    .digest("hex");
}

export function addMinutes(isoNow: string, minutes: number) {
  return new Date(Date.parse(isoNow) + minutes * 60_000).toISOString();
}

export function addDays(isoNow: string, days: number) {
  return new Date(Date.parse(isoNow) + days * 86_400_000).toISOString();
}
