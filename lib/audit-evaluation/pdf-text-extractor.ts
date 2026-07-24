export type PdfTextCoordinates = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextItem = {
  text: string;
  coordinates: PdfTextCoordinates | null;
};

export type PdfPageText = {
  pageNumber: number;
  text: string;
  items: PdfTextItem[];
};

export type PdfTextExtractionResult = {
  pages: PdfPageText[];
  scanned: boolean;
  warnings: string[];
};

export type PdfTextExtractionOptions = {
  maximumPages?: number;
  maximumTextPerPage?: number;
  maximumTotalText?: number;
};

const DEFAULT_MAXIMUM_PAGES = 500;
const DEFAULT_MAXIMUM_TEXT_PER_PAGE = 200_000;
const DEFAULT_MAXIMUM_TOTAL_TEXT = 2_000_000;

type TextItemLike = {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  hasEOL?: unknown;
};

export async function extractPdfText(
  bytes: Uint8Array,
  options: PdfTextExtractionOptions = {},
): Promise<PdfTextExtractionResult> {
  const maximumPages = boundedPositiveInteger(
    options.maximumPages,
    DEFAULT_MAXIMUM_PAGES,
  );
  const maximumTextPerPage = boundedPositiveInteger(
    options.maximumTextPerPage,
    DEFAULT_MAXIMUM_TEXT_PER_PAGE,
  );
  const maximumTotalText = boundedPositiveInteger(
    options.maximumTotalText,
    DEFAULT_MAXIMUM_TOTAL_TEXT,
  );
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const warnings: string[] = [];
  const pages: PdfPageText[] = [];
  let totalTextLength = 0;

  try {
    const pageCount = Math.min(document.numPages, maximumPages);
    if (document.numPages > maximumPages) {
      warnings.push("PDF_PAGE_LIMIT_REACHED");
    }

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      let pageText = "";

      for (const rawItem of content.items as TextItemLike[]) {
        if (typeof rawItem.str !== "string" || rawItem.str.length === 0) {
          continue;
        }
        const remainingPage = maximumTextPerPage - pageText.length;
        const remainingTotal = maximumTotalText - totalTextLength;
        const remaining = Math.min(remainingPage, remainingTotal);
        if (remaining <= 0) break;

        const separator = pageText.length === 0
          ? ""
          : rawItem.hasEOL === true
            ? "\n"
            : " ";
        const available = Math.max(0, remaining - separator.length);
        const text = rawItem.str.slice(0, available);
        if (text.length === 0) break;
        pageText += `${separator}${text}`;
        totalTextLength += separator.length + text.length;
        items.push({
          text,
          coordinates: readCoordinates(rawItem),
        });
      }

      if (
        pageText.length >= maximumTextPerPage ||
        totalTextLength >= maximumTotalText
      ) {
        warnings.push(`PDF_TEXT_LIMIT_REACHED_PAGE_${pageNumber}`);
      }
      pages.push({ pageNumber, text: pageText, items });
      page.cleanup();
      if (totalTextLength >= maximumTotalText) break;
    }
  } finally {
    await loadingTask.destroy();
  }

  const scanned = pages.length > 0 && pages.every(
    (page) => page.text.trim().length === 0,
  );
  if (scanned) warnings.push("SCANNED_PDF_NO_EMBEDDED_TEXT");
  return { pages, scanned, warnings };
}

function readCoordinates(item: TextItemLike): PdfTextCoordinates | null {
  if (
    !Array.isArray(item.transform) ||
    item.transform.length < 6 ||
    !item.transform.every((value) => typeof value === "number") ||
    typeof item.width !== "number" ||
    typeof item.height !== "number"
  ) {
    return null;
  }
  return {
    x: item.transform[4] as number,
    y: item.transform[5] as number,
    width: Math.max(0, item.width),
    height: Math.max(0, item.height),
  };
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, fallback)
    : fallback;
}
