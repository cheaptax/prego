import { createHash } from "node:crypto";
import {
  buildAiExtractionRequest,
  type AiExtractionMetadata,
  type QuoteAiExtractionAdapter,
  type QuoteOcrAdapter,
} from "@/lib/audit-evaluation/quote-extraction-adapters";
import { crossValidateQuote } from "@/lib/audit-evaluation/quote-cross-validation";
import { parseQuoteDeterministically } from "@/lib/audit-evaluation/quote-deterministic-parser";
import {
  emptyExtractionFields,
  quoteExtractionCandidateSchema,
  quoteExtractionFieldsSchema,
  type QuoteExtractionCandidate,
  type QuoteExtractionFields,
} from "@/lib/audit-evaluation/quote-extraction-schemas";
import {
  extractPdfText,
  type PdfPageText,
} from "@/lib/audit-evaluation/pdf-text-extractor";
import { trustedStandardQuotePayloadSchema } from "@/lib/audit-evaluation/quote-document-schemas";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type NormalizedAuditQuote,
  type NormalizedAuditQuoteField,
  type QuoteEvidenceValue,
  type QuoteFieldEvidence,
  type QuoteFieldSource,
  type QuoteWarning,
  type StandardQuoteDocumentRecord,
  type TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";

export const QUOTE_SOURCE_PRIORITY: Readonly<Record<QuoteFieldSource, number>> = {
  TRUSTED_SERVER_RECORD: 700,
  EMBEDDED_METADATA: 600,
  DETERMINISTIC_PARSE: 500,
  OCR: 400,
  AI_EXTRACTION: 300,
  CUSTOMER_CORRECTION: 200,
  ADMIN_CORRECTION: 100,
};

export const EMBEDDED_QUOTE_PAYLOAD_PREFIX =
  "NHSC-QUOTE-PAYLOAD:v1:";

export type PipelineFieldEvidence = QuoteFieldEvidence;
export type PipelineNormalizedAuditQuote = NormalizedAuditQuote;

export type EmbeddedPayloadParseResult = {
  candidate: QuoteExtractionCandidate | null;
  checksum: string | null;
  checksumVerified: boolean | null;
  warnings: QuoteWarning[];
};

export type QuoteExtractionPipelineInput = {
  quoteId: string;
  caseId: string;
  documentId: string;
  documentBytes?: Uint8Array;
  pages?: readonly PdfPageText[];
  scanned?: boolean;
  trustedServerRecord?: StandardQuoteDocumentRecord | null;
  embeddedMetadataText?: string | null;
  embeddedPayloadChecksum?: string | null;
  customerCorrection?: QuoteExtractionCandidate | null;
  adminCorrection?: QuoteExtractionCandidate | null;
  displayedBusinessYear?: number | null;
  otherQuotes?: readonly Pick<
    NormalizedAuditQuote,
    "quoteId" | "accountingFirmName"
  >[];
  requiredProposalItemIds?: readonly string[];
};

export type QuoteExtractionPipelineOptions = {
  requiredFields?: readonly NormalizedAuditQuoteField[];
  deterministicParserEnabled?: boolean;
  ocrEnabled?: boolean;
  ocrAdapter?: QuoteOcrAdapter;
  aiEnabled?: boolean;
  aiAdapter?: QuoteAiExtractionAdapter;
  aiPromptVersion?: string;
};

export type QuoteExtractionPipelineResult =
  | {
      status: "SUCCESS" | "NEEDS_REVIEW";
      quote: PipelineNormalizedAuditQuote;
      aiMetadata: AiExtractionMetadata | null;
      failure: null;
    }
  | {
      status: "FAILED";
      quote: null;
      aiMetadata: AiExtractionMetadata | null;
      failure: { code: string; message: string };
    };

type MergedField = {
  value: QuoteExtractionFields[NormalizedAuditQuoteField];
  source: QuoteFieldSource;
  confidence: number;
  evidence: QuoteFieldEvidence[];
};

