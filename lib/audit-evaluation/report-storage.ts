import { adminStorage } from "@/lib/firebase/admin";
import { buildAttachmentContentDisposition } from "@/lib/quotes/quote-pdf-filename";

export interface AuditEvaluationReportStorage {
  save(input: {
    storagePath: string;
    bytes: Uint8Array;
    contentType: "application/pdf" | "application/json";
    caseId: string;
    reportVersion: number;
    classification: "report-pdf" | "report-view-model";
  }): Promise<void>;
  read(storagePath: string, maximumBytes: number): Promise<Uint8Array | null>;
  createDownloadUrl(input: {
    storagePath: string;
    expiresAt: string;
    fileName: string;
  }): Promise<string>;
}

const SAFE_REPORT_DOWNLOAD_FILENAME =
  /^(?:audit-evaluation-report-(?:(?:[\p{L}\p{N}][\p{L}\p{N}._-]{0,47}-)?FY[0-9]{4}|case-[a-zA-Z0-9][a-zA-Z0-9._-]{0,63})-v[0-9]+\.pdf|[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}_FY[0-9]{4} 감사인견적평가보고서(?:_v[1-9][0-9]*)?\.pdf)$/u;

export class FirebaseAuditEvaluationReportStorage
  implements AuditEvaluationReportStorage
{
  async save(input: {
    storagePath: string;
    bytes: Uint8Array;
    contentType: "application/pdf" | "application/json";
    caseId: string;
    reportVersion: number;
    classification: "report-pdf" | "report-view-model";
  }) {
    await adminStorage()
      .bucket()
      .file(input.storagePath)
      .save(Buffer.from(input.bytes), {
        resumable: false,
        validation: "crc32c",
        metadata: {
          contentType: input.contentType,
          cacheControl: "private, no-store",
          contentDisposition: "attachment",
          metadata: {
            auditEvaluationCaseId: input.caseId,
            auditEvaluationReportVersion: String(input.reportVersion),
            classification: input.classification,
          },
        },
      });
  }

  async read(storagePath: string, maximumBytes: number) {
    const file = adminStorage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > maximumBytes
    ) {
      return null;
    }
    const [bytes] = await file.download();
    return new Uint8Array(bytes);
  }

  async createDownloadUrl(input: {
    storagePath: string;
    expiresAt: string;
    fileName: string;
  }) {
    if (
      !SAFE_REPORT_DOWNLOAD_FILENAME.test(input.fileName) ||
      /[\r\n"\\/:]/u.test(input.fileName)
    ) {
      throw new Error("invalid_report_download_filename");
    }
    const [url] = await adminStorage()
      .bucket()
      .file(input.storagePath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: new Date(input.expiresAt),
        responseType: "application/pdf",
        responseDisposition: buildAttachmentContentDisposition(input.fileName),
      });
    return url;
  }
}
