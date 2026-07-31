export type StockTransactionType = "OPENING" | "BUY" | "SELL" | "TRANSFER";

export type StockTransactionInput = {
  type: StockTransactionType;
  tradeDate: string;
  symbol: string;
  name: string;
  quantity: number;
  unitPrice: number;
  fee?: number;
  tax?: number;
  broker: string;
  destinationBroker?: string;
  note?: string;
};

export type StockTransactionRecord = StockTransactionInput & {
  id: string;
  uid: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketQuoteRecord = {
  symbol: string;
  currentPrice: number;
  peakPrice: number | null;
  peakDate: string | null;
  adjusted: boolean;
  provider: "kis" | "manual";
  asOf: string;
};

export type BrokerPosition = {
  broker: string;
  quantity: number;
};

export type PortfolioPosition = {
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  costBasis: number;
  realizedPnl: number;
  brokers: BrokerPosition[];
  currentPrice: number | null;
  marketValue: number | null;
  weight: number | null;
  unrealizedPnl: number | null;
  returnRate: number | null;
  peakPrice: number | null;
  peakDate: string | null;
  peakMarketValue: number | null;
  peakPnl: number | null;
  drawdownFromPeak: number | null;
};

export type PortfolioInsight = {
  id: string;
  tone: "info" | "caution" | "danger";
  title: string;
  message: string;
};

export type PortfolioIssue = {
  transactionId: string;
  message: string;
};

export type PortfolioSnapshot = {
  transactions: StockTransactionRecord[];
  positions: PortfolioPosition[];
  summary: {
    totalCostBasis: number;
    totalMarketValue: number | null;
    totalUnrealizedPnl: number | null;
    totalReturnRate: number | null;
    totalRealizedPnl: number;
    quoteAsOf: string | null;
  };
  insights: PortfolioInsight[];
  issues: PortfolioIssue[];
};

export type MarketDataProviderStatus = {
  provider: "kis";
  configured: boolean;
};