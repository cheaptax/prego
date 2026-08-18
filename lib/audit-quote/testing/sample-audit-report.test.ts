import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AuditEvaluationReportBlockViewModel,
  AuditEvaluationReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import { createSampleAuditReportViewModel } from "@/lib/audit-quote/sample-audit-report";
import { SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS } from "@/lib/audit-quote/sample-audit-report-public";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const SAMPLE_FIRM_NAMES = [
  "제휴회계법인1",
  "제휴회계법인2",
  "제휴회계법인3",
  "기타회계법인",
] as const;

const INTERNAL_LOGIC_LEAKS = [
  /FIELD_PRESENT/,
  /MINIMUM_INTEGER/,
  /DECIMAL_STRING/,
  /INTEGER:/,
  /\+INF/,
  /TRUSTED_SERVER/,
  /DETERMINISTIC_PARSE/,
  /테스트 회계법인/,
  /테스트농협/,
  /audit-quality\.default/,
  /nh-audit-evaluation-2025/,
  /LOCAL_AGRICULTURAL_COOPERATIVE/,
  /LOCAL_NONGHYUP_AUDIT_COUNT/,
  /CERTIFIED_PUBLIC_ACCOUNTANT_COUNT/,
  /NONGHYUP_TAX_AGENCY_PERFORMED/,
  /NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED/,
  /AUDITED_NONGHYUP_TYPE_DIVERSITY/,
  /\{"name":/,
  /근거 \d+건/,
  /출처 미확인/,
  /적용 기준/,
  /점수 엔진/,
  /평가기준 설정/,
];

describe("FY27 audit-quote sample review report", () => {
  it("builds the sample from the same report view-model pipeline", () => {
    const viewModel = createSampleAuditReportViewModel();
    assert.equal(viewModel.metadata.cooperative.name, "예시농협");
    assert.equal(viewModel.metadata.fiscalYear, 2027);
    for (const sectionId of SAMPLE_AUDIT_REPORT_PREVIEW_SECTION_IDS) {
      assert.ok(
        viewModel.sections.some((section) => section.id === sectionId),
        `missing sample section ${sectionId}`,
      );
    }
    assert.ok(
      viewModel.sections.some(
        (section) =>
          section.id === "quote-comparison" &&
          section.blocks.some((block) => block.type === "TABLE"),
      ),
    );
  });

  it("uses affiliated and other firm names with cheap dummy fees and ranks", () => {
    const viewModel = createSampleAuditReportViewModel();
    const visible = customerFacingText(viewModel);
    for (const name of SAMPLE_FIRM_NAMES) {
      assert.match(visible, new RegExp(name));
    }
    assert.equal(
      viewModel.sections.some((section) => section.id === "appendix"),
      false,
    );
    assert.doesNotMatch(visible, /부록/);

    const rankTable = findTable(viewModel, "nh-audit-composite-comparison-rank");
    assert.deepEqual(
      rankTable.rows.map((row) => row[1]),
      [...SAMPLE_FIRM_NAMES],
    );
    assert.deepEqual(
      rankTable.rows.map((row) => row[0]),
      ["1위", "2위", "3위", "4위"],
    );

    const costTable = findTable(viewModel, "nh-audit-composite-comparison-cost");
    const fees = costTable.rows.map((row) => parseWon(row[1] ?? ""));
    assert.equal(Math.min(...fees), 8_300_000);
    assert.equal(
      fees.reduce((sum, fee) => sum + fee, 0) / fees.length,
      9_000_000,
    );

    const qualityInputs = findTable(viewModel, "nh-audit-quality-detail-input");
    for (const name of SAMPLE_FIRM_NAMES.slice(0, 3)) {
      const rows = qualityInputs.rows.filter((row) => row[0] === name);
      assert.ok(rows.length > 0, `missing quality evidence for ${name}`);
      assert.ok(
        rows.some((row) => (row[2] ?? "").includes("건")),
        `missing audit-count evidence for ${name}`,
      );
    }
  });

  it("does not expose internal scoring logic or extraction metadata", () => {
    const visible = customerFacingText(createSampleAuditReportViewModel());
    for (const leak of INTERNAL_LOGIC_LEAKS) {
      assert.doesNotMatch(visible, leak);
    }
  });

  it("reuses the live report document renderer and download route", () => {
    const guide = readFileSync(
      path.join(root, "components/AuditQuoteGuidePage.tsx"),
      "utf8",
    );
    const workspace = readFileSync(
      path.join(root, "components/AuditEvaluationReportWorkspace.tsx"),
      "utf8",
    );
    const route = readFileSync(
      path.join(root, "app/api/audit-quote/sample-report/route.ts"),
      "utf8",
    );
    assert.match(guide, /AuditEvaluationReportDocument/);
    assert.match(workspace, /AuditEvaluationReportDocument/);
    assert.match(route, /renderAuditEvaluationReportPdf/);
    assert.match(route, /createSampleAuditReportViewModel/);
  });
});

function findTable(
  viewModel: AuditEvaluationReportViewModel,
  id: string,
) {
  const block = viewModel.sections
    .flatMap((section) => section.blocks)
    .find((item) => item.id === id);
  assert.equal(block?.type, "TABLE");
  if (block?.type !== "TABLE") {
    throw new Error(`missing table ${id}`);
  }
  return block;
}

function parseWon(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  assert.ok(digits.length > 0, `not a won amount: ${value}`);
  return Number(digits);
}

function customerFacingText(viewModel: AuditEvaluationReportViewModel) {
  return [
    viewModel.metadata.reportTitle,
    viewModel.metadata.centerContact,
    viewModel.metadata.cooperative.name,
    viewModel.metadata.report.id,
    viewModel.metadata.config.id,
    viewModel.metadata.config.name,
    viewModel.metadata.evaluationStandardVersion ?? "",
    ...viewModel.sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap(blockText),
    ]),
  ].join("\n");
}

function blockText(block: AuditEvaluationReportBlockViewModel) {
  if (block.type === "TABLE") {
    return [block.title, ...block.columns, ...block.rows.flat()];
  }
  if (block.type === "KEY_VALUES") {
    return [
      block.title,
      ...block.items.flatMap((item) => [item.label, item.value]),
    ];
  }
  if (block.type === "BULLETS") {
    return [block.title, ...block.items];
  }
  return [block.title, ...block.paragraphs];
}
