import assert from "node:assert/strict";
import test from "node:test";
import { buildPortfolioSnapshot } from "../engine";
import type { MarketQuoteRecord, StockTransactionRecord } from "../types";

const base = {
  uid: "user-1",
  symbol: "005930",
  name: "삼성전자",
  tax: 0,
  note: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function transaction(input: Partial<StockTransactionRecord> & Pick<StockTransactionRecord, "id" | "type" | "tradeDate" | "quantity" | "unitPrice" | "fee" | "broker">): StockTransactionRecord {
  return { ...base, ...input };
}

const quote: MarketQuoteRecord = {
  symbol: "005930",
  currentPrice: 70000,
  peakPrice: 90000,
  peakDate: "2021-01-11",
  adjusted: true,
  provider: "kis",
  asOf: "2026-07-31T00:00:00.000Z",
};

test("매수 수수료를 평균단가에 포함한다", () => {
  const snapshot = buildPortfolioSnapshot([
    transaction({ id: "buy", type: "BUY", tradeDate: "2026-01-01", quantity: 10, unitPrice: 50000, fee: 1000, broker: "A증권" }),
  ], new Map([[quote.symbol, quote]]));
  assert.equal(snapshot.positions[0].costBasis, 501000);
  assert.equal(snapshot.positions[0].averageCost, 50100);
  assert.equal(snapshot.positions[0].weight, 1);
});

test("매도 후 평균단가는 유지되고 실현손익이 계산된다", () => {
  const snapshot = buildPortfolioSnapshot([
    transaction({ id: "buy", type: "BUY", tradeDate: "2026-01-01", quantity: 10, unitPrice: 50000, fee: 0, broker: "A증권" }),
    transaction({ id: "sell", type: "SELL", tradeDate: "2026-02-01", quantity: 4, unitPrice: 60000, fee: 1000, broker: "A증권" }),
  ], new Map([[quote.symbol, quote]]));
  assert.equal(snapshot.positions[0].quantity, 6);
  assert.equal(snapshot.positions[0].averageCost, 50000);
  assert.equal(snapshot.positions[0].realizedPnl, 39000);
});

test("증권사간 이체는 전체 수량과 원가를 변경하지 않는다", () => {
  const snapshot = buildPortfolioSnapshot([
    transaction({ id: "buy", type: "BUY", tradeDate: "2026-01-01", quantity: 10, unitPrice: 50000, fee: 0, broker: "A증권" }),
    transaction({ id: "transfer", type: "TRANSFER", tradeDate: "2026-02-01", quantity: 4, unitPrice: 0, fee: 0, broker: "A증권", destinationBroker: "B증권" }),
  ], new Map([[quote.symbol, quote]]));
  assert.equal(snapshot.positions[0].quantity, 10);
  assert.equal(snapshot.positions[0].costBasis, 500000);
  assert.deepEqual(snapshot.positions[0].brokers, [
    { broker: "A증권", quantity: 6 },
    { broker: "B증권", quantity: 4 },
  ]);
});
