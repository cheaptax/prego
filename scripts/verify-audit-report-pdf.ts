import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import {
  buildDeterministicReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import { renderAuditEvaluationReportPdf } from "@/lib/audit-evaluation/report-pdf";
import {
  createReportFixture,
  REPORT_FIXTURE_NOW,
  type ReportFixtureOptions,
} from "@/lib/audit-evaluation/testing/report-fixtures";

const scenarios: Array<{
  id: string;
  options: ReportFixtureOptions;
  maximumPages: number;
}> = [
  { id: "two-firms", options: { quoteCount: 2 }, maximumPages: 36 },
  { id: "five-firms", options: { quoteCount: 5 }, maximumPages: 46 },
  {
    id: "long-names-descriptions",
    options: { quoteCount: 2, longContent: true },
    maximumPages: 64,
  },
  {
    id: "many-missing-items",
    options: { quoteCount: 3, missingInformation: true },
    maximumPages: 46,
  },
  { id: "ties", options: { quoteCount: 3, tied: true }, maximumPages: 42 },
  {
    id: "large-amounts",
    options: { quoteCount: 2, largeAmounts: true },
    maximumPages: 36,
  },
  {
    id: "mixed-korean-numeric-english",
    options: { quoteCount: 2, mixedText: true },
    maximumPages: 36,
  },
];

async function main() {
  const outputDirectory = process.argv[2] ??
    join(tmpdir(), "nhsc-audit-report-visual");
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const manifest: Array<{
    id: string;
    pdfBytes: number;
    pageCount: number;
    title: string;
    minimumInkRatio: number;
    textOverflowCount: number;
    replacementCharacterCount: number;
    contactSheet: string;
  }> = [];

  for (const scenario of scenarios) {
  console.log(`rendering:${scenario.id}`);
  const fixture = createReportFixture(scenario.options);
  const viewModel = buildDeterministicReportViewModel({
    reportRun: fixture.reportRun,
    evaluationCase: fixture.evaluationCase,
    corrections: [],
    generatedAt: REPORT_FIXTURE_NOW,
  });
  const pdfBytes = await renderAuditEvaluationReportPdf(viewModel);
  const pdfPath = join(outputDirectory, `${scenario.id}.pdf`);
  await writeFile(pdfPath, pdfBytes);
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(pdfBytes),
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  const document = await loadingTask.promise;
  const metadata = await document.getMetadata();
  const info = metadata.info as Record<string, unknown>;
  const title = typeof info.Title === "string" ? info.Title : "";
  assert(
    title.includes(viewModel.metadata.reportTitle),
    `${scenario.id}: metadata title`,
  );
  const pages: Canvas[] = [];
  let minimumInkRatio = 1;
  let textOverflowCount = 0;
  let replacementCharacterCount = 0;
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const unitViewport = page.getViewport({ scale: 1 });
      assert(
        Math.abs(unitViewport.width - 595.28) < 2 &&
        Math.abs(unitViewport.height - 841.89) < 2,
        `${scenario.id}: page ${pageNumber} is not A4 portrait (${unitViewport.width}x${unitViewport.height})`,
      );
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => "str" in item ? String(item.str) : "")
        .join(" ");
      replacementCharacterCount += (text.match(/\uFFFD/g) ?? []).length;
      for (const item of content.items) {
        if (!("transform" in item) || !Array.isArray(item.transform)) continue;
        const x = Number(item.transform[4]);
        const y = Number(item.transform[5]);
        const width = "width" in item ? Number(item.width) : 0;
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < -1 ||
          y < -1 ||
          x + width > unitViewport.width + 2 ||
          y > unitViewport.height + 2
        ) {
          textOverflowCount += 1;
        }
      }
      const viewport = page.getViewport({ scale: 0.55 });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: context as never,
        canvas: canvas as never,
        viewport,
      }).promise;
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      let inkPixels = 0;
      for (let index = 0; index < image.data.length; index += 4) {
        if (
          image.data[index] < 246 ||
          image.data[index + 1] < 246 ||
          image.data[index + 2] < 246
        ) {
          inkPixels += 1;
        }
      }
      const inkRatio = inkPixels / (canvas.width * canvas.height);
      minimumInkRatio = Math.min(minimumInkRatio, inkRatio);
      assert(inkRatio > 0.002, `${scenario.id}: blank page ${pageNumber}`);
      pages.push(canvas);
      await writeFile(
        join(outputDirectory, `${scenario.id}-page-${pageNumber}.png`),
        canvas.toBuffer("image/png"),
      );
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  assert(replacementCharacterCount === 0, `${scenario.id}: broken text`);
  assert(textOverflowCount === 0, `${scenario.id}: clipped text coordinates`);
  assert(
    pages.length <= scenario.maximumPages,
    `${scenario.id}: page budget exceeded (${pages.length}/${scenario.maximumPages})`,
  );
  const contactSheetName = `${scenario.id}-contact-sheet.png`;
  await writeFile(
    join(outputDirectory, contactSheetName),
    createContactSheet(scenario.id, pages).toBuffer("image/png"),
  );
  manifest.push({
    id: scenario.id,
    pdfBytes: pdfBytes.byteLength,
    pageCount: pages.length,
    title,
    minimumInkRatio,
    textOverflowCount,
    replacementCharacterCount,
    contactSheet: contactSheetName,
  });
  }

  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ outputDirectory, fixtures: manifest }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function createContactSheet(id: string, pages: Canvas[]) {
  const columns = 5;
  const pageWidth = 170;
  const pageHeight = Math.round(pageWidth * (841.89 / 595.28));
  const gap = 16;
  const header = 42;
  const rows = Math.ceil(pages.length / columns);
  const sheet = createCanvas(
    columns * pageWidth + (columns + 1) * gap,
    header + rows * pageHeight + (rows + 1) * gap,
  );
  const context = sheet.getContext("2d");
  context.fillStyle = "#dce3df";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.fillStyle = "#15251c";
  context.font = "bold 18px sans-serif";
  context.fillText(`${id} · ${pages.length} pages`, gap, 28);
  pages.forEach((page, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (pageWidth + gap);
    const y = header + gap + row * (pageHeight + gap);
    context.drawImage(page, x, y, pageWidth, pageHeight);
    context.strokeStyle = "#67776d";
    context.strokeRect(x, y, pageWidth, pageHeight);
  });
  return sheet;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
