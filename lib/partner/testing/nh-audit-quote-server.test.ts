import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  QuoteAssignmentRecord,
  QuoteRecord,
  QuoteRequestRecord,
} from "@/lib/firebase/schema";
import { canCustomerReadQuote } from "@/lib/quotes/quote-access";
import {
  buildTrustedNhAuditSubmissionV2,
  canPartnerMutateQuoteAssignment,
  createNhAuditEvaluationSnapshotV2,
  nextImmutableQuoteVersion,
  partnerQuoteMutationBlockReason,
  resolveNhAuditQuoteCompatibility,
} from "@/lib/quotes/nh-audit-quote-server";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function clientInput(overrides: Record<string, unknown> = {}) {
  return {
    engagementPartnerName: "  홍길동  ",
    proposerType: "ACCOUNTING_FIRM",
    auditFeeWon: "10000000",
    expenseBillingMode: "SEPARATELY_BILLED",
    expectedExpenseWon: "1000000",
    localNonghyupAuditCount2025: 50,
    certifiedPublicAccountantCount: 20,
    accountingFirmRevenueWon: "10000000001",
    auditedNonghyupTypes2025: [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
      "LOCAL_LIVESTOCK_COOPERATIVE",
    ],
    nonghyupTaxAgencyPerformed2025: true,
    nonghyupSubsidySettlementPerformed2025: false,
    factsConfirmed: true,
    ...overrides,
  };
}

function context() {
  return {
    submissionId: "assignment-a_v1",
    quoteRequestId: "audit_quote_request-a",
    targetCooperativeId: "coop-a",
    targetCooperativeName: "프리고농협",
    fiscalYear: 2026,
    partnerAccountId: "partner-user-a",
    accountingFirmName: "프리고회계법인",
    submittedAt: "2026-07-23T00:00:00.000Z",
  };
}

function trustedSubmission(overrides: Record<string, unknown> = {}) {
  const result = buildTrustedNhAuditSubmissionV2(
    clientInput(overrides),
    context(),
  );
  assert.equal(result.success, true);
  if (!result.success) throw new Error("expected_valid_submission");
  return result.submission;
}

