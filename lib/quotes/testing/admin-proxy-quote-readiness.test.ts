import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type { PartnerRecord } from "@/lib/firebase/schema";
import type { CooperativeQuotePartnerPrice } from "@/lib/quotes/cooperative-quote-price-master-types";
import { checkAdminProxyQuoteReadiness, partnerQuoteProfileGaps, resolveAdminProxySendPlan } from "@/lib/quotes/admin-proxy-quote-readiness";

const price: CooperativeQuotePartnerPrice = {
  id: "2027_coop-1_partner-1",
  fiscalYear: 2027,
  cooperativeId: "coop-1",
  cooperativeName: "테스트농협",
  partnerId: "partner-1",
  partnerName: "테스트회계법인",
  plannedAuditFeeWon: normalizeWonAmount(8500000n),
  expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
  expectedExpenseWon: normalizeWonAmount(0n),
  safePriceMinWon: normalizeWonAmount(7700000n),
  safePriceMaxWon: normalizeWonAmount(9300000n),
  isPlannedWinner: true,
  locked: false,
  updatedBy: "admin",
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

test("admin proxy readiness accepts complete partner defaults", () => {
  const result = checkAdminProxyQuoteReadiness({
    partner: partner(),
    price,
  });
  assert.equal(result.ready, true);
  if (result.ready) {
    assert.equal(result.nhAuditSubmission.auditFeeWon, "8500000");
    assert.equal(result.nhAuditSubmission.factsConfirmed, true);
  }
});

test("partner quote profile gaps ignore master prices and report logo", () => {
  const complete = partnerQuoteProfileGaps(partner());
  assert.equal(complete.ready, true);
  assert.equal(complete.logoMissing, true);

  const incomplete = partnerQuoteProfileGaps(
    partner({
      sealPath: undefined,
      nhAuditEvaluationDefaults: undefined,
      opsProxyQuoteSendConsent: false,
      businessRegistrationNumber: "",
    }),
  );
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.missing.includes("seal_missing"));
  assert.ok(incomplete.missing.includes("evaluation_defaults_missing"));
  assert.ok(incomplete.missing.includes("proxy_consent_missing"));
  assert.ok(incomplete.missing.includes("supplier_profile_invalid"));
  assert.equal(incomplete.missing.includes("master_price_missing"), false);
});

test("admin proxy readiness reports missing consent, seal, profile, defaults, and price", () => {
  const result = checkAdminProxyQuoteReadiness({
    partner: partner({
      opsProxyQuoteSendConsent: false,
      sealPath: undefined,
      businessRegistrationNumber: "",
      nhAuditEvaluationDefaults: undefined,
    }),
    price: null,
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.deepEqual(
      new Set(result.missing),
      new Set([
        "proxy_consent_missing",
        "seal_missing",
        "supplier_profile_invalid",
        "master_price_missing",
      ]),
    );
  }
});

test("admin proxy readiness names the missing evaluation default fields", () => {
  const result = checkAdminProxyQuoteReadiness({
    partner: partner({ nhAuditEvaluationDefaults: undefined }),
    price,
  });
  assert.equal(result.ready, false);
  if (!result.ready) {
    assert.ok(result.missing.includes("evaluation_defaults_missing"));
    assert.ok(result.nhAuditMissingLabels?.includes("담당회계사 이름"));
  }
});

test("admin proxy send creates the next version after a delivered quote", () => {
  assert.equal(
    resolveAdminProxySendPlan({ latestSent: null }),
    "create_version",
  );
  assert.equal(
    resolveAdminProxySendPlan({
      latestSent: { status: "delivered", version: 1 },
    }),
    "create_version",
  );
  assert.equal(
    resolveAdminProxySendPlan({
      latestSent: { status: "finalized", version: 1 },
    }),
    "retry_existing",
  );
});

function partner(overrides: Partial<PartnerRecord> = {}): PartnerRecord {
  const now = "2026-08-12T00:00:00.000Z";
  return {
    id: "partner-1",
    name: "테스트회계법인",
    displayName: "테스트회계법인",
    partnerType: "corporation",
    profession: "ACCOUNTANT",
    fields: ["감사"],
    managerName: "김담당",
    contactEmail: "partner@example.com",
    contactPhone: "010-0000-0000",
    businessRegistrationNumber: "123-45-67890",
    businessAddress: "서울시 테스트로 1",
    sealPath: "partners/partner-1/seal.png",
    nhAuditEvaluationDefaults: {
      engagementPartnerName: "홍길동",
      proposerType: "ACCOUNTING_FIRM",
      localNonghyupAuditCount2025: "3",
      certifiedPublicAccountantCount: "5",
      accountingFirmRevenueWon: "1000000000",
      auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
      noAuditedNonghyupTypes2025: false,
      nonghyupTaxAgencyPerformed2025: "YES",
      nonghyupSubsidySettlementPerformed2025: "NO",
    },
    status: "active",
    pointMin: 0,
    pointMax: 100,
    createdBy: "admin",
    createdAt: now,
    updatedBy: "admin",
    updatedAt: now,
    ...overrides,
  };
}
