import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { withoutUndefined } from "@/lib/firebase/clean";
import type { PartnerRecord } from "@/lib/firebase/schema";

export const PARTNER_ASSET_MAX_BYTES = 2 * 1024 * 1024;
export const PARTNER_ASSET_TYPES = new Set(["image/png", "image/jpeg"]);

export type PartnerAssetKind = "logo" | "seal";

export function partnerAssetStoragePath(
  partnerId: string,
  kind: PartnerAssetKind,
  contentType: string,
) {
  const extension = contentType === "image/png" ? "png" : "jpg";
  return `partner-assets/${partnerId}/${kind}.${extension}`;
}

export function parsePartnerAssetFile(
  file: unknown,
  kind: PartnerAssetKind,
):
  | { ok: true; file: File }
  | { ok: false; error: `missing_${PartnerAssetKind}` | `invalid_${PartnerAssetKind}` } {
  if (!(file instanceof File)) {
    return { ok: false, error: `missing_${kind}` };
  }
  if (
    !PARTNER_ASSET_TYPES.has(file.type) ||
    file.size <= 0 ||
    file.size > PARTNER_ASSET_MAX_BYTES
  ) {
    return { ok: false, error: `invalid_${kind}` };
  }
  return { ok: true, file };
}

export async function savePartnerAssetFile(input: {
  partnerId: string;
  kind: PartnerAssetKind;
  file: File;
  actor?: { uid?: string; email?: string };
}) {
  const path = partnerAssetStoragePath(
    input.partnerId,
    input.kind,
    input.file.type,
  );
  await adminStorage()
    .bucket()
    .file(path)
    .save(Buffer.from(await input.file.arrayBuffer()), {
      metadata: {
        contentType: input.file.type,
        cacheControl: "private, no-store",
      },
    });
  const now = new Date().toISOString();
  const patch =
    input.kind === "logo"
      ? {
          logoPath: path,
          logoContentType: input.file.type,
          logoUpdatedAt: now,
          updatedAt: now,
          updatedBy: input.actor?.uid,
          updatedByEmail: input.actor?.email,
        }
      : {
          sealPath: path,
          sealContentType: input.file.type,
          sealUpdatedAt: now,
          updatedAt: now,
          updatedBy: input.actor?.uid,
          updatedByEmail: input.actor?.email,
        };
  await adminDb()
    .collection("partners")
    .doc(input.partnerId)
    .set(withoutUndefined(patch satisfies Partial<PartnerRecord>), {
      merge: true,
    });
  return {
    path,
    contentType: input.file.type,
    updatedAt: now,
  };
}

export async function readPartnerAssetFile(
  partner: PartnerRecord,
  kind: PartnerAssetKind,
) {
  const path = kind === "logo" ? partner.logoPath : partner.sealPath;
  const contentType =
    (kind === "logo" ? partner.logoContentType : partner.sealContentType) ||
    "image/png";
  if (!path) {
    return { ok: false as const, error: `${kind}_not_found` as const };
  }
  try {
    const [buffer] = await adminStorage().bucket().file(path).download();
    return { ok: true as const, buffer, contentType, path };
  } catch {
    return { ok: false as const, error: `${kind}_unavailable` as const };
  }
}
