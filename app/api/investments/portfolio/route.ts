import { NextResponse } from "next/server";
import { authErrorCode, authErrorStatus, requireActiveMember } from "@/lib/firebase/server";
import { createTransaction, isStockPortfolioEnabled, loadPortfolio, marketDataProviderStatus, parseTransactionInput } from "@/lib/investments/server";

export const runtime = "nodejs";

async function member(req: Request) {
  try { return (await requireActiveMember(req)).profile; }
  catch (error) { throw NextResponse.json({ ok: false, error: authErrorCode(error) }, { status: authErrorStatus(error) }); }
}

export async function GET(req: Request) {
  if (!isStockPortfolioEnabled()) return NextResponse.json({ ok: false, error: "stock_portfolio_disabled" }, { status: 404 });
  try {
    const user = await member(req);
    return NextResponse.json({ ok: true, snapshot: await loadPortfolio(user.uid), provider: marketDataProviderStatus() });
  } catch (error) {
    if (error instanceof NextResponse) return error;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "portfolio_load_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!isStockPortfolioEnabled()) return NextResponse.json({ ok: false, error: "stock_portfolio_disabled" }, { status: 404 });
  try {
    const user = await member(req);
    const input = parseTransactionInput(await req.json());
    await createTransaction(user.uid, input);
    return NextResponse.json({ ok: true, snapshot: await loadPortfolio(user.uid), provider: marketDataProviderStatus() }, { status: 201 });
  } catch (error) {
    if (error instanceof NextResponse) return error;
    const invalid = error && typeof error === "object" && "issues" in error;
    return NextResponse.json({ ok: false, error: invalid ? "invalid_transaction" : error instanceof Error ? error.message : "portfolio_save_failed" }, { status: invalid ? 400 : 500 });
  }
}