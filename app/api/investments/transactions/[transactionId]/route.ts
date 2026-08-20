import { NextResponse } from "next/server";
import { authErrorCode, authErrorStatus, requireActiveMember } from "@/lib/firebase/server";
import { deleteTransaction, isStockPortfolioEnabled, loadPortfolio } from "@/lib/investments/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ transactionId: string }> };

export async function DELETE(req: Request, context: Context) {
  if (!isStockPortfolioEnabled()) return NextResponse.json({ ok: false, error: "stock_portfolio_disabled" }, { status: 404 });
  let user;
  try { ({ profile: user } = await requireActiveMember(req)); }
  catch (error) { return NextResponse.json({ ok: false, error: authErrorCode(error) }, { status: authErrorStatus(error) }); }
  const { transactionId } = await context.params;
  const deleted = await deleteTransaction(user.uid, transactionId);
  if (!deleted) return NextResponse.json({ ok: false, error: "transaction_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, snapshot: await loadPortfolio(user.uid) });
}