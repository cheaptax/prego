import type { MarketQuoteRecord, PortfolioInsight, PortfolioIssue, PortfolioPosition, PortfolioSnapshot, StockTransactionRecord } from "./types";

const EPSILON = 0.00000001;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100000000) / 100000000;

type State = { name: string; quantity: number; costBasis: number; realizedPnl: number; brokers: Map<string, number> };

function addBroker(state: State, broker: string, quantity: number) {
  const next = round((state.brokers.get(broker) ?? 0) + quantity);
  if (Math.abs(next) < EPSILON) state.brokers.delete(broker);
  else state.brokers.set(broker, next);
}

export function buildPortfolioSnapshot(
  transactions: StockTransactionRecord[],
  quotes: Map<string, MarketQuoteRecord>,
): PortfolioSnapshot {
  const states = new Map<string, State>();
  const issues: PortfolioIssue[] = [];
  const sorted = [...transactions].sort((a, b) =>
    a.tradeDate.localeCompare(b.tradeDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  for (const tx of sorted) {
    const state = states.get(tx.symbol) ?? { name: tx.name, quantity: 0, costBasis: 0, realizedPnl: 0, brokers: new Map<string, number>() };
    state.name = tx.name || state.name;
    const fee = tx.fee ?? 0;
    const tax = tx.tax ?? 0;

    if (tx.type === "OPENING" || tx.type === "BUY") {
      state.quantity = round(state.quantity + tx.quantity);
      state.costBasis = round(state.costBasis + tx.quantity * tx.unitPrice + fee + tax);
      addBroker(state, tx.broker, tx.quantity);
    } else if (tx.type === "SELL") {
      const brokerQuantity = state.brokers.get(tx.broker) ?? 0;
      if (tx.quantity > state.quantity + EPSILON || tx.quantity > brokerQuantity + EPSILON) {
        issues.push({ transactionId: tx.id, message: `${tx.name} 매도수량이 보유수량 또는 해당 증권사 잔고를 초과합니다.` });
        continue;
      }
      const averageCost = state.quantity > EPSILON ? state.costBasis / state.quantity : 0;
      state.realizedPnl = round(state.realizedPnl + tx.quantity * tx.unitPrice - fee - tax - tx.quantity * averageCost);
      state.quantity = round(state.quantity - tx.quantity);
      state.costBasis = round(state.costBasis - tx.quantity * averageCost);
      addBroker(state, tx.broker, -tx.quantity);
      if (state.quantity < EPSILON) {
        state.quantity = 0;
        state.costBasis = 0;
        state.brokers.clear();
      }
    } else {
      const destination = tx.destinationBroker?.trim();
      const brokerQuantity = state.brokers.get(tx.broker) ?? 0;
      if (!destination || destination === tx.broker || tx.quantity > brokerQuantity + EPSILON) {
        issues.push({ transactionId: tx.id, message: `${tx.name} 증권사간 이체의 출고·입고 계좌 또는 수량을 확인하세요.` });
        continue;
      }
      addBroker(state, tx.broker, -tx.quantity);
      addBroker(state, destination, tx.quantity);
    }
    states.set(tx.symbol, state);
  }

  const active = [...states.entries()].filter(([, state]) => state.quantity > EPSILON);
  const allQuoted = active.every(([symbol]) => quotes.has(symbol));
  const totalMarketValue = allQuoted
    ? active.reduce((sum, [symbol, state]) => sum + state.quantity * (quotes.get(symbol)?.currentPrice ?? 0), 0)
    : null;

  const positions: PortfolioPosition[] = active.map(([symbol, state]) => {
    const quote = quotes.get(symbol);
    const averageCost = state.quantity ? state.costBasis / state.quantity : 0;
    const marketValue = quote ? state.quantity * quote.currentPrice : null;
    const peakMarketValue = quote?.peakPrice ? state.quantity * quote.peakPrice : null;
    return {
      symbol,
      name: state.name,
      quantity: round(state.quantity),
      averageCost: round(averageCost),
      costBasis: round(state.costBasis),
      realizedPnl: round(state.realizedPnl),
      brokers: [...state.brokers.entries()].map(([broker, quantity]) => ({ broker, quantity: round(quantity) })).sort((a, b) => a.broker.localeCompare(b.broker)),
      currentPrice: quote?.currentPrice ?? null,
      marketValue: marketValue === null ? null : round(marketValue),
      weight: marketValue !== null && totalMarketValue && totalMarketValue > 0 ? marketValue / totalMarketValue : null,
      unrealizedPnl: marketValue === null ? null : round(marketValue - state.costBasis),
      returnRate: marketValue === null || state.costBasis <= 0 ? null : (marketValue - state.costBasis) / state.costBasis,
      peakPrice: quote?.peakPrice ?? null,
      peakDate: quote?.peakDate ?? null,
      peakMarketValue: peakMarketValue === null ? null : round(peakMarketValue),
      peakPnl: peakMarketValue === null ? null : round(peakMarketValue - state.costBasis),
      drawdownFromPeak: quote?.peakPrice ? quote.currentPrice / quote.peakPrice - 1 : null,
    };
  }).sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));

  const totalCostBasis = positions.reduce((sum, item) => sum + item.costBasis, 0);
  const totalRealizedPnl = [...states.values()].reduce((sum, item) => sum + item.realizedPnl, 0);
  const totalUnrealizedPnl = totalMarketValue === null ? null : totalMarketValue - totalCostBasis;
  const insights: PortfolioInsight[] = [];
  const largest = positions.find((item) => item.weight !== null);
  if (largest?.weight && largest.weight >= 0.4) insights.push({ id: "concentration", tone: largest.weight >= 0.6 ? "danger" : "caution", title: "종목 집중도", message: `${largest.name} 비중이 ${(largest.weight * 100).toFixed(1)}%입니다. 단일 종목 위험한도를 다시 확인하세요.` });
  for (const item of positions) {
    if (item.drawdownFromPeak !== null && item.drawdownFromPeak <= -0.3) insights.push({ id: `drawdown-${item.symbol}`, tone: item.drawdownFromPeak <= -0.5 ? "danger" : "caution", title: `${item.name} 고점 대비 하락`, message: `수정주가 기준 역사적 고점 대비 ${(Math.abs(item.drawdownFromPeak) * 100).toFixed(1)}% 하락했습니다. 최초 매수·매도 원칙과 현재 보유 근거를 재검토하세요.` });
  }

  const quoteAsOf = positions.map((item) => quotes.get(item.symbol)?.asOf ?? "").filter(Boolean).sort().at(0) ?? null;
  return {
    transactions: [...transactions].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.createdAt.localeCompare(a.createdAt)),
    positions,
    summary: {
      totalCostBasis: round(totalCostBasis),
      totalMarketValue: totalMarketValue === null ? null : round(totalMarketValue),
      totalUnrealizedPnl: totalUnrealizedPnl === null ? null : round(totalUnrealizedPnl),
      totalReturnRate: totalUnrealizedPnl === null || totalCostBasis <= 0 ? null : totalUnrealizedPnl / totalCostBasis,
      totalRealizedPnl: round(totalRealizedPnl),
      quoteAsOf,
    },
    insights,
    issues,
  };
}