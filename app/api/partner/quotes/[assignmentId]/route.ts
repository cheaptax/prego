import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import {
  authErrorCode,
  authErrorStatus,
  requirePartner,
} from "@/lib/firebase/server";
import type {
  PartnerRecord,
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import {
  calculateQuoteTotals,
  normalizeQuoteLineItems,
} from "@/lib/quotes/quote-calculation";
import { parseCurrencyInput } from "@/lib/currency-input";
import {
  extractNhAuditEvaluationDefaults,
} from "@/lib/quotes/nh-audit-evaluation-defaults";
import {
  sanitizeNhAuditPartnerFormDraft,
} from "@/lib/quotes/nh-audit-quote-form";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import { getPublishedQuoteDocumentContentForPartner } from "@/lib/quotes/quote-screen-profile";
import { loadPublishedCmsPage } from "@/lib/cms/public-content";
import {
  readQuotePdfBuffer,
  readStorageFileAsDataUri,
} from "@/lib/quotes/quote-storage";
import {
  getTransactionalEmailConfigurationError,
} from "@/lib/email/resend";
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
import {
  buildTrustedNhAuditSubmissionV2,
  createNhAuditEvaluationSnapshotV2,
  nextImmutableQuoteVersion,
  partnerQuoteFinalizeBlockReason,
  partnerQuoteMutationBlockReason,
} from "@/lib/quotes/nh-audit-quote-server";
import { validateQuoteSupplierProfile } from "@/lib/quotes/supplier-profile";
import { finalizePartnerQuoteDelivery } from "@/lib/quotes/finalize-partner-quote-delivery";
import { withStandardQuoteConditions } from "@/lib/quotes/quote-presentation";

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

export type PartnerQuoteBuildPayload = Payload;

export type PartnerQuoteBuildSession = {
  profile: { partnerId?: string };
  decoded: { uid: string; email?: string };
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
      "공인회계사 인원 수를 0 이상의 정수로 입력해 주세요.",
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

export async function buildQuote(
  assignmentId: string,
  partnerSession: PartnerQuoteBuildSession,
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
  const mutationBlock =
    status === "draft"
      ? partnerQuoteMutationBlockReason({
          authenticatedPartnerId: partnerId,
          assignment,
          quoteRequest,
        })
      : partnerQuoteFinalizeBlockReason({
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
    ...withStandardQuoteConditions({
      servicePeriod: text(payload.servicePeriod, 120),
      validUntil: text(payload.validUntil, 40),
      terms: text(payload.terms),
      notes: text(payload.notes),
    }),
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
  const evaluationDefaults = result.quote.nhAuditDraft
    ? extractNhAuditEvaluationDefaults(result.quote.nhAuditDraft)
    : null;
  await adminDb().runTransaction(async (transaction) => {
    transaction.set(adminDb().collection("quotes").doc(result.quote.id), result.quote);
    transaction.set(
      adminDb().collection("quoteAssignments").doc(assignmentId),
      { status: "drafting", updatedAt: now } satisfies Partial<QuoteAssignmentRecord>,
      { merge: true },
    );
    if (evaluationDefaults) {
      transaction.set(
        adminDb().collection("partners").doc(partnerSession.profile.partnerId as string),
        {
          nhAuditEvaluationDefaults: evaluationDefaults,
          updatedAt: now,
        } satisfies Partial<PartnerRecord>,
        { merge: true },
      );
    }
  });
  return NextResponse.json({
    ok: true,
    quote: result.quote,
    nhAuditEvaluationDefaults: evaluationDefaults,
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
  const quoteDocumentContent = await getPublishedQuoteDocumentContentForPartner(
    {
      db,
      partnerId: result.partner.id,
      cmsContent: (await loadPublishedCmsPage("partner.portal")).content,
      partner: result.partner,
    },
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
    .where("status", "in", ["finalized", "delivered", "void"])
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
  const delivered = await finalizePartnerQuoteDelivery({
    db,
    assignmentId,
    built: result,
    previousVersions: previousVersions.docs.map((doc) => {
      const data = doc.data() as QuoteRecord;
      return { ...data, id: data.id || doc.id };
    }),
    actor: {
      uid: partnerSession.decoded.uid,
      email: partnerSession.decoded.email,
      mode: "partner",
    },
  });
  if (!delivered.ok) {
    return NextResponse.json(
      { ok: false, error: delivered.error },
      { status: delivered.status },
    );
  }
  return NextResponse.json({
    ok: true,
    quote: delivered.quote,
    delivery: delivered.delivery,
  });
}

