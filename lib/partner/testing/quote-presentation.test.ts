import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  quoteConditionRows,
  quoteDisplayNumber,
  quoteDocumentTitle,
  quoteIssueDate,
  quotePartnerCredentialRows,
  quotePartnerEvaluationFactRows,
  quoteRecipient,
  formatQuoteWon,
} from "@/lib/quotes/quote-presentation";
import {
  quoteSupplierProfileFrom,
  validateQuoteSupplierProfile,
} from "@/lib/quotes/supplier-profile";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { quoteDocumentContentFromCms } from "@/lib/quotes/quote-document-content";
import type {
  PartnerRecord,
  QuoteRecord,
} from "@/lib/firebase/schema";

describe("quote document presentation", () => {
  it("builds the formal external-audit title from trusted request context", () => {
    assert.equal(
      quoteDocumentTitle(
        { supplierName: "프리고회계법인" },
        {
          sourceType: "audit_quote",
          fiscalYear: 2027,
          cooperativeName: "가나다농협",
        },
      ),
      "2027년도 가나다농협 외부회계감사 견적서 : 프리고회계법인",
    );
  });

  it("uses a stable numeric display number instead of the storage id", () => {
    const quote = {
      id: "assignment-complex-id_v1",
      version: 1,
      createdAt: "2026-07-24T00:00:00.000Z",
      finalizedAt: "2026-07-24T00:00:00.000Z",
    };
    const displayNumber = quoteDisplayNumber(quote, { fiscalYear: 2027 });
    assert.match(displayNumber, /^2027-\d{8}$/u);
    assert.equal(
      quoteDisplayNumber(quote, { fiscalYear: 2027 }),
      displayNumber,
    );
    assert.notEqual(
      quoteDisplayNumber({ ...quote, version: 2 }, { fiscalYear: 2027 }),
      displayNumber,
    );
  });

  it("addresses audit quotes to the audit contact and shows their email", () => {
    assert.deepEqual(
      quoteRecipient({
        sourceType: "audit_quote",
        cooperativeName: "가나다농협",
        customerName: "김담당",
        customerEmail: "audit@nonghyup.com",
      }),
      {
        name: "가나다농협 김담당 담당자님",
        email: "audit@nonghyup.com",
      },
    );
  });

  it("omits the entire condition section when no condition was entered", () => {
    assert.deepEqual(
      quoteConditionRows({
        servicePeriod: "",
        validUntil: " ",
        terms: undefined,
        notes: undefined,
      }),
      [],
    );
    assert.deepEqual(
      quoteConditionRows({
        servicePeriod: "2027.01 ~ 2027.03",
        validUntil: "",
        terms: "계약 체결 후 착수",
        notes: "",
      }),
      [
        ["수행기간", "2027.01 ~ 2027.03"],
        ["조건", "계약 체결 후 착수"],
      ],
    );
  });

  it("uses the published partner CMS copy for PDF title and recipient", () => {
    const content = structuredClone(CMS_PAGE_DEFAULTS["partner.portal"]);
    const section = content.sections.find(
      (candidate) => candidate.id === "quoteDocument",
    );
    assert.ok(section);
    section.text.auditTitleTemplate =
      "{{cooperativeName}} · {{year}} · {{supplierName}}";
    section.text.recipientTemplate =
      "{{customerName}}님 / {{cooperativeName}}";
    const { copy } = quoteDocumentContentFromCms(content);
    assert.equal(
      quoteDocumentTitle(
        { supplierName: "프리고회계법인" },
        {
          sourceType: "audit_quote",
          fiscalYear: 2027,
          cooperativeName: "가나다농협",
        },
        copy,
      ),
      "가나다농협 · 2027 · 프리고회계법인",
    );
    assert.equal(
      quoteRecipient(
        {
          sourceType: "audit_quote",
          cooperativeName: "가나다농협",
          customerName: "김담당",
          customerEmail: "audit@nonghyup.com",
        },
        copy,
      ).name,
      "김담당님 / 가나다농협",
    );
  });
});

