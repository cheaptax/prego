import path from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import {
  auditEvaluationReportViewModelSchema,
  type AuditEvaluationReportBlockViewModel,
  type AuditEvaluationReportSectionViewModel,
  type AuditEvaluationReportViewModel,
  type ReportKeyValuesBlockViewModel,
  type ReportTableBlockViewModel,
} from "@/lib/audit-evaluation/report-view-model";

export const REPORT_PDF_RENDERER_ID = "audit-evaluation-report-pdf";
export const REPORT_PDF_RENDERER_VERSION = 2 as const;

const FONT_FAMILY = "NH-Pretendard-Report";
const PRETENDARD_PACKAGE_ROOT = path.join(
  process.cwd(),
  "node_modules",
  "pretendard",
);
const staticFont = (fileName: string) =>
  path.join(
    PRETENDARD_PACKAGE_ROOT,
    "dist",
    "public",
    "static",
    "alternative",
    fileName,
  );
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const EMPTY_MESSAGE = "표시할 항목 없음";
const CONTINUED = "(계속)";
const TEXT_LINE_BUDGET = 30;
const KEY_VALUE_LINE_BUDGET = 30;
const TABLE_LINE_BUDGET = 30;
const TEXT_CHARS_PER_LINE = 54;
const TABLE_CELL_FRAGMENT_CHARS = 180;

Font.register({
  family: FONT_FAMILY,
  fonts: [
    { src: staticFont("Pretendard-Regular.ttf"), fontWeight: 400 },
    { src: staticFont("Pretendard-SemiBold.ttf"), fontWeight: 600 },
    { src: staticFont("Pretendard-Bold.ttf"), fontWeight: 700 },
  ],
});

Font.registerHyphenationCallback((word) => {
  const characters = Array.from(word);
  if (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(word)) {
    return characters;
  }
  if (characters.length > 18) {
    return chunkCharacters(word, 12);
  }
  return [word];
});

export class ReportPdfRenderError extends Error {
  readonly code: string;

  constructor(code: string, cause?: unknown) {
    super(code, { cause });
    this.name = "ReportPdfRenderError";
    this.code = code;
  }
}

type KeyValueRow = {
  label: string;
  value: string;
};

type TextItem = {
  text: string;
  continued: boolean;
  sourceIndex: number;
};

type TableRow = {
  cells: string[];
  sourceIndex: number;
  continuationIndex: number;
};

type KeyValuesPageBlock = {
  kind: "KEY_VALUES";
  id: string;
  title: string;
  continued: boolean;
  items: KeyValueRow[];
};

type TablePageBlock = {
  kind: "TABLE";
  id: string;
  title: string;
  continued: boolean;
  columns: string[];
  rows: TableRow[];
  columnGroupIndex: number;
  columnGroupCount: number;
};

type BulletsPageBlock = {
  kind: "BULLETS";
  id: string;
  title: string;
  continued: boolean;
  items: TextItem[];
};

type ParagraphsPageBlock = {
  kind: "PARAGRAPHS";
  id: string;
  title: string;
  continued: boolean;
  paragraphs: TextItem[];
};

type PageBlock =
  | KeyValuesPageBlock
  | TablePageBlock
  | BulletsPageBlock
  | ParagraphsPageBlock;

type ReportPagePlan = {
  key: string;
  sectionId: string;
  sectionTitle: string;
  blocks: PageBlock[];
  isCover: boolean;
};

