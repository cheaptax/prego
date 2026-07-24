export function embedAuditQuoteIdentityMarker(
  pdfBytes: Uint8Array,
  marker: string,
): Buffer {
  const pdf = Buffer.from(pdfBytes);
  const eofIndex = pdf.lastIndexOf("%%EOF");
  if (eofIndex < 0) throw new Error("pdf_eof_missing");
  if (
    !marker.startsWith("NHSC-QUOTE-IDENTITY:v1:") ||
    Buffer.byteLength(marker, "latin1") > 900
  ) {
    throw new Error("invalid_quote_identity_marker");
  }
  return Buffer.concat([
    pdf.subarray(0, eofIndex),
    Buffer.from(`%${marker}\n`, "latin1"),
    pdf.subarray(eofIndex),
  ]);
}