export async function runQuoteExtractionPipeline(
  input: QuoteExtractionPipelineInput,
  options: QuoteExtractionPipelineOptions = {},
): Promise<QuoteExtractionPipelineResult> {
  const warnings: QuoteWarning[] = [];
  const merged = new Map<NormalizedAuditQuoteField, MergedField>();
  let pages = [...(input.pages ?? [])];
  let scanned = input.scanned ?? false;
  let aiMetadata: AiExtractionMetadata | null = null;

  if (pages.length === 0 && input.documentBytes) {
    try {
      const extracted = await extractPdfText(input.documentBytes);
      pages = extracted.pages;
      scanned = extracted.scanned;
      warnings.push(...extracted.warnings.map((code) => ({
        code,
        field: null,
        message: pdfWarningMessage(code),
      })));
    } catch {
      warnings.push({
        code: "PDF_TEXT_EXTRACTION_FAILED",
        field: null,
        message: "PDF 내장 텍스트를 읽지 못했습니다.",
      });
    }
  }

  if (input.trustedServerRecord) {
    mergeCandidate(
      merged,
      candidateFromTrustedPayload(input.trustedServerRecord.normalizedPayload),
      "TRUSTED_SERVER_RECORD",
      input.documentId,
      warnings,
    );
  }

  if (
    input.embeddedMetadataText?.includes("NHSC-QUOTE-PAYLOAD:v1:")
  ) {
    const embedded = parseEmbeddedQuotePayload(
      input.embeddedMetadataText,
      input.embeddedPayloadChecksum,
    );
    warnings.push(...embedded.warnings);
    if (embedded.candidate) {
      mergeCandidate(
        merged,
        embedded.candidate,
        "EMBEDDED_METADATA",
        input.documentId,
        warnings,
      );
    }
  }

  if (
    options.deterministicParserEnabled !== false &&
    pages.some((page) => page.text.trim().length > 0)
  ) {
    mergeCandidate(
      merged,
      parseQuoteDeterministically(pages),
      "DETERMINISTIC_PARSE",
      input.documentId,
      warnings,
    );
  }

  if (
    options.ocrEnabled !== false &&
    options.ocrAdapter?.available === true &&
    input.documentBytes &&
    hasMissingValues(merged)
  ) {
    try {
      const candidate = quoteExtractionCandidateSchema.parse(
        await options.ocrAdapter.extract({
          documentId: input.documentId,
          documentBytes: input.documentBytes,
          maximumPages: 500,
        }),
      );
      mergeCandidate(merged, candidate, "OCR", input.documentId, warnings);
    } catch {
      warnings.push({
        code: "OCR_EXTRACTION_FAILED",
        field: null,
        message: "OCR 추출에 실패하여 수동 확인이 필요합니다.",
      });
    }
  } else if (scanned && !options.ocrAdapter?.available) {
    warnings.push({
      code: "OCR_UNAVAILABLE_FOR_SCANNED_PDF",
      field: null,
      message: "스캔 PDF이지만 사용 가능한 OCR 어댑터가 없습니다.",
    });
  }

  if (
    options.aiEnabled === true &&
    options.aiAdapter?.available === true &&
    hasMissingValues(merged)
  ) {
    try {
      const request = buildAiExtractionRequest(
        input.documentId,
        pages,
        options.aiPromptVersion,
      );
      const output = await options.aiAdapter.extract(request);
      const candidate = quoteExtractionCandidateSchema.parse(output.candidate);
      aiMetadata = {
        model: safeMetadataText(output.metadata.model, options.aiAdapter.model),
        promptVersion: request.promptVersion,
        timestamp: validTimestamp(output.metadata.timestamp),
      };
      mergeCandidate(
        merged,
        candidate,
        "AI_EXTRACTION",
        input.documentId,
        warnings,
      );
    } catch {
      warnings.push({
        code: "AI_EXTRACTION_FAILED",
        field: null,
        message: "AI 추출에 실패했으며 기존 근거만 사용했습니다.",
      });
    }
  }

  mergeOptionalCorrection(
    merged,
    input.customerCorrection,
    "CUSTOMER_CORRECTION",
    input.documentId,
    warnings,
  );
  mergeOptionalCorrection(
    merged,
    input.adminCorrection,
    "ADMIN_CORRECTION",
    input.documentId,
    warnings,
  );

  if (merged.size === 0) {
    return {
      status: "FAILED",
      quote: null,
      aiMetadata,
      failure: {
        code: "NO_EXTRACTABLE_QUOTE_DATA",
        message: "견적서에서 확정 가능한 값을 찾지 못했습니다.",
      },
    };
  }

  const missingFields = NORMALIZED_AUDIT_QUOTE_FIELDS.filter(
    (field) => !merged.has(field),
  );
  const requiredFields = options.requiredFields ?? NORMALIZED_AUDIT_QUOTE_FIELDS;
  for (const field of requiredFields.filter((item) => !merged.has(item))) {
    warnings.push({
      code: "REQUIRED_FIELD_MISSING",
      field,
      message: "필수 추출값이 없어 확인이 필요합니다.",
    });
  }

  const quote = buildNormalizedQuote(input, merged, missingFields, warnings);
  quote.warnings.push(...crossValidateQuote({
    quote,
    displayedBusinessYear:
      input.displayedBusinessYear ?? readBusinessYear(pages),
    trustedServerRecord: input.trustedServerRecord
      ? {
          accountingFirmName:
            input.trustedServerRecord.normalizedPayload.accountingFirmName,
          auditFee: input.trustedServerRecord.normalizedPayload.auditFee,
          fiscalYear: input.trustedServerRecord.fiscalYear,
        }
      : null,
    evidenceByField: quote.evidenceByField,
    otherQuotes: input.otherQuotes,
    requiredProposalItemIds: input.requiredProposalItemIds,
  }));
  quote.warnings = deduplicateWarnings(quote.warnings);
  attachWarningsToEvidence(quote);

  return {
    status:
      quote.missingFields.length > 0 || quote.warnings.length > 0
        ? "NEEDS_REVIEW"
        : "SUCCESS",
    quote,
    aiMetadata,
    failure: null,
  };
}

