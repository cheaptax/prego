import type { WonAmount } from "@/lib/audit-evaluation/types";

const CANONICAL_WON = /^(0|[1-9][0-9]*)$/;
const MAX_WON_DIGITS = 30;

export class InvalidWonAmountError extends Error {
  readonly code = "invalid_won_amount";

  constructor() {
    super("Won amounts must be non-negative canonical integer strings.");
    this.name = "InvalidWonAmountError";
  }
}

export function isWonAmount(value: unknown): value is WonAmount {
  return (
    typeof value === "string" &&
    value.length <= MAX_WON_DIGITS &&
    CANONICAL_WON.test(value)
  );
}

export function normalizeWonAmount(
  value: string | number | bigint,
): WonAmount {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new InvalidWonAmountError();
    }
    return String(value) as WonAmount;
  }

  if (typeof value === "bigint") {
    if (value < 0n) throw new InvalidWonAmountError();
    const normalized = value.toString();
    if (!isWonAmount(normalized)) throw new InvalidWonAmountError();
    return normalized;
  }

  if (!isWonAmount(value)) throw new InvalidWonAmountError();
  return value;
}

export function compareWonAmounts(left: WonAmount, right: WonAmount) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

export function addWonAmounts(values: readonly WonAmount[]): WonAmount {
  return normalizeWonAmount(
    values.reduce((total, value) => total + BigInt(value), 0n),
  );
}
