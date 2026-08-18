import {
  HUNDRED_THOUSAND_WON,
  roundWonHalfUpToHundredThousand,
} from "@/lib/audit-evaluation/money";
import type { WonAmount } from "@/lib/audit-evaluation/types";

/** Match the uploaded 농협정보_마스터 시트9 pricing rules. */
export function roundWonToHundredThousand(value: bigint): WonAmount {
  if (value <= 0n) return "100000" as WonAmount;
  const rounded = roundWonHalfUpToHundredThousand(value);
  return String(
    rounded < HUNDRED_THOUSAND_WON ? HUNDRED_THOUSAND_WON : rounded,
  ) as WonAmount;
}

export function safeMinFromPlanned(planned: WonAmount): WonAmount {
  return roundWonToHundredThousand((BigInt(planned) * 90n) / 100n);
}

export function nonSelectedFeeFromPlanned(
  planned: WonAmount,
  multiplierBasisPoints: bigint,
): WonAmount {
  return roundWonToHundredThousand(
    (BigInt(planned) * multiplierBasisPoints) / 10_000n,
  );
}

/**
 * 비선정 감사보수 배율. 1번째=110%, 이후 +5%p (115%, 120%, 125%…).
 * 예전 마스터 시트는 비선정 2곳만 있었지만, 활성 제휴사 전원에 같은 규칙을 이어서 적용한다.
 */
export function nonSelectedFeeBps(index: number): bigint {
  return 11_000n + BigInt(Math.max(0, index)) * 500n;
}

/** @deprecated Prefer nonSelectedFeeBps(index). Kept for the first two slots. */
export const NON_SELECTED_FEE_BPS = [
  nonSelectedFeeBps(0),
  nonSelectedFeeBps(1),
] as const;

export type MasterPartnerRef = {
  id: string;
  name: string;
};

/** Keep preferred partners first, then remaining active partners by Korean name. */
export function orderNonSelectedPartners(
  remaining: readonly MasterPartnerRef[],
  preferredIds: readonly string[] = [],
): MasterPartnerRef[] {
  const byId = new Map(remaining.map((item) => [item.id, item]));
  const preferred = preferredIds.flatMap((id) => {
    const hit = byId.get(id);
    return hit ? [hit] : [];
  });
  const seen = new Set(preferred.map((item) => item.id));
  const extras = remaining
    .filter((item) => !seen.has(item.id))
    .sort((left, right) => left.name.localeCompare(right.name, "ko"));
  return [...preferred, ...extras];
}

export function nonSelectedMasterPriceFields(input: {
  plannedWinnerFeeWon: WonAmount;
  index: number;
}) {
  const fee = nonSelectedFeeFromPlanned(
    input.plannedWinnerFeeWon,
    nonSelectedFeeBps(input.index),
  );
  return {
    plannedAuditFeeWon: fee,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE" as const,
    expectedExpenseWon: "0" as WonAmount,
    safePriceMinWon: safeMinFromPlanned(fee),
    safePriceMaxWon: fee,
    isPlannedWinner: false,
    locked: false,
  };
}

export function pickRandomPartners<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const temp = pool[index];
    pool[index] = pool[swap];
    pool[swap] = temp;
  }
  return pool.slice(0, Math.max(0, count));
}

export function normalizePartnerMatchKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/gu, "")
    .replace(/(회계법인|세무법인|주식회사|\(주\)|㈜)/gu, "");
}
