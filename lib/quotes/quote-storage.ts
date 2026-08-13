import { adminStorage } from "@/lib/firebase/admin";
import { buildAttachmentContentDisposition } from "@/lib/quotes/quote-pdf-filename";

export async function saveQuotePdf(input: {
  quoteId: string;
  version: number;
  buffer: Buffer;
  storageKey?: string;
}) {
  const storageKey = String(input.storageKey ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 64);
  const path = `quotes/${input.quoteId}/v${input.version}/quote${storageKey ? `-${storageKey}` : ""}.pdf`;
  await adminStorage().bucket().file(path).save(input.buffer, {
    metadata: {
      contentType: "application/pdf",
      cacheControl: "private, no-store",
      metadata: {
        quoteId: input.quoteId,
        version: String(input.version),
      },
    },
  });
  return path;
}

export async function deleteQuotePdf(storagePath: string) {
  await adminStorage()
    .bucket()
    .file(storagePath)
    .delete({ ignoreNotFound: true });
}

export async function readQuotePdfBuffer(storagePath: string | undefined) {
  if (!storagePath) return null;
  const file = adminStorage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buffer] = await file.download();
  return buffer;
}

export async function readStorageFileAsDataUri(
  storagePath: string | undefined,
) {
  if (!storagePath) return undefined;
  const file = adminStorage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return undefined;
  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();
  const contentType = metadata.contentType || "image/png";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function createQuoteDownloadUrl(input: {
  storagePath: string;
  fileName: string;
  expiresAt: Date;
}) {
  const [url] = await adminStorage()
    .bucket()
    .file(input.storagePath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: input.expiresAt,
      responseDisposition: buildAttachmentContentDisposition(input.fileName),
      responseType: "application/pdf",
    });
  return url;
}
