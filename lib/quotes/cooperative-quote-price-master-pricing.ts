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

/** 비선정1 = 110%, 비선정2 = 115% (첨부 마스터 공식과 동일) */
export const NON_SELECTED_FEE_BPS = [11_000n, 11_500n] as const;

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
