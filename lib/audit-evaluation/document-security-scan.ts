export type AuditEvaluationDocumentScanResult =
  | { status: "CLEAN"; scannerVersion: string; findings: string[] }
  | { status: "REJECTED"; scannerVersion: string; findings: string[] };

const STATIC_SCANNER_VERSION = "static-pdf-risk-scan-v1";

const DANGEROUS_PDF_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "EICAR_TEST_STRING", pattern: /EICAR-STANDARD-ANTIVIRUS-TEST-FILE/i },
  { code: "PDF_JAVASCRIPT", pattern: /\/(?:JavaScript|JS)\b/i },
  { code: "PDF_LAUNCH_ACTION", pattern: /\/Launch\b/i },
  { code: "PDF_OPEN_ACTION", pattern: /\/OpenAction\b/i },
  { code: "PDF_EMBEDDED_FILE", pattern: /\/EmbeddedFile\b/i },
];

export function scanAuditEvaluationPdf(
  bytes: Uint8Array,
): AuditEvaluationDocumentScanResult {
  const head = new TextDecoder("latin1").decode(
    bytes.slice(0, Math.min(bytes.byteLength, 1_024)),
  );
  const body = new TextDecoder("latin1").decode(
    bytes.slice(0, Math.min(bytes.byteLength, 2 * 1024 * 1024)),
  );
  const findings = DANGEROUS_PDF_PATTERNS
    .filter(({ pattern }) => pattern.test(body))
    .map(({ code }) => code);

  if (!head.startsWith("%PDF-")) findings.push("PDF_MAGIC_MISMATCH");
  const leadingBytes = head.slice(0, 32);
  if (leadingBytes.startsWith("MZ") || leadingBytes.startsWith("PK\u0003\u0004")) {
    findings.push("POLYGLOT_SIGNATURE");
  }

  return findings.length > 0
    ? { status: "REJECTED", scannerVersion: STATIC_SCANNER_VERSION, findings }
    : { status: "CLEAN", scannerVersion: STATIC_SCANNER_VERSION, findings };
}
