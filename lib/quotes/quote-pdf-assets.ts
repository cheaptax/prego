const MAX_SOURCE_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_READY_IMAGE_BYTES = 180_000;
const MAX_PDF_IMAGE_EDGE = 360;
const IMAGE_RESIZE_TIMEOUT_MS = 2_500;

export type RasterImageMime = "image/png" | "image/jpeg" | "image/webp";

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("quote_image_timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function sniffRasterImageMime(buffer: Buffer): RasterImageMime | null {
  if (buffer.length < 12) return null;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function parseQuoteImageDataUri(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/iu.exec(
    trimmed,
  );
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_SOURCE_IMAGE_BYTES) return null;
  const mime = sniffRasterImageMime(buffer);
  if (!mime) return null;
  return { buffer, mime, dataUri: `data:${mime};base64,${buffer.toString("base64")}` };
}

export function usableQuoteImageDataUri(value?: string) {
  const parsed = parseQuoteImageDataUri(value);
  if (!parsed) return undefined;
  if (parsed.buffer.length > MAX_READY_IMAGE_BYTES) return undefined;
  return parsed.dataUri;
}

async function downscaleQuoteImage(buffer: Buffer) {
  const canvas = await import("@napi-rs/canvas");
  const image = await withTimeout(canvas.loadImage(buffer), IMAGE_RESIZE_TIMEOUT_MS);
  const scale = Math.min(
    1,
    MAX_PDF_IMAGE_EDGE / Math.max(image.width, image.height, 1),
  );
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const surface = canvas.createCanvas(width, height);
  const context = surface.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  return surface.toBuffer("image/png");
}

export async function prepareQuoteImageDataUri(value?: string) {
  const parsed = parseQuoteImageDataUri(value);
  if (!parsed) return undefined;
  if (parsed.buffer.length <= MAX_READY_IMAGE_BYTES) return parsed.dataUri;
  try {
    const resized = await downscaleQuoteImage(parsed.buffer);
    if (
      sniffRasterImageMime(resized) &&
      resized.length <= MAX_READY_IMAGE_BYTES * 2
    ) {
      return `data:image/png;base64,${resized.toString("base64")}`;
    }
  } catch (error) {
    console.warn("quote-image-prepare-failed", error);
  }
  return parsed.dataUri;
}
