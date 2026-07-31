import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { buildPortfolioSnapshot } from "./engine";
import type { MarketDataProviderStatus, MarketQuoteRecord, StockTransactionInput, StockTransactionRecord } from "./types";

const transactionSchema = z.object({
  type: z.enum(["OPENING", "BUY", "SELL", "TRANSFER"]),
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbol: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(80),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  fee: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  broker: z.string().trim().min(1).max(80),
  destinationBroker: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.type === "TRANSFER") {
    if (!value.destinationBroker || value.destinationBroker === value.broker) context.addIssue({ code: "custom", message: "invalid_transfer", path: ["destinationBroker"] });
    if (value.unitPrice !== 0 || value.fee !== 0 || value.tax !== 0) context.addIssue({ code: "custom", message: "transfer_must_not_change_value", path: ["unitPrice"] });
  } else if (value.unitPrice <= 0) context.addIssue({ code: "custom", message: "unit_price_required", path: ["unitPrice"] });
});

export function isStockPortfolioEnabled() {
  return process.env.STOCK_PORTFOLIO_ENABLED === "true";
}

export function marketDataProviderStatus(): MarketDataProviderStatus {
  return { provider: "kis", configured: Boolean(process.env.KIS_APP_KEY?.trim() && process.env.KIS_APP_SECRET?.trim()) };
}

export function parseTransactionInput(input: unknown): StockTransactionInput {
  return transactionSchema.parse(input);
}

function transactionCollection(uid: string) {
  return adminDb().collection("users").doc(uid).collection("stockTransactions");
}

export async function listTransactions(uid: string) {
  const snapshot = await transactionCollection(uid).get();
  return snapshot.docs.map((doc) => doc.data() as StockTransactionRecord);
}

export async function createTransaction(uid: string, input: StockTransactionInput) {
  const now = new Date().toISOString();
  const record: StockTransactionRecord = { ...input, fee: input.fee ?? 0, tax: input.tax ?? 0, id: randomUUID(), uid, createdAt: now, updatedAt: now };
  await transactionCollection(uid).doc(record.id).set(record);
  return record;
}

export async function deleteTransaction(uid: string, transactionId: string) {
  const ref = transactionCollection(uid).doc(transactionId);
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

export async function listQuotes(symbols: string[]) {
  if (!symbols.length) return new Map<string, MarketQuoteRecord>();
  const refs = symbols.map((symbol) => adminDb().collection("stockMarketQuotes").doc(symbol));
  const snapshots = await adminDb().getAll(...refs);
  return new Map(snapshots.filter((item) => item.exists).map((item) => [item.id, item.data() as MarketQuoteRecord]));
}

export async function saveQuote(quote: MarketQuoteRecord) {
  await adminDb().collection("stockMarketQuotes").doc(quote.symbol).set(quote, { merge: true });
}

export async function loadPortfolio(uid: string) {
  const transactions = await listTransactions(uid);
  const symbols = [...new Set(transactions.map((item) => item.symbol))];
  const quotes = await listQuotes(symbols);
  return buildPortfolioSnapshot(transactions, quotes);
}