describe("NH audit quote server trust boundary", () => {
  it("builds a complete trusted submission and reproducible snapshot", () => {
    const submission = trustedSubmission();
    const snapshot = createNhAuditEvaluationSnapshotV2(
      submission,
      context().submittedAt,
    );
    assert.equal(submission.accountingFirmName, "프리고회계법인");
    assert.equal(submission.targetCooperative.name, "프리고농협");
    assert.equal(submission.fiscalYear, 2026);
    assert.equal(submission.engagementPartnerName, "홍길동");
    assert.equal(snapshot.cost.supplyAmountWon, "11000000");
    assert.equal(snapshot.cost.vatWon, "1100000");
    assert.equal(snapshot.cost.expectedTotalBurdenWon, "12100000");
    assert.equal(snapshot.quality.criteria.length, 6);
    assert.equal(
      Object.values(snapshot.defaultQualityCriterionWeights).reduce(
        (total, weight) => total + weight,
        0,
      ),
      100,
    );
    assert.equal(snapshot.eligibilityStatus, "ELIGIBLE");
  });

  it("ignores manipulated identity, score, eligibility and timestamp fields", () => {
    const result = buildTrustedNhAuditSubmissionV2(
      clientInput({
        accountingFirmName: "공격자법인",
        partnerAccountId: "attacker",
        targetCooperative: { id: "x", name: "공격자농협" },
        fiscalYear: 2099,
        submittedAt: "2099-01-01T00:00:00.000Z",
        qualityScore: 100,
        overallScore: 100,
        eligibilityStatus: "ELIGIBLE",
      }),
      context(),
    );
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.submission.accountingFirmName, "프리고회계법인");
    assert.equal(result.submission.partnerAccountId, "partner-user-a");
    assert.equal(result.submission.targetCooperative.name, "프리고농협");
    assert.equal(result.submission.fiscalYear, 2026);
    assert.equal(result.submission.submittedAt, context().submittedAt);
    assert.equal("qualityScore" in result.submission, false);
    assert.equal("eligibilityStatus" in result.submission, false);
  });

  it("rejects invalid enums and unsupported cooperative types", () => {
    for (const invalid of [
      { proposerType: "INDIVIDUAL" },
      { expenseBillingMode: "LATER" },
      { auditedNonghyupTypes2025: ["UNSUPPORTED"] },
    ]) {
      assert.equal(
        buildTrustedNhAuditSubmissionV2(
          clientInput(invalid),
          context(),
        ).success,
        false,
      );
    }
  });

  it("rejects incomplete trusted request context instead of guessing it", () => {
    assert.equal(
      buildTrustedNhAuditSubmissionV2(clientInput(), {
        ...context(),
        targetCooperativeName: "",
      }).success,
      false,
    );
    assert.equal(
      buildTrustedNhAuditSubmissionV2(clientInput(), {
        ...context(),
        fiscalYear: Number.NaN,
      }).success,
      false,
    );
  });

  it("deduplicates allowed cooperative types", () => {
    const submission = trustedSubmission({
      auditedNonghyupTypes2025: [
        "LOCAL_AGRICULTURAL_COOPERATIVE",
        "LOCAL_AGRICULTURAL_COOPERATIVE",
      ],
    });
    assert.deepEqual(submission.auditedNonghyupTypes2025, [
      "LOCAL_AGRICULTURAL_COOPERATIVE",
    ]);
  });

  it("rejects unsafe, negative, decimal, empty and non-finite values", () => {
    const invalidCases = [
      { auditFeeWon: "0" },
      { auditFeeWon: "-1" },
      { auditFeeWon: "1.5" },
      { auditFeeWon: "" },
      { auditFeeWon: "9007199254740992" },
      { accountingFirmRevenueWon: "-1" },
      { accountingFirmRevenueWon: "1.1" },
      { accountingFirmRevenueWon: "NaN" },
      { expectedExpenseWon: "Infinity" },
      { localNonghyupAuditCount2025: -1 },
      { localNonghyupAuditCount2025: 1.5 },
      { localNonghyupAuditCount2025: Number.NaN },
      { certifiedPublicAccountantCount: Number.POSITIVE_INFINITY },
      { certifiedPublicAccountantCount: "20" },
    ];
    for (const invalid of invalidCases) {
      assert.equal(
        buildTrustedNhAuditSubmissionV2(
          clientInput(invalid),
          context(),
        ).success,
        false,
        JSON.stringify(invalid),
      );
    }
  });

  it("requires explicit booleans and facts confirmation", () => {
    for (const invalid of [
      { nonghyupTaxAgencyPerformed2025: "YES" },
      { nonghyupSubsidySettlementPerformed2025: "NO" },
      { factsConfirmed: false },
      { factsConfirmed: "true" },
    ]) {
      assert.equal(
        buildTrustedNhAuditSubmissionV2(
          clientInput(invalid),
          context(),
        ).success,
        false,
      );
    }
  });

  it("requires separate expenses and normalizes included expenses to zero", () => {
    const missing = clientInput({
      expenseBillingMode: "SEPARATELY_BILLED",
    }) as Record<string, unknown>;
    delete missing.expectedExpenseWon;
    assert.equal(
      buildTrustedNhAuditSubmissionV2(missing, context()).success,
      false,
    );

    const included = trustedSubmission({
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
      expectedExpenseWon: "999999",
    });
    assert.equal(included.expectedExpenseWon, "0");

    const includedWithoutExpense = clientInput({
      expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    }) as Record<string, unknown>;
    delete includedWithoutExpense.expectedExpenseWon;
    const normalized = buildTrustedNhAuditSubmissionV2(
      includedWithoutExpense,
      context(),
    );
    assert.equal(normalized.success, true);
    if (normalized.success) {
      assert.equal(normalized.submission.expectedExpenseWon, "0");
    }
  });

  it("always marks audit groups ineligible on the server", () => {
    const snapshot = createNhAuditEvaluationSnapshotV2(
      trustedSubmission({ proposerType: "AUDIT_GROUP" }),
      context().submittedAt,
    );
    assert.equal(snapshot.eligibilityStatus, "INELIGIBLE");
    assert.deepEqual(snapshot.reasonCodes, ["AUDIT_GROUP_PROPOSER"]);
    assert.ok(snapshot.quality);
  });
});

