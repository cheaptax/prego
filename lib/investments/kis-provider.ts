import "server-only";
import type { MarketQuoteRecord } from "./types";

const BASE_URL = "https://openapi.koreainvestment.com:9443";
let tokenCache: { token: string; expiresAt: number } | null = null;

type KisRow = { stck_bsop_date?: string; stck_hgpr?: string };
type KisResponse = { rt_cd?: string; msg1?: string; output?: Record<string, string>; output2?: KisRow[] };

function credentials() {
  const appkey = process.env.KIS_APP_KEY?.trim();
  const appsecret = process.env.KIS_APP_SECRET?.trim();
  if (!appkey || !appsecret) throw new Error("kis_not_configured");
  return { appkey, appsecret };
}

async function accessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const { appkey, appsecret } = credentials();
  const response = await fetch(`${BASE_URL}/oauth2/tokenP`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey, appsecret }),
    cache: "no-store",
  });
  const data = (await response.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? "kis_token_failed");
  tokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(300, data.expires_in ?? 86400) * 1000 };
  return tokenCache.token;
}

async function request(path: string, trId: string, params: Record<string, string>) {
  const { appkey, appsecret } = credentials();
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${await accessToken()}`, appkey, appsecret, tr_id: trId, "content-type": "application/json; charset=utf-8" },
    cache: "no-store",
  });
  const data = (await response.json()) as KisResponse;
  if (!response.ok || data.rt_cd !== "0") throw new Error(data.msg1 ?? "kis_request_failed");
  return data;
}

function compactDate(value: Date) {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

async function chart(symbol: string, start: string, end: string, period: "D" | "Y") {
  const data = await request("/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice", "FHKST03010100", {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: symbol,
    FID_INPUT_DATE_1: start,
    FID_INPUT_DATE_2: end,
    FID_PERIOD_DIV_CODE: period,
    FID_ORG_ADJ_PRC: "0",
  });
  return data.output2 ?? [];
}

export async function fetchKisQuote(symbol: string): Promise<MarketQuoteRecord> {
  const priceData = await request("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_INPUT_ISCD: symbol,
  });
  const currentPrice = Number(priceData.output?.stck_prpr ?? 0);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) throw new Error("kis_invalid_current_price");

  const now = new Date();
  const end = compactDate(now);
  const annual = await chart(symbol, "19800101", end, "Y");
  const annualPeak = annual.reduce<KisRow | null>((best, row) => Number(row.stck_hgpr ?? 0) > Number(best?.stck_hgpr ?? 0) ? row : best, null);
  let peakRows = annual;
  if (annualPeak?.stck_bsop_date?.length === 8) {
    const year = annualPeak.stck_bsop_date.slice(0, 4);
    peakRows = await chart(symbol, `${year}0101`, `${year}1231`, "D");
  }
  const peak = peakRows.reduce<KisRow | null>((best, row) => Number(row.stck_hgpr ?? 0) > Number(best?.stck_hgpr ?? 0) ? row : best, null);
  const peakPrice = Number(peak?.stck_hgpr ?? 0);
  const peakDate = peak?.stck_bsop_date;
  return {
    symbol,
    currentPrice,
    peakPrice: peakPrice > 0 ? peakPrice : null,
    peakDate: peakDate?.length === 8 ? `${peakDate.slice(0, 4)}-${peakDate.slice(4, 6)}-${peakDate.slice(6, 8)}` : null,
    adjusted: true,
    provider: "kis",
    asOf: new Date().toISOString(),
  };
}