export function parseEmbeddedQuotePayload(
  text: string,
  expectedChecksum: string | null = null,
): EmbeddedPayloadParseResult {
  const warnings: QuoteWarning[] = [];
  const marker = text
    .slice(0, 2_000_000)
    .match(/NHSC-QUOTE-PAYLOAD:v1:([A-Za-z0-9_-]{1,65536})/)?.[1];
  if (!marker) {
    return {
      candidate: null,
      checksum: null,
      checksumVerified: null,
      warnings: [{
        code: "EMBEDDED_PAYLOAD_NOT_FOUND",
        field: null,
        message: "내장 견적 메타데이터 표식을 찾지 못했습니다.",
      }],
    };
  }

  try {
    const decoded = Buffer.from(marker, "base64url").toString("utf8");
    if (Buffer.byteLength(decoded, "utf8") > 128_000) {
      throw new Error("embedded_payload_too_large");
    }
    const raw = JSON.parse(decoded) as unknown;
    const envelope = readEnvelope(raw);
    const payload = envelope.payload;
    const checksum = sha256Canonical(payload);
    const checksumToVerify = expectedChecksum ?? envelope.payloadChecksum;
    if (checksumToVerify && checksum !== checksumToVerify) {
      return {
        candidate: null,
        checksum,
        checksumVerified: false,
        warnings: [{
          code: "EMBEDDED_PAYLOAD_CHECKSUM_MISMATCH",
          field: null,
          message: "내장 견적 메타데이터 체크섬이 일치하지 않습니다.",
        }],
      };
    }
    if (!checksumToVerify) {
      warnings.push({
        code: "EMBEDDED_PAYLOAD_CHECKSUM_NOT_PROVIDED",
        field: null,
        message: "내장 견적 메타데이터 체크섬을 확인할 수 없습니다.",
      });
    }
    const candidate = candidateFromEmbeddedPayload(payload);
    if (!candidate) throw new Error("invalid_embedded_payload");
    return {
      candidate,
      checksum,
      checksumVerified: checksumToVerify ? true : null,
      warnings,
    };
  } catch {
    return {
      candidate: null,
      checksum: null,
      checksumVerified: null,
      warnings: [{
        code: "INVALID_EMBEDDED_PAYLOAD",
        field: null,
        message: "내장 견적 메타데이터가 유효하지 않습니다.",
      }],
    };
  }
}

