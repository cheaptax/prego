import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { AUDIT_QUOTE_REQUESTS } from "@/lib/audit-quote/collections";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
  writeAuditLog,
} from "@/lib/firebase/server";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteEmailDeliveryRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  calculateQuoteTotals,
  normalizeQuoteLineItems,
} from "@/lib/quotes/quote-calculation";
import { parseCurrencyInput } from "@/lib/currency-input";
import { sanitizeNhAuditPartnerFormDraft } from "@/lib/quotes/nh-audit-quote-form";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import { quoteDocumentContentFromCms } from "@/lib/quotes/quote-document-content";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import {
  deleteQuotePdf,
  readQuotePdfBuffer,
  readStorageFileAsDataUri,
  saveQuotePdf,
} from "@/lib/quotes/quote-storage";
import {
  getTransactionalEmailConfigurationError,
  sendTransactionalEmail,
} from "@/lib/email/resend";
import { buildCustomerQuoteEmail } from "@/lib/quotes/customer-quote-email";
import { loadActivePartnerEvaluationConfig } from "@/lib/audit-evaluation/active-partner-config";
import {
  normalizePartnerEvaluationAnswers,
  toTrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/partner-quote-form";
import { runDeterministicQualityScoring } from "@/lib/audit-evaluation/scoring-engine";
import { readLimitedJson } from "@/lib/audit-evaluation/api-security-core";
import type {
  NormalizedAuditQuoteField,
  TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";
import { isAuditEvaluationCapabilityEnabled } from "@/lib/audit-evaluation/feature-flags";
import {
  createQuoteDocumentIdentity,
  getQuoteDocumentSigningSecret,
  serializeEmbeddedQuoteDocumentIdentity,
} from "@/lib/audit-evaluation/standard-quote-identity";
import { StandardQuoteDocumentService } from "@/lib/audit-evaluation/standard-quote-service";
import { FirestoreStandardQuoteDocumentRepository } from "@/lib/audit-evaluation/standard-quote-repository";
import { embedAuditQuoteIdentityMarker } from "@/lib/quotes/audit-quote-document";
import {
  buildTrustedNhAuditSubmissionV2,
  canPartnerMutateQuoteAssignment,
  createNhAuditEvaluationSnapshotV2,
  nextImmutableQuoteVersion,
  partnerQuoteMutationBlockReason,
} from "@/lib/quotes/nh-audit-quote-server";
import { validateQuoteSupplierProfile } from "@/lib/quotes/supplier-profile";

export const runtime = "nodejs";
const MAX_QUOTE_PAYLOAD_BYTES = 256 * 1024;

type Params = { params: Promise<{ assignmentId: string }> };
type Payload = {
  lineItems?: unknown;
  vatIncluded?: boolean;
  servicePeriod?: string;
  validUntil?: string;
  terms?: string;
  notes?: string;
  supplierProfile?: unknown;
  nhAuditSubmission?: unknown;
  nhAuditDraft?: unknown;
  auditEvaluationConfig?: {
    id?: string;
    version?: number;
  };
  auditEvaluationAnswers?: unknown;
};

type QuoteRequiredField =
  | "quoteUnitPrice"
  | "quoteServicePeriod"
  | "quoteValidUntil";

function text(value: unknown, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function nhAuditValidationMessage(path: PropertyKey | undefined) {
  const messages: Record<string, string> = {
    engagementPartnerName: "담당회계사 이름을 입력해 주세요.",
    proposerType: "제안 주체 유형을 선택해 주세요.",
    auditFeeWon: "감사보수는 0보다 큰 원 단위 정수로 입력해 주세요.",
    expenseBillingMode: "제경비 청구방식을 선택해 주세요.",
    expectedExpenseWon: "예상 제경비를 0 이상의 원 단위 정수로 입력해 주세요.",
    localNonghyupAuditCount2025:
      "2025년 지역농협 회계감사 수행 건수를 0 이상의 정수로 입력해 주세요.",
    certifiedPublicAccountantCount:
      "소속 공인회계사 수를 0 이상의 정수로 입력해 주세요.",
    accountingFirmRevenueWon:
      "회계법인 매출액을 0 이상의 원 단위 정수로 입력해 주세요.",
    auditedNonghyupTypes2025:
      "2025년 수행 농협 유형을 정확히 선택해 주세요.",
    nonghyupTaxAgencyPerformed2025:
      "2025년 농협 세무대리 수행 여부를 선택해 주세요.",
    nonghyupSubsidySettlementPerformed2025:
      "2025년 농협 보조금 정산 수행 여부를 선택해 주세요.",
    factsConfirmed: "입력 내용 사실확인에 동의해 주세요.",
  };
  return messages[String(path ?? "")] ?? "입력값을 다시 확인해 주세요.";
}

async function buildQuote(
  assignmentId: string,
  partnerSession: Awaited<ReturnType<typeof requirePartner>>,
  payload: Payload,
  status: QuoteRecord["status"],
  version: number,
) {
  const db = adminDb();
  const assignmentSnapshot = await db
    .collection("quoteAssignments")
    .doc(assignmentId)
    .get();
  if (!assignmentSnapshot.exists) {
    return { ok: false as const, error: "assignment_not_found" };
  }
  const assignment = assignmentSnapshot.data() as QuoteAssignmentRecord;
  const partnerId = partnerSession.profile.partnerId as string;
  if (assignment.partnerId !== partnerId || assignment.status === "revoked") {
    return { ok: false as const, error: "permission_denied" };
  }
  const [quoteRequestSnapshot, partnerSnapshot] = await Promise.all([
    db.collection("quoteRequests").doc(assignment.quoteRequestId).get(),
    db.collection("partners").doc(partnerId).get(),
  ]);
  if (!quoteRequestSnapshot.exists || !partnerSnapshot.exists) {
    return { ok: false as const, error: "quote_request_not_found" };
  }
  const quoteRequest = quoteRequestSnapshot.data() as QuoteRequestRecord;
  const partner = partnerSnapshot.data() as PartnerRecord;
  const mutationBlock = partnerQuoteMutationBlockReason({
    authenticatedPartnerId: partnerId,
    assignment,
    quoteRequest,
  });
  if (mutationBlock) {
    return { ok: false as const, error: mutationBlock };
  }
  const quoteId =
    status === "draft" ? `${assignmentId}_draft` : `${assignmentId}_v${version}`;
  const now = new Date().toISOString();
  const supplierValidation = validateQuoteSupplierProfile(
    payload.supplierProfile ?? {
      name: partner.name || partner.displayName,
      businessRegistrationNumber: partner.businessRegistrationNumber,
      address: partner.businessAddress,
      contactName: partner.managerName,
      contactEmail: partner.contactEmail,
      contactPhone: partner.contactPhone,
    },
    {
      requireSeal:
        status === "finalized" &&
        quoteRequest.sourceType === "audit_quote",
      sealPath: partner.sealPath,
    },
  );
  if (
    status === "finalized" &&
    quoteRequest.sourceType === "audit_quote" &&
    !supplierValidation.valid
  ) {
    return {
      ok: false as const,
      error: "supplier_profile_invalid",
      supplierProfileErrors: supplierValidation.fieldErrors,
    };
  }
  const supplierProfile = supplierValidation.profile;
  const isNhAuditV2 =
    quoteRequest.sourceType === "audit_quote" &&
    (payload.nhAuditSubmission !== undefined ||
      payload.nhAuditDraft !== undefined);
  let nhAuditV2: QuoteRecord["nhAuditV2"];
  let nhAuditDraft: QuoteRecord["nhAuditDraft"];
  let lineItems: QuoteRecord["lineItems"];
  let vatIncluded: boolean;

  if (isNhAuditV2) {
    if (status === "draft" && payload.nhAuditDraft !== undefined) {
      nhAuditDraft = sanitizeNhAuditPartnerFormDraft(payload.nhAuditDraft);
      const parsedAuditFee = parseCurrencyInput(nhAuditDraft.auditFeeWon);
      const auditFee = Number.isSafeInteger(parsedAuditFee)
        ? parsedAuditFee
        : 0;
      const parsedExpense =
        nhAuditDraft.expenseBillingMode === "SEPARATELY_BILLED"
          ? parseCurrencyInput(nhAuditDraft.expectedExpenseWon)
          : 0;
      const expectedExpense = Number.isSafeInteger(parsedExpense)
        ? parsedExpense
        : 0;
      lineItems = [
        {
          id: "audit-fee",
          name: "회계감사 보수",
          quantity: 1,
          unitPrice: auditFee,
          supplyAmount: auditFee,
        },
        ...(expectedExpense > 0
          ? [
              {
                id: "expected-expense",
                name: "예상 제경비",
                quantity: 1,
                unitPrice: expectedExpense,
                supplyAmount: expectedExpense,
              },
            ]
          : []),
      ];
      vatIncluded = true;
    } else {
      if (!quoteRequest.cooperativeName || !quoteRequest.fiscalYear) {
        return {
          ok: false as const,
          error: "nh_audit_request_context_missing",
        };
      }
      const trusted = buildTrustedNhAuditSubmissionV2(
        payload.nhAuditSubmission,
        {
          submissionId: quoteId,
          quoteRequestId: quoteRequest.id,
          targetCooperativeId: quoteRequest.cooperativeId ?? null,
          targetCooperativeName: quoteRequest.cooperativeName,
          fiscalYear: quoteRequest.fiscalYear,
          partnerAccountId: partnerSession.decoded.uid,
          accountingFirmName: partner.name,
          submittedAt: now,
        },
      );
      if (!trusted.success) {
        return {
          ok: false as const,
          error: "nh_audit_submission_invalid",
          nhAuditValidationIssues: trusted.issues.map((issue) => ({
            path: issue.path,
            message: nhAuditValidationMessage(issue.path.split(".")[0]),
          })),
        };
      }
      const submission = trusted.submission;
      const snapshot = createNhAuditEvaluationSnapshotV2(submission, now);
      const cost = snapshot.cost;
      if (
        BigInt(cost.expectedTotalBurdenWon) > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        return {
          ok: false as const,
          error: "nh_audit_submission_invalid",
          nhAuditValidationIssues: [
            {
              path: "auditFeeWon",
              message: "저장 가능한 금액 범위를 초과했습니다.",
            },
          ],
        };
      }
      const auditFee = Number(submission.auditFeeWon);
      const expectedExpense = Number(cost.normalizedExpectedExpenseWon);
      lineItems = [
      {
        id: "audit-fee",
        name: "회계감사 보수",
        quantity: 1,
        unitPrice: auditFee,
        supplyAmount: auditFee,
      },
      ...(expectedExpense > 0
        ? [
            {
              id: "expected-expense",
              name: "예상 제경비",
              quantity: 1,
              unitPrice: expectedExpense,
              supplyAmount: expectedExpense,
            },
          ]
        : []),
      ];
      vatIncluded = true;
      nhAuditV2 = snapshot;
    }
  } else {
    const normalizedLineItems = normalizeQuoteLineItems(payload.lineItems);
    if (!normalizedLineItems) {
      return { ok: false as const, error: "invalid_line_items" };
    }
    lineItems = normalizedLineItems;
    vatIncluded = payload.vatIncluded !== false;
  }

  const totals = calculateQuoteTotals(lineItems, vatIncluded);
  const missingQuoteFields: QuoteRequiredField[] = [];
  if (totals.subtotal <= 0) missingQuoteFields.push("quoteUnitPrice");
  if (!isNhAuditV2 && !text(payload.servicePeriod, 120)) {
    missingQuoteFields.push("quoteServicePeriod");
  }
  if (!isNhAuditV2 && !text(payload.validUntil, 40)) {
    missingQuoteFields.push("quoteValidUntil");
  }
  if (status === "finalized" && missingQuoteFields.length > 0) {
    return {
      ok: false as const,
      error: "quote_required_fields_missing",
      missingQuoteFields,
    };
  }
  let auditEvaluation: QuoteRecord["auditEvaluation"];
  let missingRequiredFields: NormalizedAuditQuoteField[] = [];
  let missingRequiredProposalItemIds: string[] = [];
  if (quoteRequest.sourceType === "audit_quote" && !isNhAuditV2) {
    const active = await loadActivePartnerEvaluationConfig(now);
    if (
      payload.auditEvaluationConfig?.id !== active.config.id ||
      payload.auditEvaluationConfig?.version !== active.config.version
    ) {
      return {
        ok: false as const,
        error: "evaluation_config_changed",
      };
    }
    let normalized;
    try {
      normalized = normalizePartnerEvaluationAnswers({
        config: active.config,
        rawAnswers: payload.auditEvaluationAnswers,
        quoteId,
        quoteRequestId: quoteRequest.id,
        partnerId,
        partnerName: partner.displayName,
        auditFeeWon: totals.totalAmount,
        vatIncluded,
        now,
      });
    } catch {
      return {
        ok: false as const,
        error: "evaluation_payload_invalid",
      };
    }
    missingRequiredFields = normalized.missingRequiredFields;
    missingRequiredProposalItemIds =
      normalized.missingRequiredProposalItemIds;
    if (
      status === "finalized" &&
      (missingRequiredFields.length > 0 ||
        missingRequiredProposalItemIds.length > 0)
    ) {
      return {
        ok: false as const,
        error: "evaluation_required_fields_missing",
        missingRequiredFields,
        missingRequiredProposalItemIds,
      };
    }
    let trustedPayload: TrustedStandardQuotePayload | undefined;
    if (status === "finalized") {
      try {
        trustedPayload = toTrustedStandardQuotePayload(
          normalized.normalizedQuote,
        );
      } catch {
        return {
          ok: false as const,
          error: "evaluation_payload_invalid",
        };
      }
    }
    const score = runDeterministicQualityScoring(active.config, [
      normalized.normalizedQuote,
    ]).quotes[0];
    auditEvaluation = {
      configId: active.config.id,
      configVersion: active.config.version,
      configName: active.config.name,
      configSource: active.source,
      answers: normalized.answers,
      normalizedQuote: normalized.normalizedQuote,
      trustedPayload,
      fiscalYear: new Date(
        active.config.effectiveFrom ?? now,
      ).getUTCFullYear(),
      score,
      criteria: active.config.criteria.map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
        description: criterion.description,
        weightBasisPoints: criterion.weightBasisPoints,
        scoreBasisPoints:
          score.criteria.find(
            (item) => item.criterionId === criterion.id,
          )?.scoreBasisPoints ?? 0,
      })),
      evaluatedAt: now,
    };
  }
  const quote: QuoteRecord = withoutUndefined({
    id: quoteId,
    quoteRequestId: quoteRequest.id,
    quoteAssignmentId: assignment.id,
    partnerId,
    partnerName: partner.displayName,
    status,
    version,
    customerEmail: quoteRequest.customerEmail,
    supplierName: supplierProfile.name || partner.displayName,
    supplierBusinessRegistrationNumber:
      supplierProfile.businessRegistrationNumber,
    supplierAddress: supplierProfile.address,
    supplierContactName: supplierProfile.contactName,
    supplierContactEmail:
      supplierProfile.contactEmail || partner.contactEmail,
    supplierContactPhone: supplierProfile.contactPhone,
    logoPath: partner.logoPath,
    sealPath: partner.sealPath,
    lineItems,
    ...totals,
    vatIncluded,
    servicePeriod: text(payload.servicePeriod, 120),
    validUntil: text(payload.validUntil, 40),
    terms: text(payload.terms),
    notes: text(payload.notes),
    auditEvaluation,
    nhAuditV2,
    nhAuditDraft,
    finalizedAt: status === "finalized" ? now : undefined,
    createdBy: partnerSession.decoded.uid,
    createdByEmail: partnerSession.decoded.email,
    createdAt: now,
    updatedAt: now,
  } satisfies QuoteRecord);
  return {
    ok: true as const,
    quote,
    quoteRequest,
    assignment,
    partner,
    missingQuoteFields,
    missingRequiredFields,
    missingRequiredProposalItemIds,
  };
}

