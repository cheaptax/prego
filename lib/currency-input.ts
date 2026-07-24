export function formatCurrencyInput(
  value: string | number | null | undefined,
  maximumDigits = 15,
): string {
  const digits = String(value ?? "")
    .replace(/[^\d]/g, "")
    .slice(0, maximumDigits);
  if (!digits) return "";
  const normalized = digits.replace(/^0+(?=\d)/, "");
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function parseCurrencyInput(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}
