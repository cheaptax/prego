import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttachmentContentDisposition,
  buildQuotePdfFileName,
  quotePdfFileNameFromRecords,
} from "@/lib/quotes/quote-pdf-filename";

describe("quote PDF filename", () => {
  it("builds the audit quote download name with cooperative, firm and FY", () => {
    assert.equal(
      buildQuotePdfFileName({
        sourceType: "audit_quote",
        cooperativeName: "프리고농협",
        partnerName: "삼일회계법인",
        fiscalYear: 2027,
        version: 1,
      }),
      "프리고농협_삼일회계법인_FY2027 외부회계감사견적서.pdf",
    );
  });

  it("appends revision version only after the first send", () => {
    assert.equal(
      buildQuotePdfFileName({
        sourceType: "audit_quote",
        cooperativeName: "프리고농협",
        partnerName: "삼일회계법인",
        fiscalYear: 2027,
        version: 2,
      }),
      "프리고농협_삼일회계법인_FY2027 외부회계감사견적서_v2.pdf",
    );
  });

  it("strips reserved path characters but keeps Korean text", () => {
    assert.equal(
      buildQuotePdfFileName({
        sourceType: "audit_quote",
        cooperativeName: '테스트/농협*이름',
        partnerName: '회계법인:에이',
        fiscalYear: 2027,
      }),
      "테스트농협이름_회계법인에이_FY2027 외부회계감사견적서.pdf",
    );
  });

  it("emits RFC 5987 content-disposition with a UTF-8 filename", () => {
    const disposition = buildAttachmentContentDisposition(
      "프리고농협_삼일회계법인_FY2027 외부회계감사견적서.pdf",
    );
    assert.match(disposition, /^attachment; filename="/);
    assert.match(disposition, /filename\*=UTF-8''/);
    assert.match(
      disposition,
      /FY2027/,
    );
    assert.ok(
      disposition.includes(
        encodeURIComponent("프리고농협_삼일회계법인_FY2027 외부회계감사견적서.pdf").replace(
          /[!'()*]/g,
          (char) =>
            `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
        ),
      ),
    );
  });

  it("prefers supplier name from the quote record", () => {
    assert.equal(
      quotePdfFileNameFromRecords(
        {
          partnerName: "표시명",
          supplierName: "정식회계법인",
          version: 1,
        },
        {
          sourceType: "audit_quote",
          cooperativeName: "서울농협",
          fiscalYear: 2027,
          subject: "감사견적",
        },
      ),
      "서울농협_정식회계법인_FY2027 외부회계감사견적서.pdf",
    );
  });
});
