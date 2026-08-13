import QRCode from "qrcode";

export async function renderQuoteComparisonQrDataUri(url: string) {
  const value = url.trim();
  if (!value) {
    throw new Error("quote_comparison_qr_url_missing");
  }
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: {
      dark: "#1B365D",
      light: "#FFFFFF",
    },
  });
}
