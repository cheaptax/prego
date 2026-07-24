import { parseEmbeddedQuoteDocumentIdentity } from "@/lib/audit-evaluation/standard-quote-identity";
import type {
  EvaluationConfig,
  QuoteDocumentIdentity,
} from "@/lib/audit-evaluation/types";

export const AUDIT_QUOTE_UPLOAD_MIME_TYPES = [
  "application/pdf",
] as const;
export const AUDIT_QUOTE_UPLOAD_EXTENSIONS = [".pdf"] as const;

export type AuditQuoteUploadValidationError =
  | "unsupported_file_type"
  | "empty_file"
  | "file_too_large"
  | "corrupt_pdf"
  | "encrypted_pdf";

export type AuditQuoteUploadPolicy = {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maximumFileSize: number;
  minimumQuoteCount: number;
  maximumQuoteCount: number;
};

export function createAuditQuoteUploadPolicy(
  config: EvaluationConfig,
): AuditQuoteUploadPolicy {
  const allowedMimeTypes = AUDIT_QUOTE_UPLOAD_MIME_TYPES.filter(
    (mimeType) => config.permittedMimeTypes.includes(mimeType),
  );
  return {
    allowedMimeTypes,
    allowedExtensions:
      allowedMimeTypes.length > 0
        ? [...AUDIT_QUOTE_UPLOAD_EXTENSIONS]
        : [],
    maximumFileSize: config.maximumFileSize,
    minimumQuoteCount: config.minimumQuoteCount,
    maximumQuoteCount: Math.min(
      config.maximumQuoteCount,
      config.uploadLimit,
    ),
  };
}

export function validateAuditQuoteUploadDescriptor(
  input: {
    fileName: string;
    mimeType: string;
    size: number;
  },
  policy: AuditQuoteUploadPolicy,
): AuditQuoteUploadValidationError | null {
  if (!Number.isInteger(input.size) || input.size <= 0) {
    return "empty_file";
  }
  if (input.size > policy.maximumFileSize) {
    return "file_too_large";
  }
  const extension = fileExtension(input.fileName);
  if (
    !policy.allowedMimeTypes.includes(input.mimeType) ||
    !policy.allowedExtensions.includes(extension)
  ) {
    return "unsupported_file_type";
  }
  return null;
}

export function inspectAuditQuotePdf(
  bytes: Uint8Array,
): {
  error: AuditQuoteUploadValidationError | null;
  embeddedIdentity: QuoteDocumentIdentity | null;
} {
  if (bytes.byteLength === 0) {
    return { error: "empty_file", embeddedIdentity: null };
  }
  const prefix = new TextDecoder("ascii").decode(bytes.slice(0, 8));
  if (!prefix.startsWith("%PDF-1.")) {
    return { error: "corrupt_pdf", embeddedIdentity: null };
  }
  const text = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt(?:\s|\/|>>|\[)/.test(text)) {
    return { error: "encrypted_pdf", embeddedIdentity: null };
  }
  const eofIndex = text.lastIndexOf("%%EOF");
  const startXrefIndex = text.lastIndexOf("startxref");
  if (
    eofIndex < 0 ||
    startXrefIndex < 0 ||
    startXrefIndex > eofIndex ||
    bytes.byteLength - eofIndex > 1_024
  ) {
    return { error: "corrupt_pdf", embeddedIdentity: null };
  }
  const offsetMatch = text
    .slice(startXrefIndex + "startxref".length, eofIndex)
    .match(/\s*(\d+)/);
  const xrefOffset = offsetMatch ? Number(offsetMatch[1]) : Number.NaN;
  if (
    !Number.isSafeInteger(xrefOffset) ||
    xrefOffset < 0 ||
    xrefOffset >= bytes.byteLength
  ) {
    return { error: "corrupt_pdf", embeddedIdentity: null };
  }
  const xrefTarget = text.slice(xrefOffset, xrefOffset + 64).trimStart();
  if (
    !xrefTarget.startsWith("xref") &&
    !/^\d+\s+\d+\s+obj\b/.test(xrefTarget)
  ) {
    return { error: "corrupt_pdf", embeddedIdentity: null };
  }
  return {
    error: null,
    embeddedIdentity: extractEmbeddedIdentity(text),
  };
}

export function safeAuditQuoteDisplayName(fileName: string) {
  const normalized = fileName
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .trim();
  return (normalized || "견적서.pdf").slice(0, 180);
}

export function fileExtension(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  const dot = normalized.lastIndexOf(".");
  return dot >= 0 ? normalized.slice(dot) : "";
}

function extractEmbeddedIdentity(text: string) {
  const marker = text.match(
    /NHSC-QUOTE-IDENTITY:v1:[A-Za-z0-9_-]{20,4000}/,
  )?.[0];
  return marker ? parseEmbeddedQuoteDocumentIdentity(marker) : null;
}
