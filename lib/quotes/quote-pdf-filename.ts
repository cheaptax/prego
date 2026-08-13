import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";

/** Keep Korean and common punctuation; strip path / reserved Windows chars. */
export function sanitizeQuoteFileNameSegment(value: string, fallback: string) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function buildQuotePdfFileName(input: {
  sourceType?: QuoteRequestRecord["sourceType"] | string;
  cooperativeName?: string;
  partnerName?: string;
  fiscalYear?: number;
  version?: number;
  subject?: string;
}): string {
  const partnerName = sanitizeQuoteFileNameSegment(
    input.partnerName ?? "",
    "회계법인",
  );
  if (input.sourceType === "audit_quote") {
    const cooperativeName = sanitizeQuoteFileNameSegment(
      input.cooperativeName ?? "",
      "농협",
    );
    const fiscalYear = Number.isSafeInteger(input.fiscalYear)
      ? Number(input.fiscalYear)
      : 2027;
    let base = `${cooperativeName}_${partnerName}_FY${fiscalYear} 외부회계감사견적서`;
    if (
      Number.isSafeInteger(input.version) &&
      Number(input.version) > 1
    ) {
      base = `${base}_v${input.version}`;
    }
    return `${base}.pdf`;
  }

  const subject = sanitizeQuoteFileNameSegment(
    input.subject ?? "",
    "견적서",
  );
  let base = `${subject}_${partnerName}_견적서`;
  if (Number.isSafeInteger(input.version) && Number(input.version) > 1) {
    base = `${base}_v${input.version}`;
  }
  return `${base}.pdf`;
}

export function quotePdfFileNameFromRecords(
  quote: Pick<
    QuoteRecord,
    "partnerName" | "supplierName" | "version"
  >,
  quoteRequest: Pick<
    QuoteRequestRecord,
    "sourceType" | "cooperativeName" | "fiscalYear" | "subject"
  >,
) {
  return buildQuotePdfFileName({
    sourceType: quoteRequest.sourceType,
    cooperativeName: quoteRequest.cooperativeName,
    partnerName: quote.supplierName || quote.partnerName,
    fiscalYear: quoteRequest.fiscalYear,
    version: quote.version,
    subject: quoteRequest.subject,
  });
}

/** RFC 6266 / 5987 disposition so browsers keep Korean filenames. */
export function buildAttachmentContentDisposition(fileName: string) {
  const normalized = fileName.normalize("NFKC").trim() || "quote.pdf";
  const withPdf = /\.pdf$/iu.test(normalized)
    ? normalized
    : `${normalized}.pdf`;
  const asciiFallback =
    withPdf
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "quote.pdf";
  const asciiName = /\.pdf$/iu.test(asciiFallback)
    ? asciiFallback
    : `${asciiFallback}.pdf`;
  const encoded = encodeURIComponent(withPdf).replace(
    /[!'()*]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}
