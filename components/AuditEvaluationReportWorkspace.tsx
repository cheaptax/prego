"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { getCmsMessage } from "@/lib/cms/runtime";
import {
  reportTableCellClassName,
  type AuditEvaluationReportBlockViewModel,
  type AuditEvaluationReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import type { NhAuditReportPreview } from "@/lib/audit-evaluation/nh-audit-report-snapshot";
import {
  createDefaultNhAuditCustomerWeightsV2,
  validateNhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-schemas";
import {
  NH_AUDIT_QUALITY_CRITERION_IDS,
  type NhAuditCustomerWeightsV2,
} from "@/lib/audit-evaluation/nh-audit-v2-types";
import { ExternalManualQuotesPanel } from "@/components/ExternalManualQuotesPanel";

type ReportStatus =
  | "NOT_REQUESTED"
  | "PENDING"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED";

type ReportWorkspaceData = {
  reportVersion: number | null;
  confirmationVersion: number | null;
  status: ReportStatus;
  requestedAt: string | null;
  generatedAt: string | null;
  failureCode: string | null;
  downloadAvailable: boolean;
  downloadExpiresAt: string | null;
  viewModel: AuditEvaluationReportViewModel | null;
  nhAuditEvaluation: NhAuditReportPreview | null;
  versions: Array<{
    reportVersion: number;
    confirmationVersion: number;
    status: Exclude<ReportStatus, "NOT_REQUESTED">;
    requestedAt: string | null;
    generatedAt: string | null;
  }>;
};

export function AuditEvaluationReportWorkspace({
  caseId,
  content,
  section,
}: {
  caseId: string;
  content: CmsPageContent;
  section: CmsSection;
}) {
  const [data, setData] = useState<ReportWorkspaceData | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [action, setAction] = useState<
    | "idle"
    | "previewing"
    | "applying"
    | "retrying"
    | "downloading"
    | "error"
  >("idle");
  const [weights, setWeights] = useState<NhAuditCustomerWeightsV2>(
    createDefaultNhAuditCustomerWeightsV2,
  );
  const [preview, setPreview] = useState<NhAuditReportPreview | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const previewSequence = useRef(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const livePreviewActiveRef = useRef(false);
  const weightValidation = useMemo(
    () => validateNhAuditCustomerWeightsV2(weights),
    [weights],
  );
  const confirmationVersion = data?.confirmationVersion ?? null;

  const refreshPreview = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!confirmationVersion || !weightValidation.success) return false;
      const sequence = ++previewSequence.current;
      if (!options?.quiet) setAction("previewing");
      const result = await loadNhAuditPreview(
        caseId,
        confirmationVersion,
        weightValidation.data,
      );
      if (sequence !== previewSequence.current) return false;
      if (!result) {
        if (!options?.quiet) setAction("error");
        return false;
      }
      livePreviewActiveRef.current = true;
      setPreview(result);
      if (!options?.quiet) setAction("idle");
      return true;
    },
    [caseId, confirmationVersion, weightValidation],
  );

  useEffect(() => {
    let cancelled = false;
    const sequence = ++requestSequence.current;
    const refresh = async () => {
      const result = await loadReport(caseId, selectedVersion);
      if (
        cancelled ||
        sequence !== requestSequence.current ||
        result === null
      ) {
        if (!cancelled && result === null) setAction("error");
        return;
      }
      setData((current) => {
        const keepPreviousReport =
          (result.status === "PENDING" || result.status === "GENERATING") &&
          result.viewModel === null &&
          current?.viewModel;
        return keepPreviousReport
          ? { ...result, viewModel: current.viewModel }
          : result;
      });
      if (result.nhAuditEvaluation) {
        setWeights(result.nhAuditEvaluation.weights);
        // 비제휴 추가 후 실시간 미리보기를 확정 스냅샷으로 덮어쓰지 않음
        if (!livePreviewActiveRef.current) {
          setPreview(result.nhAuditEvaluation);
        }
      } else if (result.reportVersion !== null) {
        setWeights(createDefaultNhAuditCustomerWeightsV2());
        if (!livePreviewActiveRef.current) {
          setPreview(null);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (data?.status === "PENDING" || data?.status === "GENERATING") {
        void refresh();
      }
    }, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [caseId, data?.status, selectedVersion]);

  useEffect(() => {
    if (!confirmationVersion || !weightValidation.success) return;
    const timer = window.setTimeout(() => {
      void refreshPreview({ quiet: true });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    caseId,
    confirmationVersion,
    weightValidation,
    previewRevision,
    refreshPreview,
  ]);

  async function handleExternalQuotesChanged() {
    livePreviewActiveRef.current = true;
    setPreviewRevision((current) => current + 1);
    await refreshPreview();
  }

  async function applyReport() {
    if (
      !confirmationVersion ||
      !weightValidation.success ||
      !preview ||
      action === "applying" ||
      data?.status === "PENDING" ||
      data?.status === "GENERATING"
    ) {
      return;
    }
    setApplyNotice(null);
    setAction("applying");
    const response = await fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmationVersion,
          weights: weightValidation.data,
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setAction("error");
      return;
    }
    const payload = (await response.json().catch(() => null)) as {
      reportVersion?: number;
      status?: ReportStatus;
      replayed?: boolean;
    } | null;
    if (payload?.replayed) {
      setApplyNotice(
        "견적과 배점이 기존 보고서와 같아 보고서를 다시 만들지 않았습니다.",
      );
      setAction("idle");
      return;
    }
    livePreviewActiveRef.current = false;
    setData((current) =>
      current
        ? {
            ...current,
            reportVersion: payload?.reportVersion ?? current.reportVersion,
            status: payload?.status ?? "PENDING",
            nhAuditEvaluation: preview,
          }
        : current,
    );
    setAction("idle");
  }

  async function retry() {
    if (!data?.confirmationVersion || action === "retrying") return;
    setAction("retrying");
    const response = await fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmationVersion: data.confirmationVersion,
          weights:
            data.nhAuditEvaluation?.weights ??
            createDefaultNhAuditCustomerWeightsV2(),
        }),
      },
    ).catch(() => null);
    if (!response?.ok) {
      setAction("error");
      return;
    }
    setData((current) =>
      current
        ? { ...current, status: "PENDING", failureCode: null }
        : current
    );
    setAction("idle");
  }

  function download() {
    if (!data?.reportVersion || !data.downloadAvailable) return;
    setAction("downloading");
    window.location.assign(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports/${data.reportVersion}/download`,
    );
    window.setTimeout(() => setAction("idle"), 3_000);
  }

  function printPdf() {
    if (!data?.reportVersion || !data.downloadAvailable) return;
    setAction("downloading");
    const url =
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports/${data.reportVersion}/download?inline=1`;
    // noopener를 features에 넣으면 window.open이 null을 반환해 현재 창으로 이동하는
    // fallback이 실행되므로, 새 창을 연 뒤 opener만 끊는다.
    const opened = window.open(url, "_blank");
    if (opened) {
      opened.opener = null;
    } else {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }
    window.setTimeout(() => setAction("idle"), 3_000);
  }

  if (!data) {
    return (
      <p role="status">
        {getCmsMessage(content, "event.auditQuoteEvaluationReport", "loading")}
      </p>
    );
  }

  const statusMessage = getCmsMessage(
    content,
    "event.auditQuoteEvaluationReport",
    statusMessageKey(data.status),
  );
  const latestVersion = data.versions[0]?.reportVersion ?? null;
  const downloadExpired =
    data.status === "COMPLETED" &&
    data.downloadExpiresAt !== null &&
    !data.downloadAvailable;
  return (
    <div className="audit-report-workspace">
      <div className="audit-report-workspace__status" aria-live="polite">
        <div>
          <h3>{section.title}</h3>
          <p>{statusMessage}</p>
        </div>
        {data.versions.length > 1 ? (
          <label>
            {section.text.versionLabel}
            <select
              value={selectedVersion ?? data.reportVersion ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setSelectedVersion(Number.isInteger(value) ? value : null);
              }}
            >
              {data.versions.map((version) => (
                <option
                  key={version.reportVersion}
                  value={version.reportVersion}
                >
                  v{version.reportVersion} · {version.status}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {data.confirmationVersion &&
      (data.reportVersion === null || data.nhAuditEvaluation) ? (
        <>
          <ExternalManualQuotesPanel
            caseId={caseId}
            targetCooperativeName={
              data.viewModel?.metadata.cooperative.name || undefined
            }
            fiscalYear={data.viewModel?.metadata.fiscalYear || undefined}
            onChanged={() => handleExternalQuotesChanged()}
          />
          <NhAuditWeightEditor
            weights={weights}
            preview={weightValidation.success ? preview : null}
            locked={false}
            busy={
              action === "applying" ||
              data.status === "PENDING" ||
              data.status === "GENERATING"
            }
            text={section.text}
            applyLabel={
              data.reportVersion !== null
                ? (section.text.reapplyWeightsLabel ??
                  "변경 견적으로 보고서 다시 확정")
                : undefined
            }
            onChange={setWeights}
            onApply={() => void applyReport()}
          />
          {applyNotice ? (
            <p role="status">{applyNotice}</p>
          ) : null}
        </>
      ) : null}

      {(data.status === "PENDING" || data.status === "GENERATING") && (
        <progress
          aria-label={statusMessage}
          max={100}
          value={data.status === "PENDING" ? 25 : 70}
        />
      )}

      {data.status === "FAILED" && data.reportVersion === latestVersion ? (
        <button
          type="button"
          className="cta cta--solid"
          disabled={action === "retrying"}
          onClick={() => void retry()}
        >
          {action === "retrying"
            ? section.text.retryingLabel
            : section.text.retryLabel}
        </button>
      ) : null}

      {data.viewModel ? (
        <>
          {data.status === "PENDING" || data.status === "GENERATING" ? (
            <p role="status">
              새 PDF를 만드는 동안 이전 보고서를 보여 줍니다. 완료되면 자동으로
              바뀝니다.
            </p>
          ) : null}
          <div className="audit-report-workspace__actions">
            <button
              type="button"
              className="cta cta--solid"
              disabled={
                !data.downloadAvailable ||
                action === "downloading" ||
                !weightValidation.success
              }
              aria-describedby={
                downloadExpired ? "audit-report-download-expiry" : undefined
              }
              onClick={download}
            >
              {action === "downloading"
                ? section.text.downloadingLabel
                : section.text.downloadLabel}
            </button>
            <button
              type="button"
              className="cta cta--ghost audit-report-workspace__print"
              disabled={
                !data.downloadAvailable ||
                action === "downloading" ||
                !weightValidation.success
              }
              onClick={printPdf}
            >
              인쇄하기
            </button>
            {downloadExpired ? (
              <p id="audit-report-download-expiry" role="status">
                {section.text.downloadExpiredLabel ??
                  "고객 다운로드 기간이 만료되었습니다."}
                {data.downloadExpiresAt
                  ? ` (${formatDownloadExpiry(data.downloadExpiresAt)})`
                  : ""}
              </p>
            ) : null}
          </div>
          <ReportView viewModel={data.viewModel} />
        </>
      ) : null}

      {action === "error" ? (
        <p role="alert">
          {getCmsMessage(
            content,
            "event.auditQuoteEvaluationReport",
            "reportActionFailed",
          )}
        </p>
      ) : null}
    </div>
  );
}

const NH_QUALITY_WEIGHT_FIELDS = [
  {
    id: "LOCAL_NONGHYUP_AUDIT_COUNT_2025",
    labelKey: "auditCountWeightLabel",
    defaultValue: 30,
    minimum: 20,
    maximum: 40,
  },
  {
    id: "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT",
    labelKey: "cpaCountWeightLabel",
    defaultValue: 20,
    minimum: 10,
    maximum: 30,
  },
  {
    id: "ACCOUNTING_FIRM_REVENUE",
    labelKey: "revenueWeightLabel",
    defaultValue: 20,
    minimum: 10,
    maximum: 30,
  },
  {
    id: "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025",
    labelKey: "typeDiversityWeightLabel",
    defaultValue: 10,
    minimum: 0,
    maximum: 20,
  },
  {
    id: "NONGHYUP_TAX_AGENCY_PERFORMED_2025",
    labelKey: "taxAgencyWeightLabel",
    defaultValue: 10,
    minimum: 0,
    maximum: 20,
  },
  {
    id: "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025",
    labelKey: "subsidyWeightLabel",
    defaultValue: 10,
    minimum: 0,
    maximum: 20,
  },
] as const;

function NhAuditWeightEditor({
  weights,
  preview,
  locked,
  busy,
  text,
  applyLabel,
  onChange,
  onApply,
}: {
  weights: NhAuditCustomerWeightsV2;
  preview: NhAuditReportPreview | null;
  locked: boolean;
  busy: boolean;
  text: CmsSection["text"];
  applyLabel?: string;
  onChange: (weights: NhAuditCustomerWeightsV2) => void;
  onApply: () => void;
}) {
  const total = NH_AUDIT_QUALITY_CRITERION_IDS.reduce(
    (sum, id) => sum + weights.qualityCriterionWeights[id],
    0,
  );
  const valid = validateNhAuditCustomerWeightsV2(weights).success;
  const totalMessage =
    total === 100
      ? text.qualityWeightTotalValidLabel
      : total < 100
        ? `${text.qualityWeightShortageLabel} ${100 - total}${text.pointUnitLabel}`
        : `${text.qualityWeightExcessLabel} ${total - 100}${text.pointUnitLabel}`;
  const defaults = createDefaultNhAuditCustomerWeightsV2();
  const usesDefaultWeights =
    preview?.usesDefaultWeights ??
    (
      weights.qualityWeightPercent === defaults.qualityWeightPercent &&
      weights.priceWeightPercent === defaults.priceWeightPercent &&
      NH_AUDIT_QUALITY_CRITERION_IDS.every(
        (id) =>
          weights.qualityCriterionWeights[id] ===
          defaults.qualityCriterionWeights[id],
      )
    );
  const guidance = usesDefaultWeights
    ? text.defaultWeightsGuidanceLabel
    : text.customWeightsGuidanceLabel;
  return (
    <section
      className="nh-audit-report-settings"
      aria-labelledby="nh-audit-report-settings-title"
    >
      <div className="nh-audit-report-settings__head">
        <div>
          <h3 id="nh-audit-report-settings-title">
            {text.weightSettingsTitle}
          </h3>
          <p>{text.weightSettingsDescription}</p>
        </div>
        {locked ? (
          <span className="nh-audit-status-badge">
            {text.weightsFinalizedLabel}
          </span>
        ) : null}
      </div>

      <div className="nh-audit-report-settings__group">
        <div className="nh-audit-report-settings__group-head">
          <div>
            <h4>{text.compositeWeightTitle}</h4>
            <p aria-live="polite">
              {text.qualityLabel} {weights.qualityWeightPercent}% ·{" "}
              {text.priceLabel} {weights.priceWeightPercent}%
            </p>
          </div>
          <button
            type="button"
            className="cta cta--ghost"
            disabled={locked}
            onClick={() =>
              onChange({
                ...weights,
                qualityWeightPercent: 60,
                priceWeightPercent: 40,
              })
            }
          >
            {text.resetCompositeWeightsLabel}
          </button>
        </div>
        <input
          className="nh-audit-report-settings__slider"
          type="range"
          min={40}
          max={80}
          step={1}
          value={weights.qualityWeightPercent}
          disabled={locked}
          aria-label={text.compositeWeightSliderAriaLabel}
          aria-valuetext={`${text.qualityLabel} ${weights.qualityWeightPercent}%, ${text.priceLabel} ${weights.priceWeightPercent}%`}
          onChange={(event) => {
            const qualityWeightPercent = Number(event.target.value);
            onChange({
              ...weights,
              qualityWeightPercent,
              priceWeightPercent: 100 - qualityWeightPercent,
            });
          }}
        />
        <div className="nh-audit-report-settings__range" aria-hidden="true">
          <span>{text.qualityWeightMinimumLabel}</span>
          <span>{text.qualityWeightMaximumLabel}</span>
        </div>
      </div>

      <div className="nh-audit-report-settings__group">
        <div className="nh-audit-report-settings__group-head">
          <div>
            <h4>{text.qualityCriterionWeightsTitle}</h4>
            <p
              className={total === 100 ? "" : "form-error"}
              role={total === 100 ? "status" : "alert"}
              aria-live="polite"
            >
              {text.qualityWeightTotalLabel} {total}/100{text.pointUnitLabel}
              {total === 100 ? "" : ` · ${totalMessage}`}
            </p>
          </div>
          <button
            type="button"
            className="cta cta--ghost"
            disabled={locked}
            onClick={() => {
              const defaults = createDefaultNhAuditCustomerWeightsV2();
              onChange({
                ...weights,
                qualityCriterionWeights:
                  defaults.qualityCriterionWeights,
              });
            }}
          >
            {text.resetQualityWeightsLabel}
          </button>
        </div>
        <div className="nh-audit-report-settings__criteria">
          {NH_QUALITY_WEIGHT_FIELDS.map((field) => (
            <label key={field.id}>
              <span>{text[field.labelKey]}</span>
              <small>
                {text.defaultValueLabel} {field.defaultValue}
                {text.pointUnitLabel} · {text.allowedRangeLabel}{" "}
                {field.minimum}~{field.maximum}{text.pointUnitLabel}
              </small>
              <span className="nh-audit-number-with-unit">
                <input
                  type="number"
                  inputMode="numeric"
                  min={field.minimum}
                  max={field.maximum}
                  step={1}
                  value={weights.qualityCriterionWeights[field.id]}
                  disabled={locked}
                  aria-label={`${text[field.labelKey]} ${field.minimum}~${field.maximum}${text.pointUnitLabel}`}
                  onChange={(event) =>
                    onChange({
                      ...weights,
                      qualityCriterionWeights: {
                        ...weights.qualityCriterionWeights,
                        [field.id]: Number(event.target.value),
                      },
                    })
                  }
                />
                <span>{text.pointUnitLabel}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <p className="nh-audit-report-settings__guidance">{guidance}</p>
      {!locked ? (
        <button
          type="button"
          className="cta cta--solid"
          disabled={!valid || !preview || busy}
          onClick={onApply}
        >
          {busy ? text.applyingWeightsLabel : applyLabel || text.applyWeightsLabel}
        </button>
      ) : null}

      {preview ? (
        <NhAuditRankingPreview preview={preview} text={text} />
      ) : (
        <p role="status">
          {valid
            ? text.previewLoadingLabel
            : text.invalidWeightsPreviewBlockedLabel}
        </p>
      )}
    </section>
  );
}

function NhAuditRankingPreview({
  preview,
  text,
}: {
  preview: NhAuditReportPreview;
  text: CmsSection["text"];
}) {
  return (
    <div className="nh-audit-report-preview">
      <h4>{text.rankingPreviewTitle}</h4>
      <div className="nh-audit-report-preview__table-wrap">
        <table>
          <thead>
            <tr>
              <th className="is-frozen-1">{text.accountingFirmLabel}</th>
              <th className="is-frozen-2 is-total-burden">
                {text.overallScoreLabel}
              </th>
              <th className="is-frozen-3 is-total-burden">
                {text.totalBurdenLabel}
              </th>
              <th>{text.finalRankLabel}</th>
              {NH_QUALITY_WEIGHT_FIELDS.map((field) => (
                <th key={field.id}>{text[field.labelKey]}</th>
              ))}
              <th>{text.qualityRawScoreLabel}</th>
              <th>{text.priceBaseScoreLabel}</th>
              <th>{text.weightedQualityScoreLabel}</th>
              <th>{text.weightedPriceScoreLabel}</th>
              <th>{text.eligibilityStatusLabel}</th>
            </tr>
          </thead>
          <tbody>
            {preview.quoteResults.map((result) => {
              const criterionScores = new Map(
                result.criteria.map((criterion) => [
                  criterion.criterionId,
                  criterion.earnedScoreOneDecimal,
                ]),
              );
              return (
                <tr key={result.quoteId}>
                  <th scope="row" className="is-frozen-1">
                    {result.accountingFirmName}
                    {result.lowPriceEngagementRisk ? (
                      <span className="nh-audit-low-price-risk">
                        {text.lowPriceEngagementRiskLabel ??
                          "저가부실수임 우려"}
                      </span>
                    ) : null}
                  </th>
                  <td className="is-frozen-2 is-total-burden">
                    {scoreLabel(result.overallScoreOneDecimal)}
                  </td>
                  <td className="is-frozen-3 is-total-burden">
                    {formatWon(result.expectedTotalBurdenWon)}
                  </td>
                  <td>
                    {result.rank === null
                      ? result.eligibilityStatus === "INELIGIBLE" ||
                        result.proposerType === "AUDIT_GROUP"
                        ? `${text.ineligibleStatusLabel || "부적격"} · ${text.notRankedLabel || "순위외"}`
                        : text.notRankedLabel
                      : `${result.rank}${text.rankUnitLabel}`}
                  </td>
                  {NH_QUALITY_WEIGHT_FIELDS.map((field) => (
                    <td key={field.id}>
                      {criterionScores.get(field.id) ?? "-"}
                    </td>
                  ))}
                  <td>{scoreLabel(result.qualityScoreOneDecimal)}</td>
                  <td>{scoreLabel(result.priceBaseScoreOneDecimal)}</td>
                  <td>
                    {scoreLabel(result.weightedQualityScoreOneDecimal)}
                  </td>
                  <td>{scoreLabel(result.weightedPriceScoreOneDecimal)}</td>
                  <td
                    className={
                      result.lowPriceEngagementRisk ? "is-low-price-risk" : undefined
                    }
                  >
                    {result.proposerType === "AUDIT_GROUP"
                      ? `${eligibilityLabel(result.eligibilityStatus, text, result.lowPriceEngagementRisk)}(감사반)`
                      : eligibilityLabel(
                          result.eligibilityStatus,
                          text,
                          result.lowPriceEngagementRisk,
                        )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportView({
  viewModel,
}: {
  viewModel: AuditEvaluationReportViewModel;
}) {
  const brandStyle = {
    "--report-primary": viewModel.metadata.branding.primaryColor,
    "--report-accent": viewModel.metadata.branding.accentColor,
  } as CSSProperties & {
    "--report-primary": string;
    "--report-accent": string;
  };
  return (
    <article
      className="audit-report-document"
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
              viewModel.metadata.finalizedAt ??
                viewModel.metadata.generatedAt,
            )}
          </p>
        </div>
      </header>
      {viewModel.sections.map((section) => (
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
          {block.items.map((item, index) => <li key={index}>{item}</li>)}
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

/** 빈 첫 열은 위 행과 같은 회계법인으로 보고 rowspan 계산 */
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

async function loadNhAuditPreview(
  caseId: string,
  confirmationVersion: number,
  weights: NhAuditCustomerWeightsV2,
) {
  const response = await fetch(
    `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationVersion, weights }),
    },
  ).catch(() => null);
  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as {
    ok?: boolean;
    preview?: NhAuditReportPreview;
  } | null;
  return payload?.ok && payload.preview ? payload.preview : null;
}

function scoreLabel(value: string | null) {
  return value === null ? "-" : `${value}점`;
}

function formatWon(value: string | null) {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return "-";
  return `${BigInt(value).toLocaleString("ko-KR")}원`;
}

function eligibilityLabel(
  status: NhAuditReportPreview["quoteResults"][number]["eligibilityStatus"],
  text: CmsSection["text"],
  lowPriceEngagementRisk?: boolean,
) {
  if (status === "ELIGIBLE" && lowPriceEngagementRisk) {
    return text.eligibleLowPriceRiskStatusLabel || "우려";
  }
  if (status === "ELIGIBLE") return text.eligibleStatusLabel;
  if (status === "INELIGIBLE") return text.ineligibleStatusLabel;
  if (status === "RESUBMISSION_REQUIRED") {
    return text.resubmissionRequiredStatusLabel;
  }
  return text.excludedStatusLabel;
}

async function loadReport(caseId: string, version: number | null) {
  const query = version === null ? "" : `?version=${version}`;
  const response = await fetch(
    `/api/audit-evaluations/${encodeURIComponent(caseId)}/reports${query}`,
    { cache: "no-store" },
  ).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    report?: ReportWorkspaceData;
  } | null;
  return payload?.ok && payload.report ? payload.report : null;
}

function statusMessageKey(status: ReportStatus) {
  if (status === "NOT_REQUESTED") return "notReady";
  if (status === "PENDING") return "queued";
  if (status === "GENERATING") return "generating";
  if (status === "FAILED") return "generationFailed";
  return "ready";
}

function formatDownloadExpiry(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "만료 시각 미확인";
  return `${date.toLocaleDateString("ko-KR")}까지`;
}

function formatReportDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "확정시각 확인 불가";
  return date.toLocaleString("ko-KR");
}
