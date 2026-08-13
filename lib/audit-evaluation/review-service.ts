import { z } from "zod";
import {
  assertAuditEvaluationCapabilityEnabled,
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import {
  FirestoreAuditEvaluationReviewRepository,
  ReviewServiceError,
  type AuditEvaluationReviewRepository,
  type AuditEvaluationReviewWorkspace,
  type ConfirmCaseResult,
  type RequestReportResult,
  type SaveCustomerCorrectionResult,
} from "@/lib/audit-evaluation/review-repository";
import {
  customerFinalConfirmationSchema,
  customerQuoteCorrectionSchema,
  customerReportRequestSchema,
  CustomerCorrectionValueError,
  parseCustomerCorrectionValue,
} from "@/lib/audit-evaluation/review-schemas";
import type {
  AuditEvaluationActor,
  NormalizedAuditQuote,
  NormalizedAuditQuoteField,
} from "@/lib/audit-evaluation/types";

export {
  ReviewServiceError,
  reviewServiceErrorStatus,
} from "@/lib/audit-evaluation/review-repository";
import type { NhAuditReportEvaluationSnapshot } from "@/lib/audit-evaluation/nh-audit-report-snapshot";
export type {
  AuditEvaluationReviewRepository,
  AuditEvaluationReviewWorkspace,
  ConfirmCaseResult,
  RequestReportResult,
  ReviewWorkspaceDocument,
  ReviewWorkspaceQuote,
  SaveCustomerCorrectionResult,
} from "@/lib/audit-evaluation/review-repository";

const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const instantSchema = z.string().datetime({ offset: true });
const customerActorSchema = z
  .object({
    type: z.literal("CUSTOMER"),
    subjectId: z.string().trim().min(1).max(128),
  })
  .strict();

export type CustomerReviewActor = Extract<
  AuditEvaluationActor,
  { type: "CUSTOMER" }
>;

export type GetReviewWorkspaceInput = {
  caseId: string;
  now: string;
};

export type SaveCorrectionInput = {
  caseId: string;
  quoteId: string;
  field: NormalizedAuditQuoteField;
  valueText: string;
  reason: string;
  expectedRevision: number;
  actor: CustomerReviewActor;
  now: string;
};

export type ConfirmCaseInput = {
  caseId: string;
  expectedQuoteRevisions: Record<string, number>;
  finalAcknowledged: true;
  actor: CustomerReviewActor;
  now: string;
};

export type ConfirmPartnerInboxQuotesInput = {
  caseId: string;
  quotes: readonly NormalizedAuditQuote[];
  finalAcknowledged: true;
  actor: CustomerReviewActor;
  now: string;
  cooperativeNameSnapshot?: string;
  fiscalYear?: number;
};

export type RequestReportInput = {
  caseId: string;
  confirmationVersion: number;
  nhAuditEvaluationSnapshot?: NhAuditReportEvaluationSnapshot;
  actor: CustomerReviewActor;
  now: string;
};

export class AuditEvaluationReviewService {
  private readonly repository: AuditEvaluationReviewRepository;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(
    repository: AuditEvaluationReviewRepository =
      new FirestoreAuditEvaluationReviewRepository(),
    flags: AuditEvaluationFeatureFlags =
      getServerFeatureFlags().auditEvaluation,
  ) {
    this.repository = repository;
    this.flags = flags;
  }

  async getWorkspace(
    input: GetReviewWorkspaceInput,
  ): Promise<AuditEvaluationReviewWorkspace>;
  async getWorkspace(
    caseId: string,
    now?: string,
  ): Promise<AuditEvaluationReviewWorkspace>;
  async getWorkspace(
    input: GetReviewWorkspaceInput | string,
    now?: string,
  ): Promise<AuditEvaluationReviewWorkspace> {
    this.assertEnabled();
    const parsed = parseServiceInput(
      z
        .object({
          caseId: resourceIdSchema,
          now: instantSchema,
        })
        .strict(),
      typeof input === "string"
        ? { caseId: input, now: now ?? new Date().toISOString() }
        : input,
    );
    const workspace = await this.repository.getWorkspace(
      parsed.caseId,
      parsed.now,
    );
    if (!workspace) throw new ReviewServiceError("case_not_found");
    return workspace;
  }

  async saveCorrection(
    input: SaveCorrectionInput,
  ): Promise<SaveCustomerCorrectionResult> {
    this.assertEnabled();
    const envelope = parseServiceInput(
      z
        .object({
          caseId: resourceIdSchema,
          quoteId: resourceIdSchema,
          actor: customerActorSchema,
          now: instantSchema,
        })
        .strict(),
      {
        caseId: input.caseId,
        quoteId: input.quoteId,
        actor: input.actor,
        now: input.now,
      },
    );
    const correction = parseServiceInput(
      customerQuoteCorrectionSchema,
      {
        field: input.field,
        valueText: input.valueText,
        reason: input.reason,
        expectedRevision: input.expectedRevision,
      },
    );
    let correctedValue;
    try {
      correctedValue = parseCustomerCorrectionValue(
        correction.field,
        correction.valueText,
      );
    } catch (error) {
      if (error instanceof CustomerCorrectionValueError) {
        throw new ReviewServiceError(error.code);
      }
      throw new ReviewServiceError("invalid_correction_value");
    }
    return this.repository.saveCustomerCorrection({
      caseId: envelope.caseId,
      quoteId: envelope.quoteId,
      field: correction.field,
      correctedValue,
      reason: correction.reason,
      expectedRevision: correction.expectedRevision,
      actor: envelope.actor,
      now: envelope.now,
    });
  }

  async confirmCase(input: ConfirmCaseInput): Promise<ConfirmCaseResult> {
    this.assertEnabled();
    const envelope = parseServiceInput(
      z
        .object({
          caseId: resourceIdSchema,
          actor: customerActorSchema,
          now: instantSchema,
        })
        .strict(),
      {
        caseId: input.caseId,
        actor: input.actor,
        now: input.now,
      },
    );
    const confirmation = parseServiceInput(
      customerFinalConfirmationSchema,
      {
        finalAcknowledged: input.finalAcknowledged,
        expectedQuoteRevisions: input.expectedQuoteRevisions,
      },
    );
    return this.repository.confirmCase({
      caseId: envelope.caseId,
      expectedQuoteRevisions: confirmation.expectedQuoteRevisions,
      finalAcknowledged: confirmation.finalAcknowledged,
      actor: envelope.actor,
      now: envelope.now,
    });
  }

  async confirmPartnerInboxQuotes(
    input: ConfirmPartnerInboxQuotesInput,
  ): Promise<ConfirmCaseResult> {
    this.assertEnabled();
    const envelope = parseServiceInput(
      z
        .object({
          caseId: resourceIdSchema,
          actor: customerActorSchema,
          now: instantSchema,
        })
        .strict(),
      {
        caseId: input.caseId,
        actor: input.actor,
        now: input.now,
      },
    );
    if (input.finalAcknowledged !== true) {
      throw new ReviewServiceError("invalid_input");
    }
    return this.repository.confirmPartnerInboxQuotes({
      caseId: envelope.caseId,
      quotes: input.quotes,
      finalAcknowledged: true,
      actor: envelope.actor,
      now: envelope.now,
      cooperativeNameSnapshot: input.cooperativeNameSnapshot,
      fiscalYear: input.fiscalYear,
    });
  }

  async requestReport(input: RequestReportInput): Promise<RequestReportResult> {
    this.assertEnabled();
    assertAuditEvaluationCapabilityEnabled(
      "reportDownloadEnabled",
      this.flags,
    );
    const envelope = parseServiceInput(
      z
        .object({
          caseId: resourceIdSchema,
          actor: customerActorSchema,
          now: instantSchema,
        })
        .strict(),
      {
        caseId: input.caseId,
        actor: input.actor,
        now: input.now,
      },
    );
    const request = parseServiceInput(customerReportRequestSchema, {
      confirmationVersion: input.confirmationVersion,
    });
    return this.repository.requestReport({
      caseId: envelope.caseId,
      confirmationVersion: request.confirmationVersion,
      nhAuditEvaluationSnapshot: input.nhAuditEvaluationSnapshot,
      actor: envelope.actor,
      now: envelope.now,
    });
  }

  private assertEnabled() {
    assertAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      this.flags,
    );
  }
}

export { AuditEvaluationReviewService as ReviewService };

function parseServiceInput<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ReviewServiceError("invalid_input");
  return parsed.data;
}