export async function PUT(req: Request, { params }: Params) {
  let partnerSession;
  try {
    partnerSession = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { assignmentId } = await params;
  const payload = (await readLimitedJson(
    req,
    MAX_QUOTE_PAYLOAD_BYTES,
  ).catch(() => null)) as Payload | null;
  const result = await buildQuote(
    assignmentId,
    partnerSession,
    payload ?? {},
    "draft",
    0,
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        ...("missingQuoteFields" in result
          ? { missingQuoteFields: result.missingQuoteFields }
          : {}),
        ...("missingRequiredFields" in result
          ? {
              missingRequiredFields: result.missingRequiredFields,
              missingRequiredProposalItemIds:
                result.missingRequiredProposalItemIds,
            }
          : {}),
        ...("nhAuditValidationIssues" in result
          ? { nhAuditValidationIssues: result.nhAuditValidationIssues }
          : {}),
        ...("supplierProfileErrors" in result
          ? { supplierProfileErrors: result.supplierProfileErrors }
          : {}),
      },
      {
        status:
          result.error === "permission_denied" ||
          result.error === "assignment_revoked"
            ? 403
            : result.error === "assignment_already_finalized" ||
                result.error === "quote_request_closed"
              ? 409
              : 400,
      },
    );
  }
  const now = new Date().toISOString();
  await adminDb().runTransaction(async (transaction) => {
    transaction.set(adminDb().collection("quotes").doc(result.quote.id), result.quote);
    transaction.set(
      adminDb().collection("quoteAssignments").doc(assignmentId),
      { status: "drafting", updatedAt: now } satisfies Partial<QuoteAssignmentRecord>,
      { merge: true },
    );
  });
  return NextResponse.json({
    ok: true,
    quote: result.quote,
    validation: {
      missingQuoteFields: result.missingQuoteFields,
      missingRequiredFields: result.missingRequiredFields,
      missingRequiredProposalItemIds:
        result.missingRequiredProposalItemIds,
    },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  let partnerSession;
  try {
    partnerSession = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { assignmentId } = await params;
  const db = adminDb();
  const assignmentSnapshot = await db
    .collection("quoteAssignments")
    .doc(assignmentId)
    .get();
  if (!assignmentSnapshot.exists) {
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );
  }
  const assignment = assignmentSnapshot.data() as QuoteAssignmentRecord;
  const partnerId = partnerSession.profile.partnerId as string;
  if (assignment.partnerId !== partnerId) {
    return NextResponse.json(
      { ok: false, error: "permission_denied" },
      { status: 403 },
    );
  }
  const previousVersions = await db
    .collection("quotes")
    .where("quoteAssignmentId", "==", assignmentId)
    .where("status", "in", ["finalized", "delivered"])
    .get();
  if (["finalized", "submitted"].includes(assignment.status)) {
    const latest = previousVersions.docs
      .map((doc) => doc.data() as QuoteRecord)
      .sort((left, right) => Number(right.version) - Number(left.version))[0];
    const pdfBuffer = await readQuotePdfBuffer(latest?.pdfPath);
    if (pdfBuffer) {
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": 'inline; filename="quote-preview.pdf"',
          "content-type": "application/pdf",
          "x-quote-email-ready": getTransactionalEmailConfigurationError()
            ? "false"
            : "true",
          "x-quote-already-finalized": "true",
        },
      });
    }
    return NextResponse.json(
      { ok: false, error: "assignment_already_finalized" },
      { status: 409 },
    );
  }
  const version = nextImmutableQuoteVersion(
    previousVersions.docs.map((doc) =>
      Number((doc.data() as QuoteRecord).version),
    ),
  );
  const payload = (await readLimitedJson(
    req,
    MAX_QUOTE_PAYLOAD_BYTES,
  ).catch(() => null)) as Payload | null;
  const result = await buildQuote(
    assignmentId,
    partnerSession,
    payload ?? {},
    "finalized",
    version,
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        ...("missingQuoteFields" in result
          ? { missingQuoteFields: result.missingQuoteFields }
          : {}),
        ...("missingRequiredFields" in result
          ? {
              missingRequiredFields: result.missingRequiredFields,
              missingRequiredProposalItemIds:
                result.missingRequiredProposalItemIds,
            }
          : {}),
        ...("nhAuditValidationIssues" in result
          ? { nhAuditValidationIssues: result.nhAuditValidationIssues }
          : {}),
        ...("supplierProfileErrors" in result
          ? { supplierProfileErrors: result.supplierProfileErrors }
          : {}),
      },
      {
        status:
          result.error === "permission_denied" ||
          result.error === "assignment_revoked"
            ? 403
            : result.error === "assignment_already_finalized" ||
                result.error === "quote_request_closed"
              ? 409
              : 400,
      },
    );
  }
  const logoDataUri = await readStorageFileAsDataUri(
    result.partner.logoPath,
  );
  const sealDataUri = await readStorageFileAsDataUri(
    result.partner.sealPath,
  );
  const quoteDocumentContent = quoteDocumentContentFromCms(
    (await loadPublishedCmsPage("partner.portal")).content,
  );
  const pdfBuffer = await renderQuotePdf({
    quote: result.quote,
    quoteRequest: result.quoteRequest,
    logoDataUri,
    sealDataUri,
    documentContent: quoteDocumentContent,
  });
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": 'inline; filename="quote-preview.pdf"',
      "content-type": "application/pdf",
      "x-quote-email-ready": getTransactionalEmailConfigurationError()
        ? "false"
        : "true",
    },
  });
}

