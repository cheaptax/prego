import { adminStorage } from "@/lib/firebase/admin";

export type AuditEvaluationStoredUpload = {
  exists: boolean;
  size: number;
  mimeType: string;
  bytes: Uint8Array;
};

export interface AuditEvaluationUploadStorage {
  createUploadUrl(input: {
    storagePath: string;
    mimeType: string;
    expiresAt: string;
  }): Promise<string>;
  read(
    storagePath: string,
    maximumBytes: number,
  ): Promise<AuditEvaluationStoredUpload>;
  promote(input: {
    sourcePath: string;
    destinationPath: string;
    caseId: string;
    documentId: string;
    mimeType: string;
  }): Promise<void>;
  delete(storagePath: string): Promise<void>;
  createDownloadUrl(
    storagePath: string,
    expiresAt: string,
  ): Promise<string>;
}

export class FirebaseAuditEvaluationUploadStorage
  implements AuditEvaluationUploadStorage
{
  async createUploadUrl(input: {
    storagePath: string;
    mimeType: string;
    expiresAt: string;
  }) {
    const [url] = await adminStorage()
      .bucket()
      .file(input.storagePath)
      .getSignedUrl({
        version: "v4",
        action: "write",
        expires: new Date(input.expiresAt),
        contentType: input.mimeType,
      });
    return url;
  }

  async read(
    storagePath: string,
    maximumBytes: number,
  ): Promise<AuditEvaluationStoredUpload> {
    const file = adminStorage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      return { exists: false, size: 0, mimeType: "", bytes: new Uint8Array() };
    }
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    if (!Number.isFinite(size) || size <= 0 || size > maximumBytes) {
      return {
        exists: true,
        size,
        mimeType: metadata.contentType ?? "",
        bytes: new Uint8Array(),
      };
    }
    const [bytes] = await file.download();
    return {
      exists: true,
      size,
      mimeType: metadata.contentType ?? "",
      bytes,
    };
  }

  async promote(input: {
    sourcePath: string;
    destinationPath: string;
    caseId: string;
    documentId: string;
    mimeType: string;
  }) {
    const bucket = adminStorage().bucket();
    const destination = bucket.file(input.destinationPath);
    await bucket.file(input.sourcePath).copy(destination);
    await destination.setMetadata({
      contentType: input.mimeType,
      cacheControl: "private, no-store",
      metadata: {
        auditEvaluationCaseId: input.caseId,
        auditEvaluationDocumentId: input.documentId,
        classification: "audit-evaluation-original",
      },
    });
  }

  async delete(storagePath: string) {
    await adminStorage()
      .bucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });
  }

  async createDownloadUrl(storagePath: string, expiresAt: string) {
    const [url] = await adminStorage()
      .bucket()
      .file(storagePath)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: new Date(expiresAt),
        responseDisposition: "attachment",
      });
    return url;
  }
}
