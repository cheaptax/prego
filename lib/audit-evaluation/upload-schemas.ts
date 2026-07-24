import { z } from "zod";
import {
  QUOTE_INTEGRITY_STATUSES,
  QUOTE_PARSING_QUEUE_STATUSES,
  QUOTE_PARSING_STATUSES,
  QUOTE_SCAN_STATUSES,
  QUOTE_UPLOAD_INTENT_STATUSES,
  QUOTE_UPLOAD_STATUSES,
  type QuoteParsingQueueRecord,
  type QuoteUploadIntent,
  type UploadedQuoteDocument,
} from "@/lib/audit-evaluation/types";
import { QUOTE_DOCUMENT_MATCH_STATUSES } from "@/lib/audit-evaluation/types";
import {
  AUDIT_EVALUATION_STORAGE_PREFIXES,
} from "@/lib/audit-evaluation/upload-identity";

const RESOURCE_ID = /^[a-z][a-zA-Z0-9_-]{8,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const instant = z.string().datetime({ offset: true });
const displayName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((value) => !/[\u0000-\u001f\u007f\\/]/.test(value));

const actor = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ADMIN"),
      uid: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("CUSTOMER"),
      subjectId: z.string().trim().min(1).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal("SYSTEM"),
      service: z.string().trim().min(1).max(128),
    })
    .strict(),
]);

export const quoteUploadIntentSchema: z.ZodType<QuoteUploadIntent> = z
  .object({
    id: z.string().regex(RESOURCE_ID),
    caseId: z.string().regex(RESOURCE_ID),
    documentId: z.string().regex(RESOURCE_ID),
    idempotencyKeyHash: z.string().regex(SHA256),
    originalFileName: displayName,
    safeDisplayName: displayName,
    extension: z.literal(".pdf"),
    mimeType: z.literal("application/pdf"),
    declaredSize: z.number().int().positive(),
    quarantineStoragePath: z
      .string()
      .startsWith(`${AUDIT_EVALUATION_STORAGE_PREFIXES.quarantine}/`)
      .max(500),
    status: z.enum(QUOTE_UPLOAD_INTENT_STATUSES),
    scanStatus: z.enum(QUOTE_SCAN_STATUSES),
    failureCode: z.string().trim().min(1).max(100).nullable(),
    expiresAt: instant,
    createdAt: instant,
    completedAt: instant.nullable(),
  })
  .strict();

export const uploadedQuoteDocumentSchema: z.ZodType<UploadedQuoteDocument> =
  z
    .object({
      id: z.string().regex(RESOURCE_ID),
      caseId: z.string().regex(RESOURCE_ID),
      originalFileName: displayName,
      safeDisplayName: displayName,
      storagePath: z
        .string()
        .startsWith(
          `${AUDIT_EVALUATION_STORAGE_PREFIXES.originals}/`,
        )
        .max(500),
      mimeType: z.literal("application/pdf"),
      size: z.number().int().positive(),
      sha256: z.string().regex(SHA256),
      uploadStatus: z.enum(QUOTE_UPLOAD_STATUSES),
      scanStatus: z.enum(QUOTE_SCAN_STATUSES),
      parsingStatus: z.enum(QUOTE_PARSING_STATUSES),
      matchedQuoteDocumentId: z
        .string()
        .regex(/^qd_[A-Za-z0-9_-]{24}$/)
        .nullable(),
      matchStatus: z.enum(QUOTE_DOCUMENT_MATCH_STATUSES).nullable(),
      integrityStatus: z.enum(QUOTE_INTEGRITY_STATUSES),
      uploadedAt: instant,
      uploadedBy: actor,
      deletedAt: instant.nullable(),
      deletedBy: actor.nullable(),
    })
    .strict();

export const quoteParsingQueueRecordSchema: z.ZodType<QuoteParsingQueueRecord> =
  z
    .object({
      id: z.string().regex(RESOURCE_ID),
      caseId: z.string().regex(RESOURCE_ID),
      documentId: z.string().regex(RESOURCE_ID),
      status: z.enum(QUOTE_PARSING_QUEUE_STATUSES),
      attempts: z.number().int().nonnegative(),
      availableAt: instant,
      createdAt: instant,
      updatedAt: instant,
      lastErrorCode: z.string().trim().min(1).max(100).nullable(),
    })
    .strict();
