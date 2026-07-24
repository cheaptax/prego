import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  quoteConditionRows,
  quoteDisplayNumber,
  quoteDocumentTitle,
  quoteRecipient,
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
});