function mergeOptionalCorrection(
  merged: Map<NormalizedAuditQuoteField, MergedField>,
  correction: QuoteExtractionCandidate | null | undefined,
  source: "CUSTOMER_CORRECTION" | "ADMIN_CORRECTION",
  documentId: string,
  warnings: QuoteWarning[],
) {
  if (!correction) return;
  const parsed = quoteExtractionCandidateSchema.safeParse(correction);
  if (!parsed.success) {
    warnings.push({
      code: "INVALID_CORRECTION",
      field: null,
      message: "수정 데이터가 추출 스키마와 일치하지 않아 사용하지 않았습니다.",
    });
    return;
  }
  mergeCandidate(merged, parsed.data, source, documentId, warnings);
}

function mergeCandidate(
  merged: Map<NormalizedAuditQuoteField, MergedField>,
  candidate: QuoteExtractionCandidate,
  source: QuoteFieldSource,
  documentId: string,
  warnings: QuoteWarning[],
) {
  warnings.push(...candidate.warnings);
  for (const field of NORMALIZED_AUDIT_QUOTE_FIELDS) {
    const value = candidate.fields[field];
    if (value === null) continue;
    const current = merged.get(field);
    if (
      current &&
      QUOTE_SOURCE_PRIORITY[current.source] >= QUOTE_SOURCE_PRIORITY[source]
    ) {
      warnTrustedDisplayMismatch(current, source, field, value, warnings);
      continue;
    }
    const confidence = candidate.confidenceByField[field] ??
      defaultConfidence(source);
    const sourceEvidence = candidate.evidenceByField[field] ?? [];
    if (
      (source === "OCR" || source === "AI_EXTRACTION") &&
      sourceEvidence.length === 0
    ) {
      warnings.push({
        code: "FIELD_EVIDENCE_REQUIRED",
        field,
        message: "OCR 또는 AI 추출값에 문서 근거가 없어 사용하지 않았습니다.",
      });
      continue;
    }
    if (
      (field === "auditFee" || field === "accountingFirmRevenue") &&
      (source === "OCR" || source === "AI_EXTRACTION") &&
      !sourceEvidence.some((item) =>
        /(?:억원|백만원|만원|천원|원)(?:\s|$|[),.])/u.test(item.excerpt)
      )
    ) {
      warnings.push({
        code: "MISSING_AMOUNT_UNIT",
        field,
        message: "금액 근거에 단위가 없어 원화 금액으로 확정하지 않았습니다.",
      });
      continue;
    }
    const evidence: QuoteFieldEvidence[] = sourceEvidence.length > 0
      ? sourceEvidence.map((item) => ({
          documentId,
          extractedValue: item.excerpt,
          normalizedValue: toEvidenceValue(value),
          source,
          confidence,
          pageNumber: item.pageNumber,
          excerpt: item.excerpt.slice(0, 500),
          coordinates: item.coordinates,
          cellAddress: item.cellAddress,
          validationWarnings: item.validationWarnings.map((warning) =>
            warning.slice(0, 500)
          ),
        }))
      : [{
          documentId,
          extractedValue: toEvidenceValue(value),
          normalizedValue: toEvidenceValue(value),
          source,
          confidence,
          pageNumber: null,
          excerpt: "구조화된 데이터에서 추출됨",
          coordinates: null,
          cellAddress: null,
          validationWarnings: [],
        }];
    merged.set(field, { value, source, confidence, evidence });
  }
}

