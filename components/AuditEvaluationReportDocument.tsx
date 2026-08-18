import Image from "next/image";
import type { CSSProperties } from "react";
import {
  reportTableCellClassName,
  type AuditEvaluationReportBlockViewModel,
  type AuditEvaluationReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";

type Props = {
  viewModel: AuditEvaluationReportViewModel;
  sectionIds?: readonly string[];
  className?: string;
};

export function AuditEvaluationReportDocument({
  viewModel,
  sectionIds,
  className,
}: Props) {
  const brandStyle = {
    "--report-primary": viewModel.metadata.branding.primaryColor,
    "--report-accent": viewModel.metadata.branding.accentColor,
  } as CSSProperties & {
    "--report-primary": string;
    "--report-accent": string;
  };
  const sections = sectionIds
    ? viewModel.sections.filter((section) => sectionIds.includes(section.id))
    : viewModel.sections;

  return (
    <article
      className={["audit-report-document", className].filter(Boolean).join(" ")}
      aria-label={viewModel.metadata.reportTitle}
      style={brandStyle}
    >
      <header className="audit-report-document__header">
        {viewModel.metadata.branding.logoDataUri ? (
          <Image
            className="audit-report-document__logo"
            src={viewModel.metadata.branding.logoDataUri}
            alt={`${viewModel.metadata.reportTitle} 로고`}
            width={120}
            height={64}
            unoptimized
          />
        ) : null}
        <div>
          <h1>{viewModel.metadata.reportTitle}</h1>
          <p>{viewModel.metadata.centerContact}</p>
          <p>
            {viewModel.metadata.cooperative.name} ·{" "}
            {viewModel.metadata.fiscalYear}년
          </p>
          <p>
            {viewModel.metadata.report.id} ·{" "}
            {viewModel.metadata.evaluationStandardVersion ??
              `설정 v${viewModel.metadata.config.version}`}
            {" · "}
            {formatReportDateTime(
              viewModel.metadata.finalizedAt ?? viewModel.metadata.generatedAt,
            )}
          </p>
        </div>
      </header>
      {sections.map((section) => (
        <section key={section.id} id={`report-${section.id}`}>
          <h2>{section.title}</h2>
          {section.blocks.map((block) => (
            <ReportBlock key={block.id} block={block} />
          ))}
          {viewModel.narrative.paragraphs
            .filter((paragraph) => paragraph.sectionId === section.id)
            .map((paragraph, index) => (
              <aside key={`${paragraph.sectionId}-${index}`}>
                <h3>AI 보조 설명</h3>
                <p>{paragraph.text}</p>
              </aside>
            ))}
        </section>
      ))}
    </article>
  );
}

function ReportBlock({
  block,
}: {
  block: AuditEvaluationReportBlockViewModel;
}) {
  if (block.type === "KEY_VALUES") {
    return (
      <div
        className={
          block.id === "nh-audit-final-result"
            ? "audit-report-block audit-report-block--result"
            : "audit-report-block"
        }
      >
        <h3>{block.title}</h3>
        <dl>
          {block.items.map((item, index) => (
            <div key={`${item.label}-${index}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (block.type === "TABLE") {
    return (
      <div className="audit-report-block">
        <h3>{block.title}</h3>
        <div className="audit-report-table-wrap">
          <table>
            <thead>
              <tr>
                {block.columns.map((column, index) => (
                  <th
                    key={`${column}-${index}`}
                    scope="col"
                    className={reportTableCellClassName(block.columns, column)}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.length === 0 ? (
                <tr>
                  <td colSpan={block.columns.length}>해당 견적 없음</td>
                </tr>
              ) : (
                (() => {
                  const rowSpans = computeFirstColumnRowSpans(block.rows);
                  return block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => {
                        if (cellIndex === 0) {
                          const span = rowSpans[rowIndex];
                          if (span === 0) return null;
                          return (
                            <td
                              key={cellIndex}
                              rowSpan={span > 1 ? span : undefined}
                              className={reportTableCellClassName(
                                block.columns,
                                block.columns[cellIndex] ?? "",
                                cell,
                              )}
                            >
                              {cell}
                            </td>
                          );
                        }
                        return (
                          <td
                            key={cellIndex}
                            className={reportTableCellClassName(
                              block.columns,
                              block.columns[cellIndex] ?? "",
                              cell,
                            )}
                          >
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (block.type === "BULLETS") {
    return (
      <div className="audit-report-block">
        <h3>{block.title}</h3>
        <ul>
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="audit-report-block">
      <h3>{block.title}</h3>
      {block.paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function computeFirstColumnRowSpans(rows: string[][]) {
  const spans = rows.map(() => 1);
  for (let index = 0; index < rows.length; index += 1) {
    const value = rows[index]?.[0]?.trim() ?? "";
    if (!value) {
      spans[index] = 0;
      continue;
    }
    let span = 1;
    for (let next = index + 1; next < rows.length; next += 1) {
      if ((rows[next]?.[0] ?? "").trim()) break;
      span += 1;
    }
    spans[index] = span;
  }
  return spans;
}

function formatReportDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "확정시각 확인 불가";
  return date.toLocaleString("ko-KR");
}
