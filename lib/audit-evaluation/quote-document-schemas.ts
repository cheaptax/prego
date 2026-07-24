import { z } from "zod";
import { isWonAmount } from "@/lib/audit-evaluation/money";
import {
  STANDARD_QUOTE_DOCUMENT_FORMATS,
  type TrustedStandardQuotePayload,
  type WonAmount,
} from "@/lib/audit-evaluation/types";

export const QUOTE_DOCUMENT_ID_PATTERN =
  /^qd_[A-Za-z0-9_-]{24}$/;
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const INTEGRITY_TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/;

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_ITEM_ID = /^[a-z][a-zA-Z0-9._-]{0,79}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DANGEROUS_TEXT =
  /<\s*\/?\s*(script|style|iframe|object|embed)\b|on[a-z]+\s*=|javascript\s*:/i;

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !DANGEROUS_TEXT.test(value), {
      message: "Executable markup is not allowed.",
    });

const wonAmountSchema = z.custom<WonAmount>(
  (value) => isWonAmount(value),
  "A canonical integer won amount is required.",
);

const experienceSummarySchema = z
  .object({
    hasExperience: z.boolean(),
    descriptions: z.array(safeText(500)).max(100),
  })
  .strict();

const engagementPartnerSchema = z
  .object({
    name: safeText(200),
    title: safeText(200).nullable(),
    yearsOfExperience: z.number().int().nonnegative().max(100).nullable(),
  })
  .strict();

const engagementTeamMemberSchema = z
  .object({
    name: safeText(200),
    role: safeText(200),
    plannedHours: z.number().int().nonnegative().safe().nullable(),
  })
  .strict();

const auditScheduleItemSchema = z
  .object({
    id: z.string().regex(SAFE_ITEM_ID),
    label: safeText(200),
    startsOn: z.string().regex(DATE_ONLY).nullable(),
    endsOn: z.string().regex(DATE_ONLY).nullable(),
  })
  .strict()
  .refine(
    (item) =>
      !item.startsOn ||
      !item.endsOn ||
      Date.parse(item.startsOn) <= Date.parse(item.endsOn),
    "Schedule end date must not precede its start date.",
  );

const proposalItemValueSchema = z
  .object({
    present: z.boolean(),
    value: safeText(2_000).nullable(),
  })
  .strict();

export const trustedStandardQuotePayloadSchema: z.ZodType<TrustedStandardQuotePayload> =
  z
    .object({
      accountingFirmId: z.string().regex(SAFE_ID),
      accountingFirmName: safeText(300),
      auditFee: wonAmountSchema,
      vatIncluded: z.boolean(),
      accountingFirmRevenue: wonAmountSchema,
      recentNonghyupAuditCount: z.number().int().nonnegative().safe(),
      auditedNonghyupTypes: z.array(safeText(200)).max(100),
      taxAgencyExperience: experienceSummarySchema,
      subsidySettlementExperience: experienceSummarySchema,
      engagementPartner: engagementPartnerSchema,
      engagementTeam: z.array(engagementTeamMemberSchema).min(1).max(100),
      totalPlannedHours: z.number().int().positive().safe(),
      partnerHours: z.number().int().nonnegative().safe(),
      auditSchedule: z.array(auditScheduleItemSchema).max(100),
      qualityControlPlan: z.array(safeText(2_000)).max(100),
      requiredProposalItems: z.record(
        z.string().regex(SAFE_ITEM_ID),
        proposalItemValueSchema,
      ),
    })
    .strict()
    .superRefine((payload, context) => {
      if (payload.partnerHours > payload.totalPlannedHours) {
        context.addIssue({
          code: "custom",
          path: ["partnerHours"],
          message: "Partner hours cannot exceed total planned hours.",
        });
      }
      requireUnique(payload.auditedNonghyupTypes, context, [
        "auditedNonghyupTypes",
      ]);
      requireUnique(
        payload.auditSchedule.map(({ id }) => id),
        context,
        ["auditSchedule"],
      );
    });

const versionReferenceSchema = z
  .object({
    id: z.string().regex(SAFE_ID),
    version: z.number().int().positive(),
  })
  .strict();

export const quoteDocumentIdentitySchema = z
  .object({
    signatureVersion: z.literal(1),
    quoteDocumentId: z.string().regex(QUOTE_DOCUMENT_ID_PATTERN),
    quoteRequestId: z.string().regex(SAFE_ID),
    fiscalYear: z.number().int().min(2_000).max(9_999),
    templateVersion: versionReferenceSchema,
    payloadChecksum: z.string().regex(SHA256_PATTERN),
    integrityToken: z.string().regex(INTEGRITY_TOKEN_PATTERN),
  })
  .strict();

const actorSchema = z.discriminatedUnion("type", [
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

export const standardQuoteDocumentRecordSchema =
  quoteDocumentIdentitySchema
    .extend({
      documentFormat: z.enum(STANDARD_QUOTE_DOCUMENT_FORMATS),
      normalizedPayload: trustedStandardQuotePayloadSchema,
      originalDocumentSha256: z.string().regex(SHA256_PATTERN),
      verificationCode: z.string().regex(/^NHAQ-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
      status: z.enum(["ACTIVE", "REVOKED"]),
      registeredAt: z.string().datetime({ offset: true }),
      registeredBy: actorSchema,
    })
    .strict();

function requireUnique(
  values: readonly string[],
  context: z.RefinementCtx,
  path: PropertyKey[],
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      path,
      message: "Values must be unique.",
    });
  }
}
