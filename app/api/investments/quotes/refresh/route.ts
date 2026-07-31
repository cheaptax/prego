import { NextResponse } from "next/server";
import { authErrorCode, authErrorStatus, requireActiveMember } from "@/lib/firebase/server";
import { fetchKisQuote } from "@/lib/investments/kis-provider";
import { isStockPortfolioEnabled, listTransactions, loadPortfolio, marketDataProviderStatus, saveQuote } from "@/lib/investments/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isStockPortfolioEnabled()) return NextResponse.json({ ok: false, error: "stock_portfolio_disabled" }, { status: 404 });
  let user;
  try { ({ profile: user } = await requireActiveMember(req)); }
  catch (error) { return NextResponse.json({ ok: false, error: authErrorCode(error) }, { status: authErrorStatus(error) }); }
  if (!marketDataProviderStatus().configured) return NextResponse.json({ ok: false, error: "kis_not_configured" }, { status: 503 });

  const transactions = await listTransactions(user.uid);
  const symbols = [...new Set(transactions.map((item) => item.symbol))];
  const errors: Array<{ symbol: string; error: string }> = [];
  for (const symbol of symbols) {
    try { await saveQuote(await fetchKisQuote(symbol)); }
    catch (error) { errors.push({ symbol, error: error instanceof Error ? error.message : "quote_refresh_failed" }); }
  }
  const snapshot = await loadPortfolio(user.uid);
  return NextResponse.json({ ok: errors.length === 0, partial: errors.length > 0 && errors.length < symbols.length, errors, snapshot, provider: marketDataProviderStatus() }, { status: errors.length === symbols.length && symbols.length > 0 ? 502 : 200 });
}