describe("NH audit quote authorization, compatibility and revision policy", () => {
  const assignment = {
    partnerId: "partner-a",
    status: "assigned",
  } as QuoteAssignmentRecord;
  const request = { status: "assigned" } as QuoteRequestRecord;

  it("allows active work only and blocks other, closed, revoked, or finalized assignments", () => {
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment,
        quoteRequest: request,
      }),
      true,
    );
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment: { ...assignment, status: "drafting" },
        quoteRequest: request,
      }),
      true,
    );
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-b",
        assignment,
        quoteRequest: request,
      }),
      false,
    );
    assert.equal(
      partnerQuoteMutationBlockReason({
        authenticatedPartnerId: "partner-b",
        assignment,
        quoteRequest: request,
      }),
      "permission_denied",
    );
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment: { ...assignment, status: "finalized" },
        quoteRequest: request,
      }),
      false,
    );
    assert.equal(
      partnerQuoteMutationBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: { ...assignment, status: "finalized" },
        quoteRequest: request,
      }),
      "assignment_already_finalized",
    );
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment: { ...assignment, status: "revoked" },
        quoteRequest: request,
      }),
      false,
    );
    assert.equal(
      partnerQuoteMutationBlockReason({
        authenticatedPartnerId: "partner-a",
        assignment: { ...assignment, status: "revoked" },
        quoteRequest: request,
      }),
      "assignment_revoked",
    );
    assert.equal(
      canPartnerMutateQuoteAssignment({
        authenticatedPartnerId: "partner-a",
        assignment,
        quoteRequest: { status: "closed" },
      }),
      false,
    );
  });

  it("keeps finalized revisions immutable and allocates the next version", () => {
    assert.equal(nextImmutableQuoteVersion([]), 1);
    assert.equal(nextImmutableQuoteVersion([1, 2, 2, 0, Number.NaN]), 3);
  });

  it("marks legacy and malformed documents for resubmission without scoring", () => {
    const legacy = {
      id: "legacy",
      quoteRequestId: "request-a",
    } as QuoteRecord;
    const compatibility = resolveNhAuditQuoteCompatibility(
      legacy,
      "audit_quote",
    );
    assert.equal(compatibility?.status, "RESUBMISSION_REQUIRED");
    assert.ok((compatibility?.missingFields.length ?? 0) > 0);
    assert.equal(compatibility?.evaluationStandardVersion, null);

    const malformed = {
      ...legacy,
      nhAuditV2: {
        submission: { quoteRequestId: "request-a" },
      },
    } as unknown as QuoteRecord;
    assert.equal(
      resolveNhAuditQuoteCompatibility(malformed, "audit_quote")?.status,
      "RESUBMISSION_REQUIRED",
    );
  });

  it("recognizes a valid current snapshot without rewriting it", () => {
    const submission = trustedSubmission();
    const quote = {
      id: "current",
      quoteRequestId: submission.quoteRequestId,
      nhAuditV2: createNhAuditEvaluationSnapshotV2(
        submission,
        context().submittedAt,
      ),
    } as QuoteRecord;
    const compatibility = resolveNhAuditQuoteCompatibility(
      quote,
      "audit_quote",
    );
    assert.equal(compatibility?.status, "CURRENT");
    assert.deepEqual(compatibility?.missingFields, []);
  });

  it("keeps customer access scoped to the owning request", () => {
    const quote = {
      status: "delivered",
      pdfPath: "quotes/q/v1/quote.pdf",
      customerEmail: "owner@nonghyup.com",
    } as QuoteRecord;
    const quoteRequest = {
      sourceType: "audit_quote",
      customerEmail: "owner@nonghyup.com",
    } as QuoteRequestRecord;
    assert.equal(
      canCustomerReadQuote(
        { uid: "member", email: "other@nonghyup.com" } as never,
        quote,
        quoteRequest,
      ),
      false,
    );
  });

  it("uses server authorization helpers and never logs payloads or secrets", () => {
    const partnerRoute = readFileSync(
      path.join(
        root,
        "app/api/partner/quotes/[assignmentId]/route.ts",
      ),
      "utf8",
    );
    const finalizeCore = readFileSync(
      path.join(root, "lib/quotes/finalize-partner-quote-delivery.ts"),
      "utf8",
    );
    const adminRoute = readFileSync(
      path.join(root, "app/api/admin/quotes/route.ts"),
      "utf8",
    );
    const customerRoute = readFileSync(
      path.join(root, "app/api/me/quotes/route.ts"),
      "utf8",
    );
    const retryRoute = readFileSync(
      path.join(
        root,
        "app/api/internal/quote-emails/retry/route.ts",
      ),
      "utf8",
    );
    const partnerDashboard = readFileSync(
      path.join(root, "components/PartnerDashboard.tsx"),
      "utf8",
    );
    const rules = readFileSync(path.join(root, "firestore.rules"), "utf8");
    assert.match(partnerRoute, /requirePartner\(/u);
    assert.match(partnerRoute, /partnerQuoteFinalizeBlockReason/u);
    assert.match(partnerRoute, /partnerQuoteMutationBlockReason/u);
    assert.match(finalizeCore, /existingQuote\.exists/u);
    assert.match(finalizeCore, /duplicate_quote_submission/u);
    assert.match(finalizeCore, /storageKey: randomUUID\(\)/u);
    assert.match(finalizeCore, /canPartnerFinalizeQuoteAssignment/u);
    assert.doesNotMatch(
      partnerRoute,
      /if \(getTransactionalEmailConfigurationError\(\)\) \{\s*return NextResponse\.json/u,
    );
    assert.match(retryRoute, /where\("status", "==", "finalized"\)/u);
    assert.match(retryRoute, /getTransactionalEmailConfigurationError/u);
    assert.match(
      partnerDashboard,
      /quoteDeliveryPendingHelp/u,
    );
    assert.doesNotMatch(
      partnerDashboard,
      /quotePreviewEmailReady !== true/u,
    );
    assert.match(adminRoute, /requirePermission\(req, "inquiries:read"\)/u);
    assert.match(customerRoute, /requireQuoteInboxMember\(req\)/u);
    assert.match(customerRoute, /canCustomerReadQuoteRequest/u);
    assert.match(customerRoute, /canCustomerReadQuote/u);
    assert.doesNotMatch(partnerRoute, /console\.(log|info|debug).*payload/su);
    assert.doesNotMatch(
      partnerRoute,
      /writeAuditLog[\s\S]{0,500}(token|cookie|password|serviceAccount)/u,
    );
    assert.match(
      rules,
      /match \/quotes\/\{quoteId\} \{\s*allow read, write: if false;/u,
    );
  });
});
