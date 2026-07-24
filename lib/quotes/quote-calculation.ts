import type { QuoteLineItemRecord } from "@/lib/firebase/schema";

export type QuoteLineItemInput = {
  id?: string;
  name?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
};

export function normalizeQuoteLineItems(
  input: unknown,
): QuoteLineItemRecord[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) {
    return null;
  }
  const items = input.map((item, index) => {
    const row = (item ?? {}) as QuoteLineItemInput;
    const name = String(row.name ?? "").trim();
    const description = String(row.description ?? "").trim();
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    if (
      !name ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(unitPrice) ||
      quantity <= 0 ||
      quantity > 9999 ||
      unitPrice < 0 ||
      unitPrice > 1_000_000_000
    ) {
      return null;
    }
    const supplyAmount = Math.round(quantity * unitPrice);
    return {
      id: String(row.id ?? `line-${index + 1}`).slice(0, 40),
      name: name.slice(0, 120),
      description: description ? description.slice(0, 500) : undefined,
      quantity,
      unitPrice,
      supplyAmount,
    } satisfies QuoteLineItemRecord;
  });
  if (items.some((item) => item === null)) return null;
  return items as QuoteLineItemRecord[];
}

export function calculateQuoteTotals(
  lineItems: QuoteLineItemRecord[],
  vatIncluded: boolean,
) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.supplyAmount, 0);
  const taxAmount = vatIncluded ? Math.round(subtotal * 0.1) : 0;
  return {
    subtotal,
    taxAmount,
    totalAmount: subtotal + taxAmount,
  };
}