export async function POST(req: Request, { params }: Params) {
  let partnerSession;
  try {
    partnerSession = await requirePartner(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: authErrorCode(err) },
      { status: authErrorStatus(err) },
    );
  }
  const { assignmentId } = await params;
  const db = adminDb();
  const previousVersions = await db
    .collection("quotes")
    .where("quoteAssignmentId", "==", assignmentId)
    .where("status", "in", ["finalized", "delivered"])
    .get();
  const version = nextImmutableQuoteVersion(
    previousVersions.docs.map((doc) =>
      Number((doc.data() as QuoteRecord).version),
    ),
  );
  const payload = (await readLimitedJson(
    req,
    MAX_QUOTE_PAYLOAD_BYTES,
  ).catch(() => null)) as Payload | null;
  const result = await buildQuote(
    assignmentId,
    partnerSession,
    payload ?? {},
    "finalized",
    version,
  );
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        ...("missingQuoteFields" in result
          ? { missingQuoteFields: result.missingQuoteFields }
          : {}),
        ...("missingRequiredFields" in result
          ? {
              missingRequiredFields: result.missingRequiredFields,
              missingRequiredProposalItemIds:
                result.missingRequiredProposalItemIds,
            }
          : {}),
        ...("nhAuditValidationIssues" in result
          ? { nhAuditValidationIssues: result.nhAuditValidationIssues }
          : {}),
        ...("supplierProfileErrors" in result
          ? { supplierProfileErrors: result.supplierProfileErrors }
          : {}),
      },
      {
        status:
          result.error === "permission_denied" ||
          result.error === "assignment_revoked"
            ? 403
            : result.error === "assignment_already_finalized" ||
                result.error === "quote_request_closed"
              ? 409
              : 400,
      },
    );
  }
  const logoDataUri = await readStorageFileAsDataUri(result.partner.logoPath);
  const sealDataUri = await readStorageFileAsDataUri(result.partner.sealPath);
  const quoteDocumentContent = quoteDocumentContentFromCms(
    (await loadPublishedCmsPage("partner.portal")).content,
  );
  let pdfBuffer = await renderQuotePdf({
    quote: result.quote,
    quoteRequest: result.quoteRequest,
    logoDataUri,
    sealDataUri,
    documentContent: quoteDocumentContent,
  });
  let quoteWithStandardDocument = result.quote;
  if (
    result.quoteRequest.sourceType === "audit_quote" &&
    result.quote.auditEvaluation?.trustedPayload &&
    result.quote.auditEvaluation.configSource === "published" &&
    isAuditEvaluationCapabilityEnabled("enabled")
  ) {
    try {
      const signingSecret = getQuoteDocumentSigningSecret();
      const quoteDocumentId = `qd_${createHash("sha256")
        .update(result.quote.id, "utf8")
        .digest("base64url")
        .slice(0, 24)}`;
      const identity = createQuoteDocumentIdentity(
        {
          quoteDocumentId,
          quoteRequestId: result.quoteRequest.sourceId,
          fiscalYear: result.quote.auditEvaluation.fiscalYear,
          templateVersion: {
            id: "partner.audit-quote",
            version: 1,
          },
          normalizedPayload: result.quote.auditEvaluation.trustedPayload,
        },
        signingSecret,
      );
      const marker = serializeEmbeddedQuoteDocumentIdentity(identity);
      pdfBuffer = embedAuditQuoteIdentityMarker(pdfBuffer, marker);
      const repository = new FirestoreStandardQuoteDocumentRepository();
      const existing = await repository.get(identity.quoteDocumentId);
      if (
        existing &&
        (existing.status !== "ACTIVE" ||
          existing.quoteRequestId !== result.quoteRequest.sourceId ||
          existing.payloadChecksum !== identity.payloadChecksum ||
          existing.integrityToken !== identity.integrityToken)
      ) {
        throw new Error("standard_quote_identity_conflict");
      }
      const registered = existing
        ? { record: existing }
        : await new StandardQuoteDocumentService(
            repository,
            signingSecret,
          ).registerStandardQuoteDocument({
          quoteDocumentId: identity.quoteDocumentId,
          quoteRequestId: result.quoteRequest.sourceId,
          fiscalYear: result.quote.auditEvaluation.fiscalYear,
          templateVersion: identity.templateVersion,
          documentFormat: "PDF",
          normalizedPayload: result.quote.auditEvaluation.trustedPayload,
          originalDocumentBytes: pdfBuffer,
          registeredAt: new Date().toISOString(),
          registeredBy: {
            type: "SYSTEM",
            service: "partner-quote-finalization",
          },
        });
      quoteWithStandardDocument = {
        ...result.quote,
        auditEvaluation: {
          ...result.quote.auditEvaluation,
          standardQuoteDocumentId: registered.record.quoteDocumentId,
        },
      };
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "audit_evaluation_registration_failed",
        },
        { status: 503 },
      );
    }
  }
  const pdfPath = await saveQuotePdf({
    quoteId: quoteWithStandardDocument.id,
    version: quoteWithStandardDocument.version,
    buffer: pdfBuffer,
    storageKey: randomUUID(),
  });
  const now = new Date().toISOString();
  const pdfFileName = `${result.quote.partnerName}-견적서-v${version}.pdf`
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .slice(0, 120);
  const finalizedQuote: QuoteRecord = {
    ...quoteWithStandardDocument,
    pdfPath,
    pdfFileName,
    updatedAt: now,
  };
  const deliveryId = `${finalizedQuote.id}_customer`;
  let delivery: QuoteEmailDeliveryRecord = {
    id: deliveryId,
    quoteId: finalizedQuote.id,
    quoteRequestId: finalizedQuote.quoteRequestId,
    recipientEmail: finalizedQuote.customerEmail,
    status: "pending",
    provider: "local",
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  let deliveryResult: {
    status: "sent" | "failed";
    error?: "email_not_configured" | "email_send_failed";
  } = { status: "failed", error: "email_send_failed" };

  let commitResult: "committed" | "duplicate" | "permission_denied";
  try {
    commitResult = await db.runTransaction(async (transaction) => {
      const quoteRef = db.collection("quotes").doc(finalizedQuote.id);
      const assignmentRef = db
        .collection("quoteAssignments")
        .doc(assignmentId);
      const quoteRequestRef = db
        .collection("quoteRequests")
        .doc(finalizedQuote.quoteRequestId);
      const [existingQuote, currentAssignment, currentQuoteRequest] =
        await Promise.all([
          transaction.get(quoteRef),
          transaction.get(assignmentRef),
          transaction.get(quoteRequestRef),
        ]);
      if (existingQuote.exists) return "duplicate" as const;
      if (!currentAssignment.exists || !currentQuoteRequest.exists) {
        return "permission_denied" as const;
      }
      if (
        !canPartnerMutateQuoteAssignment({
          authenticatedPartnerId: result.quote.partnerId,
          assignment:
            currentAssignment.data() as QuoteAssignmentRecord,
          quoteRequest:
            currentQuoteRequest.data() as QuoteRequestRecord,
        })
      ) {
        return "permission_denied" as const;
      }

      transaction.set(quoteRef, finalizedQuote);
      transaction.set(
        assignmentRef,
        {
          status: "finalized",
          updatedAt: now,
        } satisfies Partial<QuoteAssignmentRecord>,
        { merge: true },
      );
      transaction.set(
        quoteRequestRef,
        {
          status: "quoted",
          submittedQuoteCount: previousVersions.size + 1,
          updatedAt: now,
        } satisfies Partial<QuoteRequestRecord>,
        { merge: true },
      );
      transaction.set(
        db.collection("quoteEmailDeliveries").doc(deliveryId),
        delivery,
      );
      writeAuditLog(transaction, db, {
        actorUid: partnerSession.decoded.uid,
        actorEmail: partnerSession.decoded.email,
        action: "quote.finalized",
        targetType: "quote",
        targetId: finalizedQuote.id,
        metadata: {
          quoteRequestId: finalizedQuote.quoteRequestId,
          totalAmount: finalizedQuote.totalAmount,
        },
        createdAt: now,
      });
      return "committed" as const;
    });
  } catch {
    await deleteQuotePdf(pdfPath).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: "quote_persistence_failed" },
      { status: 500 },
    );
  }
  if (commitResult !== "committed") {
    await deleteQuotePdf(pdfPath).catch(() => undefined);
    return NextResponse.json(
      {
        ok: false,
        error:
          commitResult === "duplicate"
            ? "duplicate_quote_submission"
            : "permission_denied",
      },
      { status: commitResult === "duplicate" ? 409 : 403 },
    );
  }

  try {
    const emailContent = await buildCustomerQuoteEmail({
      db,
      quote: finalizedQuote,
      copy: quoteDocumentContent.copy,
    });
    const sent = await sendTransactionalEmail({
      to: finalizedQuote.customerEmail,
      ...emailContent,
      attachments: [{ filename: pdfFileName, content: pdfBuffer }],
      idempotencyKey: `quote/${finalizedQuote.id}/customer`,
    });
    if (sent.provider === "local") {
      throw new Error("resend_not_configured");
    }
    delivery = {
      ...delivery,
      status: "sent",
      provider: sent.provider,
      providerMessageId: sent.id,
      attemptCount: 1,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.collection("quoteEmailDeliveries").doc(deliveryId).set(delivery, { merge: true });
    await db.collection("quotes").doc(finalizedQuote.id).set(
      {
        status: "delivered",
        deliveredAt: delivery.sentAt,
        updatedAt: delivery.updatedAt,
      } satisfies Partial<QuoteRecord>,
      { merge: true },
    );
    if (result.quoteRequest.sourceType === "audit_quote") {
      await db
        .collection(AUDIT_QUOTE_REQUESTS)
        .doc(result.quoteRequest.sourceId)
        .set(
          {
            status: "delivered",
            quoteCount: Math.max(
              Number(result.quoteRequest.expectedQuoteCount ?? 0),
              Number(result.quoteRequest.submittedQuoteCount ?? 0) + 1,
              1,
            ),
            updatedAt: delivery.updatedAt,
          },
          { merge: true },
        );
    }
    deliveryResult = { status: "sent" };
  } catch (error) {
    const rawMessage =
      error instanceof Error ? error.message : "send_failed";
    const message = [
      "resend_not_configured",
      "production_email_from_not_configured",
    ].includes(rawMessage)
      ? rawMessage
      : "email_send_failed";
    await db.collection("quoteEmailDeliveries").doc(deliveryId).set(
      {
        status: "failed",
        attemptCount: 1,
        lastError: message,
        updatedAt: new Date().toISOString(),
      } satisfies Partial<QuoteEmailDeliveryRecord>,
      { merge: true },
    );
    deliveryResult = {
      status: "failed",
      error: [
        "resend_not_configured",
        "production_email_from_not_configured",
      ].includes(message)
        ? "email_not_configured"
        : "email_send_failed",
    };
  }

  return NextResponse.json({
    ok: true,
    quote: finalizedQuote,
    delivery: deliveryResult,
  });
}