const styles = StyleSheet.create({
  page: {
    width: 595.28,
    height: 841.89,
    backgroundColor: "#ffffff",
    color: "#17201b",
    fontFamily: FONT_FAMILY,
    fontSize: 8.5,
    lineHeight: 1.42,
    paddingTop: 58,
    paddingRight: 42,
    paddingBottom: 52,
    paddingLeft: 42,
  },
  coverPage: {
    paddingTop: 74,
  },
  header: {
    position: "absolute",
    top: 24,
    left: 42,
    right: 42,
    height: 22,
    borderBottomWidth: 1,
    borderBottomColor: "#1b5e3b",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerBrand: {
    color: "#174c32",
    fontSize: 9,
    fontWeight: 700,
  },
  headerBrandRow: {
    maxWidth: "56%",
    flexDirection: "row",
    alignItems: "center",
  },
  headerLogo: {
    width: 22,
    height: 14,
    objectFit: "contain",
    marginRight: 6,
  },
  headerContext: {
    color: "#303d35",
    fontSize: 7.5,
    textAlign: "right",
  },
  headerContextColumn: {
    width: "42%",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 42,
    right: 42,
    height: 20,
    borderTopWidth: 0.75,
    borderTopColor: "#65746b",
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerMeta: {
    color: "#34433a",
    fontSize: 6.7,
    maxWidth: "88%",
  },
  pageNumber: {
    color: "#17201b",
    fontSize: 7,
    fontWeight: 600,
  },
  watermark: {
    position: "absolute",
    top: 355,
    left: 72,
    right: 72,
    transform: "rotate(-32deg)",
    opacity: 0.08,
    textAlign: "center",
  },
  watermarkText: {
    color: "#174c32",
    fontSize: 42,
    fontWeight: 700,
  },
  coverHero: {
    minHeight: 220,
    borderTopWidth: 7,
    borderTopColor: "#1b5e3b",
    borderBottomWidth: 1,
    borderBottomColor: "#1b5e3b",
    paddingTop: 48,
    paddingBottom: 36,
    paddingLeft: 20,
    paddingRight: 20,
    justifyContent: "center",
  },
  coverLogo: {
    width: 96,
    height: 48,
    objectFit: "contain",
    alignSelf: "center",
    marginBottom: 18,
  },
  coverEyebrow: {
    color: "#174c32",
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 14,
    textAlign: "center",
  },
  coverTitle: {
    color: "#10271c",
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1.3,
    textAlign: "center",
  },
  coverSubtitle: {
    color: "#27382f",
    fontSize: 11,
    marginTop: 18,
    textAlign: "center",
  },
  coverDetails: {
    marginTop: 34,
  },
  sectionHeading: {
    borderLeftWidth: 5,
    borderLeftColor: "#1b5e3b",
    paddingLeft: 10,
    marginBottom: 16,
  },
  sectionNumber: {
    color: "#174c32",
    fontSize: 7.5,
    fontWeight: 700,
    marginBottom: 3,
  },
  sectionTitle: {
    color: "#10271c",
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.25,
  },
  block: {
    width: "100%",
  },
  blockTitleRow: {
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  blockTitle: {
    color: "#10271c",
    fontSize: 10.5,
    fontWeight: 700,
  },
  continuation: {
    color: "#34433a",
    fontSize: 7,
  },
  empty: {
    borderWidth: 0.75,
    borderColor: "#89968e",
    backgroundColor: "#f5f7f5",
    color: "#26372e",
    padding: 12,
    textAlign: "center",
  },
  keyValueRow: {
    flexDirection: "row",
    borderBottomWidth: 0.6,
    borderBottomColor: "#9ca8a1",
  },
  keyValueLabel: {
    width: "28%",
    backgroundColor: "#e9f0ec",
    color: "#17201b",
    fontWeight: 600,
    paddingTop: 6,
    paddingRight: 7,
    paddingBottom: 6,
    paddingLeft: 7,
  },
  keyValueValue: {
    width: "72%",
    color: "#17201b",
    paddingTop: 6,
    paddingRight: 7,
    paddingBottom: 6,
    paddingLeft: 7,
  },
  table: {
    borderTopWidth: 0.8,
    borderLeftWidth: 0.8,
    borderColor: "#46564d",
  },
  tableRow: {
    flexDirection: "row",
  },
  tableHeaderCell: {
    flexBasis: 0,
    flexGrow: 1,
    backgroundColor: "#174c32",
    color: "#ffffff",
    borderRightWidth: 0.8,
    borderBottomWidth: 0.8,
    borderColor: "#46564d",
    fontSize: 7.2,
    fontWeight: 700,
    lineHeight: 1.3,
    paddingTop: 5,
    paddingRight: 4,
    paddingBottom: 5,
    paddingLeft: 4,
  },
  tableCell: {
    flexBasis: 0,
    flexGrow: 1,
    color: "#17201b",
    borderRightWidth: 0.6,
    borderBottomWidth: 0.6,
    borderColor: "#76847c",
    fontSize: 7,
    lineHeight: 1.35,
    paddingTop: 4,
    paddingRight: 4,
    paddingBottom: 4,
    paddingLeft: 4,
  },
  tableFirstCell: {
    backgroundColor: "#eef3f0",
    fontWeight: 600,
  },
  tableTotalBurdenHeader: {
    backgroundColor: "#9a5a00",
  },
  tableTotalBurdenCell: {
    backgroundColor: "#fff4d6",
    color: "#513b00",
    fontWeight: 700,
  },
  bulletRow: {
    flexDirection: "row",
    marginBottom: 7,
  },
  bulletMark: {
    width: 14,
    color: "#174c32",
    fontWeight: 700,
  },
  bulletText: {
    flexGrow: 1,
    flexBasis: 0,
    color: "#17201b",
  },
  paragraph: {
    color: "#17201b",
    marginBottom: 9,
    textAlign: "justify",
  },
});

function chunkCharacters(value: string, size: number): string[] {
  const characters = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(""));
  }
  return chunks.length > 0 ? chunks : [""];
}

function estimatedLines(value: string, charsPerLine: number): number {
  return Math.max(1, Math.ceil(Array.from(value).length / charsPerLine));
}

function splitByEstimatedLines(
  value: string,
  charsPerLine: number,
  maximumLines: number,
): string[] {
  return chunkCharacters(value, charsPerLine * maximumLines);
}

function pageTitle(block: PageBlock) {
  return block.title;
}

function estimatedBlockLines(block: PageBlock) {
  if (block.kind === "KEY_VALUES") {
    return 4 + block.items.reduce(
      (sum, row) =>
        sum +
        Math.max(
          estimatedLines(row.label, 16),
          estimatedLines(row.value, 44),
        ) +
        1,
      0,
    );
  }
  if (block.kind === "TABLE") {
    return 5 + block.rows.length * 2;
  }
  const items = block.kind === "BULLETS" ? block.items : block.paragraphs;
  return 4 + items.reduce(
    (sum, item) => sum + estimatedLines(item.text, TEXT_CHARS_PER_LINE) + 1,
    0,
  );
}

function paginateKeyValues(
  block: ReportKeyValuesBlockViewModel,
): KeyValuesPageBlock[] {
  if (block.items.length === 0) {
    return [{
      kind: "KEY_VALUES",
      id: block.id,
      title: block.title,
      continued: false,
      items: [],
    }];
  }

  const rows = block.items.flatMap(({ label, value }) => {
    const labelParts = splitByEstimatedLines(label, 16, 28);
    const valueParts = splitByEstimatedLines(value, 44, 28);
    const partCount = Math.max(labelParts.length, valueParts.length);
    return Array.from({ length: partCount }, (_, index) => ({
      label: index === 0
        ? (labelParts[index] ?? "")
        : `${CONTINUED}${labelParts[index] ? ` ${labelParts[index]}` : ""}`,
      value: valueParts[index] ?? "",
    }));
  });

  const pages: KeyValuesPageBlock[] = [];
  let current: KeyValueRow[] = [];
  let usedLines = 0;
  for (const row of rows) {
    const cost = Math.max(
      estimatedLines(row.label, 16),
      estimatedLines(row.value, 44),
    ) + 1;
    if (current.length > 0 && usedLines + cost > KEY_VALUE_LINE_BUDGET) {
      pages.push({
        kind: "KEY_VALUES",
        id: block.id,
        title: block.title,
        continued: pages.length > 0,
        items: current,
      });
      current = [];
      usedLines = 0;
    }
    current.push(row);
    usedLines += cost;
  }
  if (current.length > 0) {
    pages.push({
      kind: "KEY_VALUES",
      id: block.id,
      title: block.title,
      continued: pages.length > 0,
      items: current,
    });
  }
  return pages;
}

function paginateTextItems(
  id: string,
  title: string,
  kind: "BULLETS" | "PARAGRAPHS",
  values: string[],
): Array<BulletsPageBlock | ParagraphsPageBlock> {
  if (values.length === 0) {
    return kind === "BULLETS"
      ? [{ kind, id, title, continued: false, items: [] }]
      : [{ kind, id, title, continued: false, paragraphs: [] }];
  }

  const pieces = values.flatMap((value, sourceIndex) =>
    splitByEstimatedLines(value, TEXT_CHARS_PER_LINE, 26).map(
      (text, index) => ({
        text,
        continued: index > 0,
        sourceIndex,
      }),
    )
  );
  const pages: TextItem[][] = [];
  let current: TextItem[] = [];
  let usedLines = 0;
  for (const piece of pieces) {
    const cost = estimatedLines(piece.text, TEXT_CHARS_PER_LINE) + 1;
    if (current.length > 0 && usedLines + cost > TEXT_LINE_BUDGET) {
      pages.push(current);
      current = [];
      usedLines = 0;
    }
    current.push(piece);
    usedLines += cost;
  }
  if (current.length > 0) pages.push(current);

  return pages.map((items, index) =>
    kind === "BULLETS"
      ? { kind, id, title, continued: index > 0, items }
      : { kind, id, title, continued: index > 0, paragraphs: items }
  );
}

function columnGroups(columnCount: number): number[][] {
  if (columnCount <= 4) {
    return [Array.from({ length: columnCount }, (_, index) => index)];
  }
  const groups: number[][] = [];
  for (let index = 1; index < columnCount; index += 3) {
    groups.push([
      0,
      ...Array.from(
        { length: Math.min(3, columnCount - index) },
        (_, offset) => index + offset,
      ),
    ]);
  }
  return groups;
}

function expandTableRows(rows: string[][]): TableRow[] {
  return rows.flatMap((cells, sourceIndex) => {
    const fragments = cells.map((cell) =>
      chunkCharacters(cell, TABLE_CELL_FRAGMENT_CHARS)
    );
    const fragmentCount = Math.max(...fragments.map(({ length }) => length));
    return Array.from({ length: fragmentCount }, (_, continuationIndex) => ({
      cells: fragments.map((parts, columnIndex) => {
        const fragment = parts[continuationIndex] ?? "";
        if (columnIndex !== 0 || continuationIndex === 0) return fragment;
        return fragment ? `${CONTINUED} ${fragment}` : CONTINUED;
      }),
      sourceIndex,
      continuationIndex,
    }));
  });
}

function paginateTable(block: ReportTableBlockViewModel): TablePageBlock[] {
  const groups = columnGroups(block.columns.length);
  const expandedRows = expandTableRows(block.rows);
  const pages: TablePageBlock[] = [];

  groups.forEach((group, columnGroupIndex) => {
    const columns = group.map((index) => block.columns[index]);
    const headerLines = Math.max(
      ...columns.map((column) =>
        estimatedLines(column, Math.max(12, Math.floor(66 / columns.length)))
      ),
    );
    const availableLines = Math.max(20, TABLE_LINE_BUDGET - headerLines);
    let current: TableRow[] = [];
    let usedLines = 0;
    let groupPageIndex = 0;

    for (const row of expandedRows) {
      const projected = group.map((index) => row.cells[index]);
      const charsPerCell = Math.max(
        12,
        Math.floor(66 / projected.length),
      );
      const cost = Math.max(
        ...projected.map((cell) => estimatedLines(cell, charsPerCell)),
      ) + 1;
      if (current.length > 0 && usedLines + cost > availableLines) {
        pages.push({
          kind: "TABLE",
          id: block.id,
          title: block.title,
          continued: columnGroupIndex > 0 || groupPageIndex > 0,
          columns,
          rows: current,
          columnGroupIndex,
          columnGroupCount: groups.length,
        });
        groupPageIndex += 1;
        current = [];
        usedLines = 0;
      }
      current.push({
        ...row,
        cells: projected,
      });
      usedLines += cost;
    }

    if (current.length > 0 || expandedRows.length === 0) {
      pages.push({
        kind: "TABLE",
        id: block.id,
        title: block.title,
        continued: columnGroupIndex > 0 || groupPageIndex > 0,
        columns,
        rows: current,
        columnGroupIndex,
        columnGroupCount: groups.length,
      });
    }
  });
  return pages;
}

function paginateBlock(block: AuditEvaluationReportBlockViewModel): PageBlock[] {
  if (block.type === "KEY_VALUES") return paginateKeyValues(block);
  if (block.type === "TABLE") return paginateTable(block);
  if (block.type === "BULLETS") {
    return paginateTextItems(block.id, block.title, block.type, block.items);
  }
  return paginateTextItems(
    block.id,
    block.title,
    block.type,
    block.paragraphs,
  );
}

function narrativeBlock(
  viewModel: AuditEvaluationReportViewModel,
  section: AuditEvaluationReportSectionViewModel,
): AuditEvaluationReportBlockViewModel | null {
  const paragraphs = viewModel.narrative.paragraphs
    .filter(({ sectionId }) => sectionId === section.id)
    .map(({ text }) => text);
  if (paragraphs.length === 0) return null;
  return {
    id: `narrative-${section.id}`,
    type: "PARAGRAPHS",
    title: "AI 보조 설명",
    paragraphs,
  };
}

function buildPagePlans(
  viewModel: AuditEvaluationReportViewModel,
): ReportPagePlan[] {
  const cover = viewModel.sections.find(({ id }) => id === "cover");
  const remaining = viewModel.sections
    .filter(({ id }) => id !== "cover")
    .slice()
    .sort((left, right) =>
      left.order - right.order ||
      (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
    );
  const sections = cover ? [cover, ...remaining] : remaining;
  const plans: ReportPagePlan[] = [];

  for (const section of sections) {
    const narrative = narrativeBlock(viewModel, section);
    const blocks = narrative ? [...section.blocks, narrative] : section.blocks;
    let packedBlocks: PageBlock[] = [];
    let packedLines = 0;
    let packedIndex = 0;
    const flushPacked = () => {
      if (packedBlocks.length === 0) return;
      plans.push({
        key: `${section.id}-packed-${packedIndex}`,
        sectionId: section.id,
        sectionTitle: section.title,
        blocks: packedBlocks,
        isCover: section.id === "cover" && plans.length === 0,
      });
      packedIndex += 1;
      packedBlocks = [];
      packedLines = 0;
    };
    for (const block of blocks) {
      const chunks = paginateBlock(block);
      chunks.forEach((chunk) => {
        const cost = estimatedBlockLines(chunk);
        if (
          packedBlocks.length > 0 &&
          (packedLines + cost > 42 || chunk.kind === "TABLE")
        ) {
          flushPacked();
        }
        if (chunk.kind === "TABLE" && cost > 20) {
          plans.push({
            key: `${section.id}-${block.id}-${packedIndex}`,
            sectionId: section.id,
            sectionTitle: section.title,
            blocks: [chunk],
            isCover: section.id === "cover" && plans.length === 0,
          });
          packedIndex += 1;
          return;
        }
        packedBlocks.push(chunk);
        packedLines += cost;
      });
    }
    flushPacked();
  }
  return plans;
}

function firstBlock(plan: ReportPagePlan) {
  const block = plan.blocks[0];
  if (!block) {
    throw new ReportPdfRenderError("REPORT_PAGE_BLOCK_MISSING");
  }
  return block;
}

function FixedChrome({
  viewModel,
}: {
  viewModel: AuditEvaluationReportViewModel;
}) {
  const { primaryColor, accentColor, logoDataUri } =
    viewModel.metadata.branding;
  return (
    <>
      <View
        fixed
        style={[styles.header, { borderBottomColor: primaryColor }]}
      >
        <View style={styles.headerBrandRow}>
          {logoDataUri ? (
            // React PDF images do not expose HTML alternative-text props.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image
              src={logoDataUri}
              style={styles.headerLogo}
            />
          ) : null}
          <Text style={[styles.headerBrand, { color: accentColor }]}>
            {viewModel.metadata.reportTitle}
          </Text>
        </View>
        <View style={styles.headerContextColumn}>
          <Text style={styles.headerContext}>
            {viewModel.metadata.cooperative.name}
          </Text>
          <Text style={styles.headerContext}>
            FY{viewModel.metadata.fiscalYear}
          </Text>
          <Text style={styles.headerContext}>
            {viewModel.metadata.centerContact}
          </Text>
        </View>
      </View>
      {viewModel.metadata.watermark.enabled && (
        <View fixed style={styles.watermark}>
          <Text style={[styles.watermarkText, { color: primaryColor }]}>
            {viewModel.metadata.watermark.text}
          </Text>
        </View>
      )}
      <View fixed style={styles.footer}>
        <Text style={styles.footerMeta}>
          ID {viewModel.metadata.report.id} · 기준{" "}
          {viewModel.metadata.evaluationStandardVersion ??
            `${viewModel.metadata.config.id}-v${viewModel.metadata.config.version}`}
          {" · "}확정{" "}
          {(viewModel.metadata.finalizedAt ??
            viewModel.metadata.generatedAt).replace("T", " ").slice(0, 16)}
        </Text>
        <Text
          fixed
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`}
        />
      </View>
    </>
  );
}

function BlockHeading({ block }: { block: PageBlock }) {
  const groupLabel = block.kind === "TABLE" && block.columnGroupCount > 1
    ? `열 묶음 ${block.columnGroupIndex + 1}/${block.columnGroupCount}`
    : null;
  return (
    <View style={styles.blockTitleRow}>
      <Text style={styles.blockTitle}>{pageTitle(block)}</Text>
      <Text style={styles.continuation}>
        {[groupLabel, block.continued ? CONTINUED : null]
          .filter((value): value is string => value !== null)
          .join(" · ")}
      </Text>
    </View>
  );
}

function KeyValuesContent({ block }: { block: KeyValuesPageBlock }) {
  if (block.items.length === 0) {
    return <Text style={styles.empty}>{EMPTY_MESSAGE}</Text>;
  }
  return (
    <View>
      {block.items.map((item, index) => (
        <View
          key={`${index}-${item.label}`}
          style={styles.keyValueRow}
          wrap={false}
        >
          <Text style={styles.keyValueLabel}>{item.label}</Text>
          <Text style={styles.keyValueValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function TableContent({
  block,
  primaryColor,
}: {
  block: TablePageBlock;
  primaryColor: string;
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableRow} wrap={false}>
        {block.columns.map((column, index) => (
          <Text
            key={`${index}-${column}`}
            style={[
              styles.tableHeaderCell,
              { backgroundColor: primaryColor },
              ...(column === "예상 총부담액"
                ? [styles.tableTotalBurdenHeader]
                : []),
            ]}
          >
            {column}
          </Text>
        ))}
      </View>
      {block.rows.length === 0
        ? <Text style={styles.empty}>{EMPTY_MESSAGE}</Text>
        : block.rows.map((row) => (
          <View
            key={`${row.sourceIndex}-${row.continuationIndex}`}
            style={styles.tableRow}
            wrap={false}
          >
            {row.cells.map((cell, index) => (
              <Text
                key={`${index}-${cell}`}
                style={[
                  styles.tableCell,
                  ...(index === 0 ? [styles.tableFirstCell] : []),
                  ...(block.columns[index] === "예상 총부담액"
                    ? [styles.tableTotalBurdenCell]
                    : []),
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
    </View>
  );
}

function BulletsContent({
  block,
  accentColor,
}: {
  block: BulletsPageBlock;
  accentColor: string;
}) {
  if (block.items.length === 0) {
    return <Text style={styles.empty}>{EMPTY_MESSAGE}</Text>;
  }
  return (
    <View>
      {block.items.map((item, index) => (
        <View
          key={`${item.sourceIndex}-${index}`}
          style={styles.bulletRow}
          wrap={false}
        >
          <Text style={[styles.bulletMark, { color: accentColor }]}>
            {item.continued ? CONTINUED : "•"}
          </Text>
          <Text style={styles.bulletText}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

function ParagraphsContent({ block }: { block: ParagraphsPageBlock }) {
  if (block.paragraphs.length === 0) {
    return <Text style={styles.empty}>{EMPTY_MESSAGE}</Text>;
  }
  return (
    <View>
      {block.paragraphs.map((paragraph, index) => (
        <Text
          key={`${paragraph.sourceIndex}-${index}`}
          style={styles.paragraph}
          wrap={false}
        >
          {paragraph.continued ? `${CONTINUED} ` : ""}
          {paragraph.text}
        </Text>
      ))}
    </View>
  );
}

function BlockContent({
  block,
  primaryColor,
  accentColor,
}: {
  block: PageBlock;
  primaryColor: string;
  accentColor: string;
}) {
  if (block.kind === "KEY_VALUES") {
    return <KeyValuesContent block={block} />;
  }
  if (block.kind === "TABLE") {
    return <TableContent block={block} primaryColor={primaryColor} />;
  }
  if (block.kind === "BULLETS") {
    return <BulletsContent block={block} accentColor={accentColor} />;
  }
  return <ParagraphsContent block={block} />;
}

function StandardPageContent({
  plan,
  viewModel,
}: {
  plan: ReportPagePlan;
  viewModel: AuditEvaluationReportViewModel;
}) {
  const { primaryColor, accentColor } = viewModel.metadata.branding;
  return (
    <>
      <View
        style={[styles.sectionHeading, { borderLeftColor: primaryColor }]}
      >
        <Text style={[styles.sectionNumber, { color: accentColor }]}>
          SECTION · {plan.sectionId}
        </Text>
        <Text style={styles.sectionTitle}>{plan.sectionTitle}</Text>
      </View>
      <View style={styles.block}>
        {plan.blocks.map((block) => (
          <View key={block.id} style={styles.block}>
            <BlockHeading block={block} />
            <BlockContent
              block={block}
              primaryColor={primaryColor}
              accentColor={accentColor}
            />
          </View>
        ))}
      </View>
    </>
  );
}

function CoverPageContent({
  plan,
  viewModel,
}: {
  plan: ReportPagePlan;
  viewModel: AuditEvaluationReportViewModel;
}) {
  const { primaryColor, accentColor, logoDataUri } =
    viewModel.metadata.branding;
  return (
    <>
      <View
        style={[
          styles.coverHero,
          {
            borderTopColor: primaryColor,
            borderBottomColor: primaryColor,
          },
        ]}
      >
        {logoDataUri ? (
          // React PDF images do not expose HTML alternative-text props.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={logoDataUri} style={styles.coverLogo} />
        ) : null}
        <Text style={[styles.coverEyebrow, { color: accentColor }]}>
          {viewModel.metadata.centerContact}
        </Text>
        <Text style={styles.coverTitle}>
          {viewModel.metadata.reportTitle}
        </Text>
        <Text style={styles.coverSubtitle}>
          {viewModel.metadata.cooperative.name} · FY
          {viewModel.metadata.fiscalYear}
        </Text>
      </View>
      <View style={styles.coverDetails}>
        <BlockHeading block={firstBlock(plan)} />
        <BlockContent
          block={firstBlock(plan)}
          primaryColor={primaryColor}
          accentColor={accentColor}
        />
      </View>
    </>
  );
}

function ReportPdfDocument({
  viewModel,
  pages,
}: {
  viewModel: AuditEvaluationReportViewModel;
  pages: ReportPagePlan[];
}) {
  const generatedDate = new Date(viewModel.metadata.generatedAt);
  const title =
    `${viewModel.metadata.cooperative.name} ${viewModel.metadata.reportTitle}`;
  const producer = `${REPORT_PDF_RENDERER_ID}/${REPORT_PDF_RENDERER_VERSION}`;
  return (
    <Document
      title={title}
      author={viewModel.metadata.center}
      subject={`${viewModel.metadata.fiscalYear}년 감사인 견적 정량 평가 및 감사보수 분석`}
      keywords={`농협, 감사인, 견적, 평가보고서, FY${viewModel.metadata.fiscalYear}`}
      creator={producer}
      producer={producer}
      language="ko-KR"
      creationDate={generatedDate}
      modificationDate={generatedDate}
      pageLayout="singlePage"
    >
      {pages.map((plan) => (
        <Page
          key={plan.key}
          size="A4"
          orientation="portrait"
          style={[styles.page, ...(plan.isCover ? [styles.coverPage] : [])]}
        >
          <FixedChrome viewModel={viewModel} />
          {plan.isCover
            ? <CoverPageContent plan={plan} viewModel={viewModel} />
            : (
              <StandardPageContent
                plan={plan}
                viewModel={viewModel}
              />
            )}
        </Page>
      ))}
    </Document>
  );
}

export async function renderAuditEvaluationReportPdf(
  viewModel: unknown,
): Promise<Uint8Array> {
  let parsed: AuditEvaluationReportViewModel;
  try {
    parsed = auditEvaluationReportViewModelSchema.parse(viewModel);
  } catch {
    throw new ReportPdfRenderError("invalid_report_view_model");
  }

  try {
    const pages = buildPagePlans(parsed);
    if (pages.length === 0) {
      throw new ReportPdfRenderError("empty_pdf");
    }
    const buffer = await renderToBuffer(
      <ReportPdfDocument viewModel={parsed} pages={pages} />,
    );
    if (buffer.byteLength === 0) {
      throw new ReportPdfRenderError("empty_pdf");
    }
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new ReportPdfRenderError("pdf_too_large");
    }
    return new Uint8Array(buffer);
  } catch (error) {
    if (error instanceof ReportPdfRenderError) throw error;
    throw new ReportPdfRenderError("pdf_render_failed", error);
  }
}
