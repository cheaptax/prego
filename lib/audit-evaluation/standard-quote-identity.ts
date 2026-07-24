import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  quoteDocumentIdentitySchema,
  trustedStandardQuotePayloadSchema,
} from "@/lib/audit-evaluation/quote-document-schemas";
import type {
  QuoteDocumentIdentity,
  TrustedStandardQuotePayload,
  VersionReference,
} from "@/lib/audit-evaluation/types";

type EnvMap = Record<string, string | undefined>;
type UnsignedQuoteDocumentIdentity = Omit<
  QuoteDocumentIdentity,
  "integrityToken"
>;

const EMBEDDED_IDENTITY_PREFIX = "NHSC-QUOTE-IDENTITY:v1:";

export class QuoteDocumentSigningConfigurationError extends Error {
  readonly code = "missing_quote_document_signing_secret";

  constructor() {
    super("A server-only quote document signing secret is required.");
    this.name = "QuoteDocumentSigningConfigurationError";
  }
}

export function getQuoteDocumentSigningSecret(
  env: EnvMap = process.env,
): string {
  const secret = env.AUDIT_EVALUATION_DOCUMENT_SIGNING_SECRET?.trim() ?? "";
  assertQuoteDocumentSigningSecret(secret);
  return secret;
}

export function assertQuoteDocumentSigningSecret(secret: string) {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new QuoteDocumentSigningConfigurationError();
  }
}

export function createQuoteDocumentId() {
  return `qd_${randomBytes(18).toString("base64url")}`;
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeQuotePayloadChecksum(
  payload: TrustedStandardQuotePayload,
) {
  const normalized = trustedStandardQuotePayloadSchema.parse(payload);
  return createHash("sha256")
    .update(stableSerialize(normalized), "utf8")
    .digest("hex");
}

export function createQuoteDocumentIdentity(
  input: {
    quoteDocumentId?: string;
    quoteRequestId: string;
    fiscalYear: number;
    templateVersion: VersionReference;
    normalizedPayload: TrustedStandardQuotePayload;
  },
  secret: string,
): QuoteDocumentIdentity {
  assertQuoteDocumentSigningSecret(secret);
  const unsigned: UnsignedQuoteDocumentIdentity = {
    signatureVersion: 1,
    quoteDocumentId: input.quoteDocumentId ?? createQuoteDocumentId(),
    quoteRequestId: input.quoteRequestId,
    fiscalYear: input.fiscalYear,
    templateVersion: input.templateVersion,
    payloadChecksum: computeQuotePayloadChecksum(input.normalizedPayload),
  };
  const identity = {
    ...unsigned,
    integrityToken: signQuoteDocumentIdentity(unsigned, secret),
  };
  return quoteDocumentIdentitySchema.parse(identity);
}

export function verifyQuoteDocumentIdentity(
  identity: QuoteDocumentIdentity,
  secret: string,
) {
  assertQuoteDocumentSigningSecret(secret);
  const parsed = quoteDocumentIdentitySchema.safeParse(identity);
  if (!parsed.success) return false;

  const { integrityToken, ...unsigned } = parsed.data;
  const expected = signQuoteDocumentIdentity(unsigned, secret);
  const actualBytes = Buffer.from(integrityToken, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function createQuoteVerificationCode(
  quoteDocumentId: string,
  secret: string,
) {
  assertQuoteDocumentSigningSecret(secret);
  const code = createHmac("sha256", secret)
    .update(`verification-code|${quoteDocumentId}`, "utf8")
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `NHAQ-${code.slice(0, 4)}-${code.slice(4)}`;
}

export function serializeEmbeddedQuoteDocumentIdentity(
  identity: QuoteDocumentIdentity,
) {
  const parsed = quoteDocumentIdentitySchema.parse(identity);
  return `${EMBEDDED_IDENTITY_PREFIX}${Buffer.from(
    stableSerialize(parsed),
    "utf8",
  ).toString("base64url")}`;
}

export function parseEmbeddedQuoteDocumentIdentity(
  marker: string,
): QuoteDocumentIdentity | null {
  const trimmed = marker.trim();
  if (
    !trimmed.startsWith(EMBEDDED_IDENTITY_PREFIX) ||
    trimmed.length > 4_096
  ) {
    return null;
  }
  try {
    const encoded = trimmed.slice(EMBEDDED_IDENTITY_PREFIX.length);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return quoteDocumentIdentitySchema.parse(JSON.parse(decoded));
  } catch {
    return null;
  }
}

export function buildQuoteDocumentVerificationDisplay(
  identity: QuoteDocumentIdentity,
  verificationCode: string,
) {
  const parsed = quoteDocumentIdentitySchema.parse(identity);
  return {
    confirmationNumber: parsed.quoteDocumentId,
    templateVersion: `${parsed.templateVersion.id} v${parsed.templateVersion.version}`,
    shortVerificationCode: verificationCode,
    qrPayload: `nhsc:quote:v1:${parsed.quoteDocumentId}:${parsed.integrityToken}`,
    embeddedIdentityMarker: serializeEmbeddedQuoteDocumentIdentity(parsed),
  };
}

function signQuoteDocumentIdentity(
  identity: UnsignedQuoteDocumentIdentity,
  secret: string,
) {
  return `v1.${createHmac("sha256", secret)
    .update(stableSerialize(identity), "utf8")
    .digest("base64url")}`;
}

function stableSerialize(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${stableSerialize(item)}`,
      )
      .join(",")}}`;
  }
  throw new Error("unsupported_canonical_value");
}
