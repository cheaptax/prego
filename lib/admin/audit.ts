import type {
  AdminAuditLogInput,
  AuditLogRecord,
  AuditLogSnapshot,
  AuditLogValue,
} from "@/lib/firebase/schema";

const SENSITIVE_AUDIT_KEY =
  /(password|passcode|token|secret|authorization|cookie|private.?key|reset.?link|credential)/i;
const REDACTED = "[REDACTED]";
const MAX_AUDIT_DEPTH = 8;

function sanitizeAuditValue(
  value: unknown,
  depth: number,
): AuditLogValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_AUDIT_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeAuditValue(item, depth + 1))
      .filter((item): item is AuditLogValue => item !== undefined);
  }
  if (typeof value === "object") {
    const sanitized: Record<string, AuditLogValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_AUDIT_KEY.test(key)) {
        sanitized[key] = REDACTED;
        continue;
      }
      const cleanEntry = sanitizeAuditValue(entry, depth + 1);
      if (cleanEntry !== undefined) sanitized[key] = cleanEntry;
    }
    return sanitized;
  }
  return String(value);
}

export function sanitizeAuditSnapshot(
  value: Record<string, unknown> | undefined,
): AuditLogSnapshot | undefined {
  if (!value) return undefined;
  return sanitizeAuditValue(value, 0) as AuditLogSnapshot;
}

function sanitizeAuditMetadata(
  value: AdminAuditLogInput["metadata"],
) {
  if (!value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_AUDIT_KEY.test(key) ? REDACTED : entry,
    ]),
  );
}

export function prepareAdminAuditLog(
  input: AdminAuditLogInput,
): Omit<AuditLogRecord, "id"> {
  return {
    actorUid: input.actorId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: input.actorRole,
    requiredPermission: input.requiredPermission,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: sanitizeAuditSnapshot(input.before),
    after: sanitizeAuditSnapshot(input.after),
    requestId: input.requestId,
    scope: input.scope,
    result: input.result ?? "success",
    metadata: sanitizeAuditMetadata(input.metadata),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