describe("quote supplier profile", () => {
  const partner = {
    name: "기본 회계법인",
    displayName: "기본 회계법인",
    managerName: "김담당",
    contactEmail: "quote@example.com",
    contactPhone: "02-1234-5678",
    businessRegistrationNumber: "123-45-67890",
    businessAddress: "서울특별시 중구 세종대로 1",
  } as PartnerRecord;

  it("uses partner registration details as editable quote defaults", () => {
    assert.deepEqual(quoteSupplierProfileFrom(partner), {
      name: "기본 회계법인",
      businessRegistrationNumber: "123-45-67890",
      address: "서울특별시 중구 세종대로 1",
      contactName: "김담당",
      contactEmail: "quote@example.com",
      contactPhone: "02-1234-5678",
    });
    const quote = {
      supplierName: "수정 회계법인",
      supplierBusinessRegistrationNumber: "987-65-43210",
      supplierAddress: "부산광역시 중구 중앙대로 1",
      supplierContactName: "이담당",
      supplierContactEmail: "edited@example.com",
      supplierContactPhone: "051-123-4567",
    } as QuoteRecord;
    assert.equal(quoteSupplierProfileFrom(partner, quote).name, "수정 회계법인");
  });

  it("requires complete supplier information and a seal for audit quotes", () => {
    assert.equal(
      validateQuoteSupplierProfile(quoteSupplierProfileFrom(partner), {
        requireSeal: true,
        sealPath: "partner-assets/partner-1/seal.png",
      }).valid,
      true,
    );
    const invalid = validateQuoteSupplierProfile({}, { requireSeal: true });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.fieldErrors.businessRegistrationNumber);
    assert.ok(invalid.fieldErrors.seal);
  });

  it("exposes a logo slot copy for the quote document header", () => {
    const { copy } = quoteDocumentContentFromCms(
      CMS_PAGE_DEFAULTS["partner.portal"],
    );
    assert.equal(copy.logoMissing, "제휴사 로고 미등록");
    assert.match(copy.logoMissing, /로고/u);
    assert.equal(copy.credentialsHelp, "");
  });
});

describe("customer-visible partner facts", () => {
  const quote = {
    supplierBusinessRegistrationNumber: "123-45-67890",
    supplierAddress: "서울특별시 중구 세종대로 1",
    supplierContactName: "김담당",
    supplierContactPhone: "02-1234-5678",
    supplierContactEmail: "quote@example.com",
    nhAuditV2: {
      submission: {
        engagementPartnerName: "홍길동",
        proposerType: "ACCOUNTING_FIRM",
        certifiedPublicAccountantCount: 12,
        accountingFirmRevenueWon: "1000000000",
        localNonghyupAuditCount2025: 8,
        auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
        nonghyupTaxAgencyPerformed2025: true,
        nonghyupSubsidySettlementPerformed2025: false,
      },
    },
  } as QuoteRecord;

  it("formats the issue date from the finalized timestamp", () => {
    assert.equal(
      quoteIssueDate({
        createdAt: "2026-07-01T00:00:00.000Z",
        finalizedAt: "2026-07-24T00:00:00.000Z",
      }),
      "2026.07.24",
    );
  });

  it("exposes supplier credentials and engagement facts for the customer", () => {
    const rows = Object.fromEntries(quotePartnerCredentialRows(quote));
    assert.equal(rows["사업자등록번호"], "123-45-67890");
    assert.equal(rows["담당회계사"], "홍길동");
    assert.equal(rows["제안 주체"], "회계법인");
    assert.equal(rows["소속 공인회계사"], "12명");
    assert.equal(rows["전화"], "02-1234-5678");
    assert.equal(rows["이메일"], "quote@example.com");
  });

  it("exposes evaluation facts the customer needs to compare firms", () => {
    const rows = Object.fromEntries(quotePartnerEvaluationFactRows(quote));
    assert.equal(rows["회계법인 매출액"], "1,000,000,000원");
    assert.equal(rows["2025년 지역농협 감사건수"], "8건");
    assert.equal(rows["감사 수행 농협 유형"], "지역농협");
    assert.equal(rows["농협 세무대리 경험"], "있음");
    assert.equal(rows["농협 보조금 정산 경험"], "없음");
  });

  it("omits evaluation facts when the partner has not submitted them", () => {
    assert.deepEqual(
      quotePartnerEvaluationFactRows({
        supplierBusinessRegistrationNumber: "123-45-67890",
      } as QuoteRecord),
      [],
    );
  });

  it("formats large won amounts without using unsafe numbers", () => {
    assert.equal(formatQuoteWon("10000000001", "원"), "10,000,000,001원");
    assert.equal(formatQuoteWon("not-a-number", "원"), "");
  });
});
