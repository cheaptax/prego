import { CMS_SCHEMA_VERSION, type CmsGlobalKey, type CmsPageKey } from "@/lib/cms/constants";
import { validatePageIdentity } from "@/lib/cms/defaults";
import {
  cmsDraftGlobalSchema,
  cmsDraftPageSchema,
  cmsPublishedGlobalSchema,
  cmsPublishedPageSchema,
  type CmsDraftGlobal,
  type CmsDraftPage,
  type CmsPublishedGlobal,
  type CmsPublishedPage,
} from "@/lib/cms/schemas";

type MigrationFailure = {
  success: false;
  error: "invalid_document" | "unsupported_schema_version" | "identity_mismatch";
  details?: unknown;
};

type MigrationSuccess<T> = {
  success: true;
  data: T;
  migratedFrom: number | null;
};

export type CmsMigrationResult<T> = MigrationSuccess<T> | MigrationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const migrations: Record<number, (value: Record<string, unknown>) => Record<string, unknown>> = {
  0: (value) => ({ ...value, schemaVersion: 1 }),
};

export function migrateCmsDocument(value: unknown) {
  if (!isRecord(value)) {
    return {
      success: false as const,
      error: "invalid_document" as const,
    };
  }

  const initialVersion =
    typeof value.schemaVersion === "number" &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion >= 0
      ? value.schemaVersion
      : 0;
  if (initialVersion > CMS_SCHEMA_VERSION) {
    return {
      success: false as const,
      error: "unsupported_schema_version" as const,
      details: initialVersion,
    };
  }

  let current = { ...value };
  let version = initialVersion;
  while (version < CMS_SCHEMA_VERSION) {
    const migration = migrations[version];
    if (!migration) {
      return {
        success: false as const,
        error: "unsupported_schema_version" as const,
        details: version,
      };
    }
    current = migration(current);
    version += 1;
  }

  return {
    success: true as const,
    data: current,
    migratedFrom: initialVersion === CMS_SCHEMA_VERSION ? null : initialVersion,
  };
}

export function parsePublishedPage(
  value: unknown,
  expectedPageKey: CmsPageKey,
): CmsMigrationResult<CmsPublishedPage> {
  const migrated = migrateCmsDocument(value);
  if (!migrated.success) return migrated;
  const parsed = cmsPublishedPageSchema.safeParse(migrated.data);
  if (!parsed.success) {
    return { success: false, error: "invalid_document", details: parsed.error.issues };
  }
  if (
    parsed.data.pageKey !== expectedPageKey ||
    !validatePageIdentity(parsed.data.pageKey, parsed.data.route, parsed.data.content).success
  ) {
    return { success: false, error: "identity_mismatch" };
  }
  return { success: true, data: parsed.data, migratedFrom: migrated.migratedFrom };
}

export function parseDraftPage(
  value: unknown,
  expectedPageKey: CmsPageKey,
): CmsMigrationResult<CmsDraftPage> {
  const migrated = migrateCmsDocument(value);
  if (!migrated.success) return migrated;
  const parsed = cmsDraftPageSchema.safeParse(migrated.data);
  if (!parsed.success) {
    return { success: false, error: "invalid_document", details: parsed.error.issues };
  }
  if (
    parsed.data.pageKey !== expectedPageKey ||
    !validatePageIdentity(parsed.data.pageKey, parsed.data.route, parsed.data.content).success
  ) {
    return { success: false, error: "identity_mismatch" };
  }
  return { success: true, data: parsed.data, migratedFrom: migrated.migratedFrom };
}

export function parsePublishedGlobal(
  value: unknown,
  expectedDocumentKey: CmsGlobalKey,
): CmsMigrationResult<CmsPublishedGlobal> {
  const migrated = migrateCmsDocument(value);
  if (!migrated.success) return migrated;
  const parsed = cmsPublishedGlobalSchema.safeParse(migrated.data);
  if (!parsed.success) {
    return { success: false, error: "invalid_document", details: parsed.error.issues };
  }
  if (parsed.data.documentKey !== expectedDocumentKey) {
    return { success: false, error: "identity_mismatch" };
  }
  return { success: true, data: parsed.data, migratedFrom: migrated.migratedFrom };
}

export function parseDraftGlobal(
  value: unknown,
  expectedDocumentKey: CmsGlobalKey,
): CmsMigrationResult<CmsDraftGlobal> {
  const migrated = migrateCmsDocument(value);
  if (!migrated.success) return migrated;
  const parsed = cmsDraftGlobalSchema.safeParse(migrated.data);
  if (!parsed.success) {
    return { success: false, error: "invalid_document", details: parsed.error.issues };
  }
  if (parsed.data.documentKey !== expectedDocumentKey) {
    return { success: false, error: "identity_mismatch" };
  }
  return { success: true, data: parsed.data, migratedFrom: migrated.migratedFrom };
}
