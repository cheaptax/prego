import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import type { PartnerRecord } from "@/lib/firebase/schema";
import { resolveQuoteLogoTheme } from "@/lib/quotes/quote-logo-theme";
import {
  prepareQuoteImageDataUri,
  usableQuoteImageDataUri,
} from "@/lib/quotes/quote-pdf-assets";
import {
  buildQuoteScreenPreviewQuote,
  buildQuoteScreenPreviewRequest,
  parseQuoteScreenPreviewProfile,
} from "@/lib/quotes/quote-screen-preview";
import {
  DEFAULT_QUOTE_SCREEN_SECTIONS,
  mergeQuoteScreenProfile,
  normalizeQuoteScreenProfile,
  recommendedQuoteLayoutFamily,
} from "@/lib/quotes/quote-screen-profile";

describe("partner quote screen profile", () => {
  it("keeps required sections visible while applying partner-specific style", () => {
    const profile = normalizeQuoteScreenProfile(
      {
        layoutFamily: "formalCentered",
        sections: [
          { id: "quoteItems", visible: false, order: 90 },
          { id: "evaluationFacts", visible: false, order: 10 },
        ],
        copy: {
          footerStatement: "본 견적서는 한빛회계법인의 독립 검토에 따라 작성되었습니다.",
          evaluationFactsTitle: "한빛회계법인 수행 경험",
        },
        theme: {
          primary: "#2f3a8f",
          accent: "#b45309",
          ink: "#111827",
          muted: "#6b7280",
          surface: "#ffffff",
          subtle: "#ede9fe",
          titleAlignment: "center",
          spacing: "relaxed",
        },
      },
      { uid: "admin-1", email: "admin@example.com" },
      "2026-08-18T00:00:00.000Z",
    );

    const quoteItems = profile.sections.find((section) => section.id === "quoteItems");
    assert.equal(quoteItems?.visible, true);
    assert.equal(
      profile.sections.find((section) => section.id === "evaluationFacts")?.visible,
      false,
    );

    const documentContent = mergeQuoteScreenProfile(
      CMS_PAGE_DEFAULTS["partner.portal"],
      profile,
    );
    assert.equal(documentContent.layoutFamily, "formalCentered");
    assert.equal(documentContent.copy.evaluationFactsTitle, "한빛회계법인 수행 경험");
    assert.equal(
      documentContent.copy.footerStatement,
      "본 견적서는 한빛회계법인의 독립 검토에 따라 작성되었습니다.",
    );
    assert.equal(documentContent.theme?.primary, "#2f3a8f");
    assert.equal(documentContent.style.title.alignment, "center");
    assert.equal(documentContent.style.container.spacing, "relaxed");
  });

  it("accepts an editor payload with empty title overrides", () => {
    const profile = parseQuoteScreenPreviewProfile(
      {
        layoutFamily: "classicNavy",
        sections: [
          {
            id: "supplierHeader",
            visible: true,
            order: 10,
            titleOverride: "",
          },
        ],
        copy: {},
        theme: {
          primary: "#1B365D",
          accent: "#0f766e",
          ink: "#1A2332",
          muted: "#5B6B7C",
          surface: "#ffffff",
          subtle: "#E8EEF5",
          titleAlignment: "left",
          spacing: "default",
        },
      },
      { uid: "admin-1", email: "admin@example.com" },
      "2026-08-18T00:00:00.000Z",
    );
    assert.ok(profile);
    assert.equal(profile.layoutFamily, "classicNavy");
  });

  it("builds a preview quote from messy partner evaluation defaults", () => {
    const now = "2026-08-18T00:00:00.000Z";
    const quote = buildQuoteScreenPreviewQuote(
      {
        id: "seyeon",
        name: "세연회계법인",
        displayName: "세연회계법인",
        contactEmail: "kicpa.bsm@gmail.com",
        nhAuditEvaluationDefaults: {
          engagementPartnerName: "박세연",
          proposerType: "ACCOUNTING_FIRM",
          localNonghyupAuditCount2025: "8",
          certifiedPublicAccountantCount: "12",
          accountingFirmRevenueWon: "10,500,000,000",
          auditedNonghyupTypes2025: ["LOCAL_AGRICULTURAL_COOPERATIVE"],
          nonghyupTaxAgencyPerformed2025: "YES",
          nonghyupSubsidySettlementPerformed2025: "NO",
        },
      } as PartnerRecord,
      buildQuoteScreenPreviewRequest(now),
      now,
    );
    assert.equal(quote.partnerName, "세연회계법인");
    assert.equal(
      quote.nhAuditV2?.submission.accountingFirmRevenueWon,
      "10500000000",
    );
    assert.equal(quote.nhAuditV2?.submission.nonghyupTaxAgencyPerformed2025, true);
    assert.equal(
      quote.nhAuditV2?.submission.nonghyupSubsidySettlementPerformed2025,
      false,
    );
    assert.equal(quote.notes, "본 미리보기는 운영자 템플릿 확인용 샘플입니다.");
    assert.equal(quote.servicePeriod, "2026.12 ~ 2028.02");
    assert.equal(quote.validUntil, "발행일로부터 감사계약 체결시까지");
    assert.equal(quote.terms, "감사 일정은 자료 수령 일정에 따라 협의합니다.");
  });

  it("falls back to global quote document content without a partner profile", () => {
    const documentContent = mergeQuoteScreenProfile(
      CMS_PAGE_DEFAULTS["partner.portal"],
      null,
    );
    assert.equal(documentContent.layoutFamily, undefined);
    assert.match(documentContent.copy.footerStatement, /표준 견적양식/u);
  });

  it("derives a quote theme from a partner logo when colors are default", async () => {
    const canvas = createCanvas(16, 16);
    const context = canvas.getContext("2d");
    context.fillStyle = "#dc2626";
    context.fillRect(0, 0, 16, 16);
    const theme = await resolveQuoteLogoTheme({
      logoDataUri: canvas.toDataURL("image/png"),
      layoutFamily: "classicNavy",
    });
    assert.notEqual(theme.primary, "#1B365D");
    assert.match(theme.primary, /^#[0-9a-f]{6}$/iu);
    assert.match(theme.subtle, /^#[0-9a-f]{6}$/iu);
  });

  it("uses layout-specific fallback colors when a logo is unavailable", async () => {
    const theme = await resolveQuoteLogoTheme({
      layoutFamily: "formalCentered",
    });
    assert.equal(theme.primary, "#2f3a8f");
    assert.equal(theme.subtle, "#eef2ff");
  });

  it("places quote prices before evaluation facts in the default section order", () => {
    const evaluationOrder = DEFAULT_QUOTE_SCREEN_SECTIONS.find(
      (section) => section.id === "evaluationFacts",
    )?.order;
    const priceOrder = DEFAULT_QUOTE_SCREEN_SECTIONS.find(
      (section) => section.id === "quoteItems",
    )?.order;
    assert.ok(evaluationOrder != null && priceOrder != null);
    assert.ok(priceOrder < evaluationOrder);
  });

  it("gives 상지회계법인 a letterhead layout once a logo can be applied", () => {
    assert.equal(
      recommendedQuoteLayoutFamily({
        name: "상지회계법인",
        displayName: "상지회계법인",
      }),
      "letterheadLeft",
    );
    assert.equal(
      recommendedQuoteLayoutFamily({
        name: "인성회계법인",
        displayName: "인성회계법인",
      }),
      undefined,
    );
  });

  it("does not throw when logo theme extraction receives unusable artwork", async () => {
    const theme = await resolveQuoteLogoTheme({
      layoutFamily: "letterheadLeft",
      logoDataUri: "data:image/svg+xml;base64,PHN2Zy8+",
    });
    assert.equal(theme.primary, "#14532d");
  });

  it("rejects quote images that cannot be embedded safely", () => {
    const canvas = createCanvas(16, 16);
    const context = canvas.getContext("2d");
    context.fillStyle = "#dc2626";
    context.fillRect(0, 0, 16, 16);
    assert.ok(usableQuoteImageDataUri(canvas.toDataURL("image/png")));
    assert.equal(
      usableQuoteImageDataUri(
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==",
      ),
      undefined,
    );
    assert.equal(
      usableQuoteImageDataUri(`data:image/png;base64,${"A".repeat(1_200_001)}`),
      undefined,
    );
    assert.equal(
      usableQuoteImageDataUri(`data:image/png;base64,${"A".repeat(240)}`),
      undefined,
    );
  });

  it("keeps a registered partner logo even when the stored type or size is messy", async () => {
    const canvas = createCanvas(640, 240);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ea580c";
    context.fillRect(0, 0, 640, 240);
    context.fillStyle = "#ffffff";
    context.fillRect(24, 24, 180, 80);
    const png = canvas.toDataURL("image/png");
    const comma = png.indexOf(",");
    const octetStream = `data:application/octet-stream;base64,${png.slice(comma + 1)}`;
    const prepared = await prepareQuoteImageDataUri(octetStream);
    assert.ok(prepared);
    assert.match(prepared, /^data:image\/(?:png|jpeg);base64,/u);

    const noisy = createCanvas(1400, 900);
    const paint = noisy.getContext("2d");
    for (let row = 0; row < 900; row += 1) {
      paint.fillStyle = `hsl(${row % 360} 80% ${35 + (row % 40)}%)`;
      paint.fillRect(0, row, 1400, 1);
    }
    const bulky = noisy.toDataURL("image/jpeg", 0.92);
    const compact = await prepareQuoteImageDataUri(bulky);
    assert.ok(compact);
    assert.match(compact, /^data:image\/(?:png|jpeg);base64,/u);
  });
});
