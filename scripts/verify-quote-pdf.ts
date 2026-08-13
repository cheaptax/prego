import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderQuotePdf } from "@/lib/quotes/quote-pdf";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";

const quote = {
  id: "quote-preview",
  quoteRequestId: "qr-preview",
  partnerName: "프리고회계법인",
  version: 1,
  createdAt: "2026-07-24T00:00:00.000Z",
  finalizedAt: "2026-07-24T00:00:00.000Z",
  supplierName: "프리고회계법인",
  supplierBusinessRegistrationNumber: "123-45-67890",
  supplierAddress: "서울특별시 중구 세종대로 1",
  supplierContactName: "김담당",
  supplierContactEmail: "quote@example.com",
  supplierContactPhone: "02-1234-5678",
  lineItems: [
    {
      id: "audit-fee",
      name: "회계감사 보수",
      quantity: 1,
      unitPrice: 10_000_000,
      supplyAmount: 10_000_000,
    },
  ],
  subtotal: 10_000_000,
  taxAmount: 1_000_000,
  totalAmount: 11_000_000,
  servicePeriod: "",
  validUntil: "발행일로부터 30일",
  terms: "",
  notes: "",
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

const quoteRequest = {
  id: "qr-preview",
  sourceType: "audit_quote",
  fiscalYear: 2027,
  cooperativeName: "가나다농협",
  customerName: "김담당",
  customerEmail: "audit@nonghyup.com",
  subject: "외부회계감사",
} as QuoteRequestRecord;

async function main() {
  const buffer = await renderQuotePdf({ quote, quoteRequest });
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" "),
    );
  }

  const text = pageTexts.join(" ");
  for (const expected of [
    "2027년도 가나다농협 외부회계감사 견적서 : 프리고회계법인",
    "가나다농협 김담당 담당자님",
    "수신자 이메일",
    "audit@nonghyup.com",
    "견적번호",
    "2027-",
    "아래와 같이 견적합니다.",
    "사업자등록번호",
    "공급자 기본정보",
    "제휴사 평가정보",
    "담당회계사",
    "홍길동",
    "소속 공인회계사",
    "2025년 지역농협 감사건수",
    "가격 견적 비교 보고서",
    "QR코드를 스캔하면 다른 회계법인의 가격 견적과 비교 보고서를 확인할 수 있습니다.",
    "(주)프리고 농협지원센터의 표준 견적양식을 준수하여 작성된 견적서입니다.",
    "이용해 주셔서 감사합니다.",
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`quote_pdf_text_missing:${expected}`);
    }
  }
  if (pdf.numPages < 2) {
    throw new Error("quote_pdf_evaluation_not_on_second_page");
  }
  if (pageTexts[0]?.includes("제휴사 평가정보")) {
    throw new Error("quote_pdf_evaluation_on_price_page");
  }
  if (!pageTexts[0]?.includes("아래와 같이 견적합니다.")) {
    throw new Error("quote_pdf_price_intro_missing_on_first_page");
  }
  if (!pageTexts[0]?.includes("가격 견적 비교 보고서")) {
    throw new Error("quote_pdf_comparison_qr_missing_on_first_page");
  }
  if (!pageTexts[1]?.includes("제휴사 평가정보")) {
    throw new Error("quote_pdf_evaluation_missing_on_second_page");
  }
  if (text.includes("고객 확인")) {
    throw new Error("quote_pdf_acceptance_rendered");
  }
  if (text.includes("제휴사 등록정보와 제출된 평가자료를 바탕으로 표시됩니다.")) {
    throw new Error("quote_pdf_credentials_help_rendered");
  }
  if (text.includes("quote-preview")) {
    throw new Error("quote_pdf_storage_id_exposed");
  }

  console.log(`quote-pdf-ok pages=${pdf.numPages} bytes=${buffer.length}`);
}

void main();
