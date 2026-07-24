import type {
  DeepReadonly,
  EvaluationConfig,
  EvaluationConfigSnapshot,
  NormalizedAuditQuote,
  QuoteDataSnapshot,
} from "@/lib/audit-evaluation/types";

function immutableClone<T>(value: T): DeepReadonly<T> {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => immutableClone(item)),
    ) as DeepReadonly<T>;
  }

  if (value !== null && typeof value === "object") {
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        immutableClone(item),
      ]),
    );
    return Object.freeze(clone) as DeepReadonly<T>;
  }

  return value as DeepReadonly<T>;
}

export function createEvaluationConfigSnapshot(
  config: EvaluationConfig,
): EvaluationConfigSnapshot {
  return immutableClone(config);
}

export function createQuoteDataSnapshots(
  quotes: readonly NormalizedAuditQuote[],
): readonly QuoteDataSnapshot[] {
  return immutableClone(quotes);
}