function warnTrustedDisplayMismatch(
  current: MergedField,
  incomingSource: QuoteFieldSource,
  field: NormalizedAuditQuoteField,
  incomingValue: QuoteExtractionFields[NormalizedAuditQuoteField],
  warnings: QuoteWarning[],
) {
  if (
    current.source !== "TRUSTED_SERVER_RECORD" ||
    incomingSource === "TRUSTED_SERVER_RECORD" ||
    (field !== "accountingFirmName" && field !== "auditFee")
  ) {
    return;
  }
  const sameValue = field === "accountingFirmName"
    ? String(current.value).normalize("NFKC").replace(/\s+/g, "") ===
      String(incomingValue).normalize("NFKC").replace(/\s+/g, "")
    : current.value === incomingValue;
  if (sameValue) return;
  warnings.push({
    code: field === "auditFee"
      ? "SERVER_AUDIT_FEE_MISMATCH"
      : "SERVER_FIRM_NAME_MISMATCH",
    field,
    message: field === "auditFee"
      ? "서버 등록 감사보수와 문서 표시 감사보수가 다릅니다."
      : "서버 등록 법인명과 문서 표시 법인명이 다릅니다.",
  });
}

function buildNormalizedQuote(
  input: QuoteExtractionPipelineInput,
  merged: Map<NormalizedAuditQuoteField, MergedField>,
  missingFields: NormalizedAuditQuoteField[],
  warnings: QuoteWarning[],
): PipelineNormalizedAuditQuote {
  const values = emptyExtractionFields();
  const source: NormalizedAuditQuote["source"] = {};
  const confidenceByField: NormalizedAuditQuote["confidenceByField"] = {};
  const evidenceByField: NormalizedAuditQuote["evidenceByField"] = {};
  for (const [field, item] of merged) {
    setFieldValue(values, field, item.value);
    source[field] = item.source;
    confidenceByField[field] = item.confidence;
    evidenceByField[field] = item.evidence;
  }
  return {
    quoteId: input.quoteId,
    caseId: input.caseId,
    documentId: input.documentId,
    accountingFirmId: values.accountingFirmId,
    accountingFirmName: values.accountingFirmName ?? "",
    auditFee: values.auditFee,
    vatIncluded: values.vatIncluded,
    accountingFirmRevenue: values.accountingFirmRevenue,
    recentNonghyupAuditCount: values.recentNonghyupAuditCount,
    auditedNonghyupTypes: values.auditedNonghyupTypes ?? [],
    taxAgencyExperience: values.taxAgencyExperience ?? {
      hasExperience: false,
      descriptions: [],
    },
    subsidySettlementExperience: values.subsidySettlementExperience ?? {
      hasExperience: false,
      descriptions: [],
    },
    engagementPartner: values.engagementPartner,
    engagementTeam: values.engagementTeam ?? [],
    totalPlannedHours: values.totalPlannedHours,
    partnerHours: values.partnerHours,
    auditSchedule: values.auditSchedule ?? [],
    qualityControlPlan: values.qualityControlPlan ?? [],
    requiredProposalItems: values.requiredProposalItems ?? {},
    missingFields,
    warnings: [...warnings],
    confidenceByField,
    evidenceByField,
    source,
    confirmedByCustomer: false,
    confirmedAt: null,
  };
}

function candidateFromTrustedPayload(
  payload: TrustedStandardQuotePayload,
): QuoteExtractionCandidate {
  const fields = trustedStandardQuotePayloadSchema.parse(payload);
  return quoteExtractionCandidateSchema.parse({
    fields,
    confidenceByField: Object.fromEntries(
      NORMALIZED_AUDIT_QUOTE_FIELDS.map((field) => [field, 100]),
    ),
    evidenceByField: {},
    warnings: [],
  });
}

