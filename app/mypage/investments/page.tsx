import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StockPortfolioDashboard } from "@/components/investments/StockPortfolioDashboard";
import { requirePortalPageSession } from "@/lib/auth/portal-page-guard";
import { isStockPortfolioEnabled } from "@/lib/investments/server";

export const metadata: Metadata = {
  title: "주식평가 | Prego AI",
  description: "평균법 손익, 현재 비중, 증권사간 이체와 전고점 대비 손익 관리",
};

export default async function InvestmentsPage() {
  if (!isStockPortfolioEnabled()) notFound();
  await requirePortalPageSession("customer");
  return (
    <main id="main" className="admin-app">
      <StockPortfolioDashboard />
    </main>
  );
}