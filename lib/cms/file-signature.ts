import type { CmsAllowedMimeType } from "@/lib/cms/constants";

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function matchesCmsFileSignature(
  bytes: Uint8Array,
  mimeType: CmsAllowedMimeType,
) {
  if (mimeType === "image/jpeg") {
    return startsWith(bytes, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/gif") {
    const header = new TextDecoder("ascii").decode(bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return (
      new TextDecoder("ascii").decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder("ascii").decode(bytes.slice(8, 12)) === "WEBP"
    );
  }
  return new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-";
}