function candidateFromEmbeddedPayload(
  payload: unknown,
): QuoteExtractionCandidate | null {
  const trusted = trustedStandardQuotePayloadSchema.safeParse(payload);
  if (trusted.success) {
    return quoteExtractionCandidateSchema.parse({
      fields: trusted.data,
      confidenceByField: {},
      evidenceByField: {},
      warnings: [],
    });
  }
  const fields = quoteExtractionFieldsSchema.safeParse(payload);
  if (!fields.success) return null;
  return quoteExtractionCandidateSchema.parse({
    fields: fields.data,
    confidenceByField: {},
    evidenceByField: {},
    warnings: [],
  });
}

function readEnvelope(raw: unknown): {
  payload: unknown;
  payloadChecksum: string | null;
} {
  if (
    raw &&
    typeof raw === "object" &&
    "payload" in raw
  ) {
    const record = raw as Record<string, unknown>;
    return {
      payload: record.payload,
      payloadChecksum:
        typeof record.payloadChecksum === "string" &&
        /^[a-f0-9]{64}$/.test(record.payloadChecksum)
          ? record.payloadChecksum
          : null,
    };
  }
  return { payload: raw, payloadChecksum: null };
}

function sha256Canonical(value: unknown) {
  return createHash("sha256").update(stableSerialize(value), "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${stableSerialize(item)}`
    ).join(",")}}`;
  }
  throw new Error("unsupported_canonical_value");
}

function hasMissingValues(
  merged: Map<NormalizedAuditQuoteField, MergedField>,
) {
  return NORMALIZED_AUDIT_QUOTE_FIELDS.some((field) => !merged.has(field));
}

function defaultConfidence(source: QuoteFieldSource) {
  return {
    TRUSTED_SERVER_RECORD: 100,
    EMBEDDED_METADATA: 95,
    DETERMINISTIC_PARSE: 85,
    OCR: 70,
    AI_EXTRACTION: 60,
    CUSTOMER_CORRECTION: 90,
    ADMIN_CORRECTION: 95,
  }[source];
}

function readBusinessYear(pages: readonly PdfPageText[]) {
  const text = pages.map((page) => page.text.slice(0, 20_000)).join("\n");
  const match = text.match(/(?:사업연도|회계연도)\s*[:：]\s*(20\d{2})/);
  return match ? Number(match[1]) : null;
}

function safeMetadataText(value: string, fallback: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : fallback;
}

function validTimestamp(value: string) {
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function setFieldValue(
  fields: QuoteExtractionFields,
  field: NormalizedAuditQuoteField,
  value: QuoteExtractionFields[NormalizedAuditQuoteField],
) {
  (fields as Record<NormalizedAuditQuoteField, unknown>)[field] = value;
}

function toEvidenceValue(value: unknown): QuoteEvidenceValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toEvidenceValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toEvidenceValue(item),
      ]),
    );
  }
  return null;
}

function pdfWarningMessage(code: string) {
  if (code === "SCANNED_PDF_NO_EMBEDDED_TEXT") {
    return "PDF에 내장 텍스트가 없어 스캔 문서로 분류했습니다.";
  }
  if (code === "PDF_PAGE_LIMIT_REACHED") {
    return "PDF 페이지 안전 한도까지만 읽었습니다.";
  }
  return "PDF 텍스트 안전 한도에 도달하여 일부만 읽었습니다.";
}

function attachWarningsToEvidence(quote: NormalizedAuditQuote) {
  for (const warning of quote.warnings) {
    if (!warning.field) continue;
    for (const evidence of quote.evidenceByField[warning.field] ?? []) {
      if (!evidence.validationWarnings.includes(warning.message)) {
        evidence.validationWarnings.push(warning.message.slice(0, 500));
      }
    }
  }
}

function deduplicateWarnings(warnings: readonly QuoteWarning[]) {
  return [...new Map(
    warnings.map((warning) => [
      `${warning.code}|${warning.field ?? ""}|${warning.message}`,
      warning,
    ]),
  ).values()];
}
