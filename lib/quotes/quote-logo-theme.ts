import { parseQuoteImageDataUri } from "@/lib/quotes/quote-pdf-assets";
import {
  DEFAULT_QUOTE_SCREEN_THEME,
  type QuoteScreenLayoutFamily,
  type QuoteScreenTheme,
} from "@/lib/quotes/quote-screen-profile";

const MAX_LOGO_THEME_BYTES = 800_000;
const LOGO_THEME_TIMEOUT_MS = 2_500;

type CanvasApi = {
  createCanvas: (typeof import("@napi-rs/canvas"))["createCanvas"];
  loadImage: (typeof import("@napi-rs/canvas"))["loadImage"];
};

async function loadCanvasApi(): Promise<CanvasApi | null> {
  try {
    const canvas = await import("@napi-rs/canvas");
    return {
      createCanvas: canvas.createCanvas,
      loadImage: canvas.loadImage,
    };
  } catch (error) {
    console.warn("quote-logo-theme-canvas-unavailable", error);
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("logo_theme_timeout")), ms);
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

const DEFAULT_LAYOUT_THEMES: Record<QuoteScreenLayoutFamily, QuoteScreenTheme> = {
  classicNavy: DEFAULT_QUOTE_SCREEN_THEME,
  formalCentered: {
    ...DEFAULT_QUOTE_SCREEN_THEME,
    primary: "#2f3a8f",
    accent: "#9a3412",
    subtle: "#eef2ff",
  },
  compactLedger: {
    ...DEFAULT_QUOTE_SCREEN_THEME,
    primary: "#334155",
    accent: "#0f766e",
    subtle: "#f1f5f9",
    spacing: "compact",
  },
  letterheadLeft: {
    ...DEFAULT_QUOTE_SCREEN_THEME,
    primary: "#14532d",
    accent: "#b45309",
    subtle: "#ecfdf5",
  },
  evaluationFirst: {
    ...DEFAULT_QUOTE_SCREEN_THEME,
    primary: "#4c1d95",
    accent: "#be123c",
    subtle: "#f5f3ff",
    titleAlignment: "center",
  },
};

type Rgb = { r: number; g: number; b: number };

function clamp(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hex({ r, g, b }: Rgb) {
  return `#${[r, g, b]
    .map((value) => clamp(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseHex(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/iu.exec(value.trim());
  if (!match) return null;
  const raw = match[1];
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function mix(left: Rgb, right: Rgb, amount: number) {
  return {
    r: left.r * (1 - amount) + right.r * amount,
    g: left.g * (1 - amount) + right.g * amount,
    b: left.b * (1 - amount) + right.b * amount,
  };
}

function luminance({ r, g, b }: Rgb) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function saturation({ r, g, b }: Rgb) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function readablePrimary(color: Rgb) {
  const lum = luminance(color);
  if (lum < 0.16) return mix(color, { r: 255, g: 255, b: 255 }, 0.18);
  if (lum > 0.68) return mix(color, { r: 0, g: 0, b: 0 }, 0.5);
  return color;
}

function accentFromPrimary(primary: Rgb) {
  const boosted = {
    r: primary.g * 0.35 + primary.b * 0.65,
    g: primary.b * 0.35 + primary.r * 0.65,
    b: primary.r * 0.35 + primary.g * 0.65,
  };
  return readablePrimary(boosted);
}

function defaultThemeFor(layoutFamily: QuoteScreenLayoutFamily | undefined) {
  return DEFAULT_LAYOUT_THEMES[layoutFamily ?? "classicNavy"];
}

function isDefaultColorTheme(theme: QuoteScreenTheme | undefined) {
  if (!theme) return true;
  return (
    theme.primary === DEFAULT_QUOTE_SCREEN_THEME.primary &&
    theme.accent === DEFAULT_QUOTE_SCREEN_THEME.accent &&
    theme.ink === DEFAULT_QUOTE_SCREEN_THEME.ink &&
    theme.muted === DEFAULT_QUOTE_SCREEN_THEME.muted &&
    theme.surface === DEFAULT_QUOTE_SCREEN_THEME.surface &&
    theme.subtle === DEFAULT_QUOTE_SCREEN_THEME.subtle
  );
}

function imageBufferFromDataUri(dataUri: string | undefined) {
  const parsed = parseQuoteImageDataUri(dataUri);
  if (!parsed || parsed.buffer.length > MAX_LOGO_THEME_BYTES) return null;
  return parsed.buffer;
}

async function extractLogoPrimary(logoDataUri: string | undefined) {
  const buffer = imageBufferFromDataUri(logoDataUri);
  if (!buffer || buffer.length > MAX_LOGO_THEME_BYTES) return null;
  try {
    const canvasApi = await loadCanvasApi();
    if (!canvasApi) return null;
    const image = await withTimeout(canvasApi.loadImage(buffer), LOGO_THEME_TIMEOUT_MS);
    const width = Math.min(96, Math.max(1, image.width));
    const height = Math.min(96, Math.max(1, image.height));
    const canvas = canvasApi.createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const buckets = new Map<string, { color: Rgb; score: number }>();
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3];
      if (alpha < 150) continue;
      const color = {
        r: data[index],
        g: data[index + 1],
        b: data[index + 2],
      };
      const lum = luminance(color);
      const sat = saturation(color);
      if (lum < 0.08 || lum > 0.92 || sat < 0.16) continue;
      const key = [
        Math.round(color.r / 32),
        Math.round(color.g / 32),
        Math.round(color.b / 32),
      ].join(":");
      const existing = buckets.get(key);
      const score = (sat * 2 + Math.abs(0.48 - lum)) * (alpha / 255);
      buckets.set(key, {
        color: existing?.color ?? color,
        score: (existing?.score ?? 0) + score,
      });
    }
    return [...buckets.values()].sort((left, right) => right.score - left.score)[0]
      ?.color ?? null;
  } catch {
    return null;
  }
}

export async function resolveQuoteLogoTheme(input: {
  theme?: QuoteScreenTheme;
  layoutFamily?: QuoteScreenLayoutFamily;
  logoDataUri?: string;
}) {
  const fallback = {
    ...defaultThemeFor(input.layoutFamily),
    ...(input.theme ?? {}),
  };
  try {
    if (!isDefaultColorTheme(input.theme)) return fallback;
    const extracted = await extractLogoPrimary(input.logoDataUri);
    if (!extracted) return fallback;
    const primary = readablePrimary(extracted);
    const accent = accentFromPrimary(primary);
    const subtle = mix(primary, { r: 255, g: 255, b: 255 }, 0.9);
    return {
      ...fallback,
      primary: hex(primary),
      accent: hex(accent),
      subtle: hex(subtle),
      ink: "#172033",
      muted: "#5b6472",
      surface: "#ffffff",
    };
  } catch (error) {
    console.warn("quote-logo-theme-resolve-failed", error);
    return fallback;
  }
}

