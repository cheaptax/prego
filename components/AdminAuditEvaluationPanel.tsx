"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminOperationsCopy,
  type AdminOperationsCopy,
} from "@/lib/cms/admin-operations-content";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getFirebaseAuth } from "@/lib/firebase/client";

type Props = {
  content: CmsPageContent;
  previewMode?: boolean;
  onMessage: (message: {
    tone: "info" | "success" | "error";
    text: string;
  }) => void;
};

type AdminMenu = "cases" | "criteria" | "report" | "errors" | "logs";
type JsonRecord = Record<string, unknown>;
type LoadState = "idle" | "loading" | "ready" | "error" | "denied";
type ConfirmationAction =
  | "reprocess"
  | "regenerate"
  | "reissue"
  | "retention";

type CaseRow = {
  id: string;
  reference: string;
  cooperativeName: string;
  fiscalYear: string;
  status: string;
  documentCount: number;
  customerConfirmationStatus: string;
  hasError: boolean;
  reportCompleted: boolean;
  reportGeneratedAt: string;
  createdAt: string;
  updatedAt: string;
  raw: JsonRecord;
};

type ConfigCriterion = {
  id: string;
  name: string;
  weight: number;
  help: string;
  raw: JsonRecord;
};

type ReportSectionDraft = {
  id: string;
  title: string;
  visible: boolean;
  order: number;
  locked: boolean;
  raw: JsonRecord;
};

type ConfigDraft = {
  id: string;
  name: string;
  status: string;
  version: string;
  applicationYear: string;
  effectiveFrom: string;
  effectiveTo: string;
  draftRevision: number;
  requiredFields: string[];
  criteria: ConfigCriterion[];
  report: {
    sections: ReportSectionDraft[];
    title: string;
    guidance: string;
    disclaimer: string;
    contact: string;
    logoAssetId: string;
    primaryColor: string;
    accentColor: string;
    watermark: string;
    filenameRule: string;
    downloadDays: number;
  };
  retention: {
    sourceDocumentDays: number;
    normalizedDataDays: number;
    reportDays: number;
    expiredAccessTokenDays: number;
    auditLogDays: number;
    deleteAfterExpiry: boolean;
  };
  raw: JsonRecord;
};

type AssetOption = {
  id: string;
  name: string;
};

type Confirmation = {
  action: ConfirmationAction;
  caseId: string;
  resourceId?: string;
  expectedExpiresAt?: string;
};

const BASE_PATH = "/api/admin/audit-evaluations";
const MENU_IDS: readonly AdminMenu[] = [
  "cases",
  "criteria",
  "report",
  "errors",
  "logs",
];
const CASE_STATUS_VALUES = [
  "",
  "DRAFT",
  "ACCESS_PENDING",
  "UPLOADING",
  "PARSING",
  "NEEDS_REVIEW",
  "READY",
  "GENERATING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;
const FILENAME_RULE_VALUES = [
  "FISCAL_YEAR_VERSION",
  "CASE_VERSION",
] as const;
const NORMALIZED_QUOTE_FIELDS = [
  "accountingFirmId",
  "accountingFirmName",
  "auditFee",
  "vatIncluded",
  "accountingFirmRevenue",
  "recentNonghyupAuditCount",
  "auditedNonghyupTypes",
  "taxAgencyExperience",
  "subsidySettlementExperience",
  "engagementPartner",
  "engagementTeam",
  "totalPlannedHours",
  "partnerHours",
  "auditSchedule",
  "qualityControlPlan",
  "requiredProposalItems",
] as const;

class AdminEvaluationRequestError extends Error {
  constructor(
    readonly code: string,
    readonly payload: JsonRecord = {},
  ) {
    super("Admin audit evaluation request failed");
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordArray(value: unknown): JsonRecord[] {
  return asArray(value).filter(isRecord);
}

function firstValue(record: JsonRecord, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function readString(
  record: JsonRecord,
  keys: readonly string[],
  fallback = "",
): string {
  const value = firstValue(record, keys);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function readNumber(
  record: JsonRecord,
  keys: readonly string[],
  fallback = 0,
): number {
  const value = firstValue(record, keys);
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(
  record: JsonRecord,
  keys: readonly string[],
  fallback = false,
): boolean {
  const value = firstValue(record, keys);
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

function readNestedRecord(
  record: JsonRecord,
  keys: readonly string[],
): JsonRecord {
  for (const key of keys) {
    if (isRecord(record[key])) return record[key];
  }
  return {};
}

function readNestedArray(
  record: JsonRecord,
  keys: readonly string[],
): JsonRecord[] {
  for (const key of keys) {
    const rows = recordArray(record[key]);
    if (rows.length > 0 || Array.isArray(record[key])) return rows;
  }
  return [];
}

function responseRecords(
  response: JsonRecord,
  keys: readonly string[],
): JsonRecord[] {
  for (const key of keys) {
    if (Array.isArray(response[key])) return recordArray(response[key]);
  }
  const data = asRecord(response.data);
  for (const key of keys) {
    if (Array.isArray(data[key])) return recordArray(data[key]);
  }
  return [];
}

function responseRecord(
  response: JsonRecord,
  keys: readonly string[],
): JsonRecord {
  for (const key of keys) {
    if (isRecord(response[key])) return response[key];
  }
  const data = asRecord(response.data);
  for (const key of keys) {
    if (isRecord(data[key])) return data[key];
  }
  return {};
}

type ServerValidationIssue = {
  severity: "error" | "warning";
  path: string;
  message: string;
};

function serverValidationIssues(
  response: JsonRecord,
  fallbackMessage: string,
): ServerValidationIssue[] {
  const validation = responseRecord(response, ["validation"]);
  return readNestedArray(validation, ["issues"]).map((issue) => ({
    severity:
      readString(issue, ["severity"]).toLowerCase() === "warning"
        ? "warning"
        : "error",
    path: readString(issue, ["path"]),
    message: readString(issue, ["message"], fallbackMessage),
  }));
}

async function adminFetch(path: string, init?: RequestInit): Promise<JsonRecord> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new AdminEvaluationRequestError("auth_required");
  const idToken = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  const data = (await response.json().catch(() => null)) as unknown;
  const body = asRecord(data);
  if (!response.ok || body.ok !== true) {
    const code =
      response.status === 401
        ? "unauthorized"
        : response.status === 403
          ? "forbidden"
          : readString(body, ["error", "code"], "request_failed");
    throw new AdminEvaluationRequestError(code, body);
  }
  return body;
}

function normalizeCase(record: JsonRecord, index: number): CaseRow {
  const id = readString(
    record,
    ["caseId", "id", "evaluationCaseId"],
    `case-${index}`,
  );
  return {
    id,
    reference: readString(
      record,
      ["publicReference", "reference", "requestNumber"],
      id,
    ),
    cooperativeName: readString(
      record,
      ["cooperativeName", "organizationName", "customerName"],
      "-",
    ),
    fiscalYear: readString(record, ["fiscalYear", "applicationYear", "year"], "-"),
    status: readString(record, ["status", "processingStatus"], "-"),
    documentCount: readNumber(
      record,
      ["documentCount", "documentsCount", "quoteCount"],
      0,
    ),
    customerConfirmationStatus: readString(
      record,
      ["customerConfirmationStatus"],
      "NOT_STARTED",
    ),
    hasError: readBoolean(record, ["hasError", "error"], false),
    reportCompleted: readBoolean(
      record,
      ["reportCompleted", "hasCompletedReport"],
      false,
    ),
    reportGeneratedAt: readString(record, ["reportGeneratedAt"], ""),
    createdAt: readString(record, ["createdAt", "requestedAt"], ""),
    updatedAt: readString(record, ["updatedAt", "modifiedAt"], ""),
    raw: record,
  };
}

function normalizeCriterion(record: JsonRecord, index: number): ConfigCriterion {
  return {
    id: readString(record, ["id", "criterionId"], `criterion-${index + 1}`),
    name: readString(record, ["name", "title", "label"]),
    weight:
      readNumber(record, ["weightBasisPoints"], Number.NaN) / 100 ||
      readNumber(record, ["weight"], 0),
    help: readString(record, ["help", "description", "guidance"]),
    raw: record,
  };
}

function normalizeConfig(record: JsonRecord, index: number): ConfigDraft {
  const report = readNestedRecord(record, ["report", "reportSettings"]);
  const sectionsFromConfig = readNestedArray(record, ["reportSections"]);
  const sections =
    sectionsFromConfig.length > 0
      ? sectionsFromConfig
      : readNestedArray(report, ["sections", "reportSections"]);
  const phrases = readNestedArray(record, ["reportPhrases"]);
  const rendering = readNestedRecord(record, ["reportRenderingPolicy"]);
  const retention = readNestedRecord(record, ["retentionPolicy"]);
  const guidancePhrase =
    phrases.find((phrase) =>
      ["decision-support", "report-purpose", "guidance"].includes(
        readString(phrase, ["id"]),
      ),
    ) ?? {};
  const disclaimerPhrase =
    phrases.find((phrase) =>
      readString(phrase, ["id"]).includes("disclaimer"),
    ) ?? {};
  const effectiveFrom = readString(record, ["effectiveFrom", "startDate"], "");
  const effectiveTo = readString(record, ["effectiveTo", "endDate"], "");
  return {
    id: readString(record, ["configId", "id"], `config-${index}`),
    name: readString(record, ["name", "title"], "-"),
    status: readString(record, ["status"], "DRAFT").toUpperCase(),
    version: readString(record, ["version", "versionLabel"], "-"),
    applicationYear: readString(
      record,
      ["applicationYear", "fiscalYear"],
      effectiveFrom.slice(0, 4),
    ),
    effectiveFrom: effectiveFrom.slice(0, 10),
    effectiveTo: effectiveTo.slice(0, 10),
    draftRevision: readNumber(record, ["draftRevision"], 1),
    requiredFields: asArray(record.requiredFields).filter(
      (value): value is string => typeof value === "string",
    ),
    criteria: readNestedArray(record, ["criteria", "evaluationCriteria"]).map(
      normalizeCriterion,
    ),
    report: {
      sections: sections.map((section, sectionIndex) => ({
        id: readString(
          section,
          ["id", "sectionId"],
          `section-${sectionIndex + 1}`,
        ),
        title: readString(section, ["title", "name", "label"], "-"),
        visible: readBoolean(section, ["visible", "enabled"], true),
        order: readNumber(section, ["order", "position"], sectionIndex + 1),
        locked:
          readBoolean(section, ["locked", "mandatory"], false) ||
          ["COVER", "PURPOSE_SCOPE", "OVERALL_OPINION", "APPENDIX"].includes(
            readString(section, ["type"]),
          ),
        raw: section,
      })),
      title: readString(
        rendering,
        ["reportTitle"],
        readString(report, ["title", "reportTitle"]),
      ),
      guidance: readString(
        guidancePhrase,
        ["text"],
        readString(report, ["guidance", "guidancePhrase"]),
      ),
      disclaimer: readString(
        disclaimerPhrase,
        ["text"],
        readString(report, ["disclaimer"]),
      ),
      contact: readString(
        rendering,
        ["centerContact"],
        readString(report, ["contact", "contactText"]),
      ),
      logoAssetId: readString(
        rendering,
        ["logoAssetId"],
        readString(report, ["logoAssetId"]),
      ),
      primaryColor: readString(
        rendering,
        ["primaryColor"],
        readString(report, ["primaryColor"], "#166534"),
      ),
      accentColor: readString(
        rendering,
        ["accentColor"],
        readString(report, ["accentColor"], "#d97706"),
      ),
      watermark: readString(
        rendering,
        ["watermarkText"],
        readString(report, ["watermark"]),
      ),
      filenameRule: readString(
        rendering,
        ["fileNameRule"],
        readString(report, ["filenameRule"], "CASE_VERSION"),
      ),
      downloadDays: readNumber(
        rendering,
        ["customerDownloadDays"],
        readNumber(report, ["downloadDays", "downloadWindowDays"], 30),
      ),
    },
    retention: {
      sourceDocumentDays: readNumber(retention, ["sourceDocumentDays"], 365),
      normalizedDataDays: readNumber(retention, ["normalizedDataDays"], 365),
      reportDays: readNumber(retention, ["reportDays"], 1_825),
      expiredAccessTokenDays: readNumber(
        retention,
        ["expiredAccessTokenDays"],
        30,
      ),
      auditLogDays: readNumber(retention, ["auditLogDays"], 2_555),
      deleteAfterExpiry: readBoolean(
        retention,
        ["deleteAfterExpiry"],
        false,
      ),
    },
    raw: record,
  };
}

function configKey(config: Pick<ConfigDraft, "id" | "version">) {
  return `${config.id}::${config.version}`;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ko-KR");
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "boolean") return value ? "✓" : "—";
  if (typeof value === "number") return value.toLocaleString("ko-KR");
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) =>
        typeof entry === "string" || typeof entry === "number"
          ? String(entry)
          : "",
      )
      .filter(Boolean)
      .join(", ") || "-";
  }
  return "-";
}

function toFilterInstant(value: string, endOfDay = false): string {
  if (!value) return "";
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(`${value.slice(0, 10)}${suffix}`);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toConfigInstant(value: string): string | null {
  return value ? toFilterInstant(value) : null;
}

function extractedValueRows(detail: JsonRecord): JsonRecord[] {
  const direct = readNestedArray(detail, [
    "extractedValues",
    "extractions",
    "values",
  ]);
  if (direct.length > 0) return direct;
  return readNestedArray(detail, ["normalizedQuotes", "quotes"]).flatMap(
    (quote) => {
      const evidenceByField = readNestedRecord(quote, ["evidenceByField"]);
      const revision = readNumber(quote, ["revision"], 0);
      const quoteId = readString(quote, ["quoteId", "id"]);
      return NORMALIZED_QUOTE_FIELDS.flatMap((field) => {
        const value = quote[field];
        if (value === undefined) return [];
        const evidence =
          recordArray(evidenceByField[field])[0] ?? {};
        return [
          {
            field,
            value,
            valueType:
              typeof value === "number"
                ? "number"
                : typeof value === "boolean"
                  ? "boolean"
                  : "text",
            evidence: readString(evidence, ["excerpt", "sourceText"]),
            page: firstValue(evidence, ["pageNumber", "page"]),
            quoteId,
            revision,
          },
        ];
      });
    },
  );
}

function scoreRows(detail: JsonRecord): JsonRecord[] {
  const direct = readNestedArray(detail, ["scoreDetails", "scores"]);
  if (direct.length > 0) return direct;
  const latest = readNestedRecord(detail, ["latestEvaluation"]);
  const breakdown = readNestedRecord(latest, ["scoreBreakdown"]);
  return readNestedArray(breakdown, ["quotes"]).flatMap((quote) =>
    readNestedArray(quote, ["criteria"]).map((criterion) => ({
      ...criterion,
      criterion: readString(criterion, ["criterion", "criterionId", "name"]),
      score:
        readNumber(criterion, ["scoreBasisPoints"], 0) / 100,
      weight:
        readNumber(criterion, ["maximumBasisPoints"], 0) / 100,
      note: displayValue(firstValue(criterion, ["reasons", "missingFields"])),
    })),
  );
}

function feeRows(detail: JsonRecord): JsonRecord[] {
  const direct = readNestedArray(detail, ["feeAnalysis", "fees"]);
  if (direct.length > 0) return direct;
  const latest = readNestedRecord(detail, ["latestEvaluation"]);
  const analysis = readNestedRecord(latest, ["feeAnalysis"]);
  return readNestedArray(analysis, ["quotes", "items", "results"]);
}

function safeInternalDetail(record: JsonRecord): string {
  const detail = firstValue(record, ["internalDetail", "summary"]);
  if (typeof detail === "string") return detail;
  const value = asRecord(detail);
  return [
    readString(value, ["code"]),
    readString(value, ["failureMessage", "message"]),
  ]
    .filter(Boolean)
    .join(" · ") || "-";
}

function actorLabel(value: unknown): string {
  if (typeof value === "string") return value;
  const actor = asRecord(value);
  return readString(actor, ["uid", "subjectId", "service", "type"], "-");
}

function targetLabel(value: unknown): string {
  if (typeof value === "string") return value;
  const target = asRecord(value);
  return [
    readString(target, ["caseId"]),
    readString(target, ["documentId"]),
    readString(target, ["reportVersion"]),
  ]
    .filter(Boolean)
    .join(" · ") || "-";
}

function strictComparableValue(value: JsonRecord): JsonRecord {
  const kind = readString(value, ["kind"], "INTEGER");
  return {
    kind,
    value:
      kind === "INTEGER"
        ? readNumber(value, ["value"], 0)
        : kind === "BOOLEAN"
          ? readBoolean(value, ["value"], false)
          : readString(value, ["value"]),
  };
}

function strictChecklistCondition(condition: JsonRecord): JsonRecord | null {
  const type = readString(condition, ["type"]);
  if (type === "PROPOSAL_ITEM_PRESENT") {
    return { type, itemId: readString(condition, ["itemId"]) };
  }
  if (type === "MINIMUM_INTEGER") {
    return {
      type,
      field: readString(condition, ["field"]),
      minimum: readNumber(condition, ["minimum"], 0),
    };
  }
  if (type === "BOOLEAN_EQUALS") {
    return {
      type,
      field: readString(condition, ["field"]),
      expected: readBoolean(condition, ["expected"], false),
    };
  }
  if (type === "FIELD_PRESENT") {
    return { type, field: readString(condition, ["field"]) };
  }
  return null;
}

function strictRulePayload(rule: JsonRecord): JsonRecord {
  const type = readString(rule, ["type"], "informational-only");
  if (type === "weighted-subcriteria") {
    return {
      type,
      subcriteria: readNestedArray(rule, ["subcriteria"]).map((subcriterion) => ({
        id: readString(subcriterion, ["id"]),
        name: readString(subcriterion, ["name"]),
        relativeWeightBasisPoints: readNumber(
          subcriterion,
          ["relativeWeightBasisPoints"],
          0,
        ),
        rule: strictRulePayload(readNestedRecord(subcriterion, ["rule"])),
      })),
    };
  }
  if (type === "range") {
    return {
      type,
      field: readString(rule, ["field"]),
      bands: readNestedArray(rule, ["bands"]).map((band) => ({
        id: readString(band, ["id"]),
        minimumInclusive: isRecord(band.minimumInclusive)
          ? strictComparableValue(band.minimumInclusive)
          : null,
        maximumExclusive: isRecord(band.maximumExclusive)
          ? strictComparableValue(band.maximumExclusive)
          : null,
        scoreBasisPoints: readNumber(band, ["scoreBasisPoints"], 0),
      })),
    };
  }
  if (type === "checklist") {
    return {
      type,
      field: readString(rule, ["field"]),
      items: readNestedArray(rule, ["items"]).map((item) => {
        const condition = strictChecklistCondition(
          readNestedRecord(item, ["condition"]),
        );
        return {
          id: readString(item, ["id"]),
          label: readString(item, ["label"]),
          required: readBoolean(item, ["required"], false),
          scoreBasisPoints: readNumber(item, ["scoreBasisPoints"], 0),
          ...(condition ? { condition } : {}),
        };
      }),
    };
  }
  if (type === "threshold") {
    return {
      type,
      field: readString(rule, ["field"]),
      operator: readString(rule, ["operator"], "GTE"),
      threshold: strictComparableValue(readNestedRecord(rule, ["threshold"])),
    };
  }
  if (type === "boolean") {
    return {
      type,
      field: readString(rule, ["field"]),
      expected: readBoolean(rule, ["expected"], false),
    };
  }
  return {
    type: "informational-only",
    field: readString(rule, ["field"], "accountingFirmName"),
  };
}

function buildConfigChanges(
  draft: ConfigDraft,
  labels: { guidance: string; disclaimer: string },
) {
  const rawPhrases = readNestedArray(draft.raw, ["reportPhrases"]);
  const guidancePhrase =
    rawPhrases.find((phrase) =>
      ["decision-support", "guidance"].some((candidate) =>
        readString(phrase, ["id"]).includes(candidate),
      ),
    ) ??
    rawPhrases.find((phrase) =>
      readString(phrase, ["id"]).includes("report-purpose"),
    );
  const disclaimerPhrase = rawPhrases.find((phrase) =>
    readString(phrase, ["id"]).includes("disclaimer"),
  );
  const rendering = readNestedRecord(draft.raw, ["reportRenderingPolicy"]);
  const applicationYear = Number(draft.applicationYear);
  const yearIsValid =
    Number.isInteger(applicationYear) &&
    applicationYear >= 2_000 &&
    applicationYear <= 9_999;
  return {
    name: draft.name,
    effectiveFrom: toConfigInstant(
      draft.effectiveFrom ||
        (yearIsValid ? `${applicationYear}-01-01` : ""),
    ),
    effectiveTo: toConfigInstant(
      draft.effectiveTo ||
        (yearIsValid ? `${applicationYear + 1}-01-01` : ""),
    ),
    requiredFields: draft.requiredFields,
    criteria: draft.criteria.map((criterion) => {
      const rawRequired =
        "required" in criterion.raw
          ? { required: readBoolean(criterion.raw, ["required"], false) }
          : {};
      return {
        id: criterion.id,
        name: criterion.name,
        description: criterion.help,
        weightBasisPoints: Math.round(criterion.weight * 100),
        ...rawRequired,
        rule: strictRulePayload(readNestedRecord(criterion.raw, ["rule"])),
      };
    }),
    reportSections: draft.report.sections.map((reportSection) => ({
      ...reportSection.raw,
      id: reportSection.id,
      name: reportSection.title,
      enabled: reportSection.locked ? true : reportSection.visible,
      order: reportSection.order,
    })),
    reportPhrases: [
      ...rawPhrases.map((phrase) => {
        const id = readString(phrase, ["id"]);
        if (guidancePhrase && id === readString(guidancePhrase, ["id"])) {
          return { ...phrase, text: draft.report.guidance };
        }
        if (disclaimerPhrase && id === readString(disclaimerPhrase, ["id"])) {
          return { ...phrase, text: draft.report.disclaimer };
        }
        return phrase;
      }),
      ...(!guidancePhrase
        ? [
            {
              id: "decision-support",
              label: labels.guidance,
              text: draft.report.guidance,
            },
          ]
        : []),
      ...(!disclaimerPhrase
        ? [
            {
              id: "disclaimer",
              label: labels.disclaimer,
              text: draft.report.disclaimer,
            },
          ]
        : []),
    ],
    reportRenderingPolicy: {
      ...rendering,
      watermarkEnabled: Boolean(draft.report.watermark.trim()),
      watermarkText: draft.report.watermark,
      reportTitle: draft.report.title,
      centerContact: draft.report.contact,
      logoAssetId: draft.report.logoAssetId || null,
      primaryColor: draft.report.primaryColor,
      accentColor: draft.report.accentColor,
      fileNameRule: draft.report.filenameRule,
      customerDownloadDays: draft.report.downloadDays,
    },
    retentionPolicy: draft.retention,
  };
}

const previewCaseRecord: JsonRecord = {
  caseId: "preview-case",
  publicReference: "AE-2026-0719",
  cooperativeName: "가람농협",
  fiscalYear: "2026",
  status: "review_required",
  documentCount: 3,
  hasError: true,
  reportCompleted: false,
  createdAt: "2026-07-19T08:30:00.000Z",
  updatedAt: "2026-07-20T02:10:00.000Z",
};

const previewDetail: JsonRecord = {
  ...previewCaseRecord,
  revision: 4,
  documents: [
    {
      documentId: "doc-1",
      name: "한빛회계법인_견적서.pdf",
      status: "ready",
      integrity: "verified",
      issue: "",
    },
    {
      documentId: "doc-2",
      name: "정우회계법인_제안서.pdf",
      status: "review_required",
      integrity: "verified",
      issue: "투입시간 확인 필요",
    },
  ],
  extractedValues: [
    {
      field: "auditFee",
      label: "감사보수",
      value: 18500000,
      valueType: "number",
      evidence: "3쪽 견적금액",
      page: 3,
      revision: 4,
    },
    {
      field: "totalPlannedHours",
      label: "총 예상 투입시간",
      value: 420,
      valueType: "number",
      evidence: "5쪽 인력 투입계획",
      page: 5,
      revision: 4,
    },
  ],
  customerCorrections: [
    {
      fieldLabel: "부가세 포함 여부",
      beforeValue: "미확인",
      afterValue: "별도",
      reason: "고객 확인",
      actor: "고객",
      createdAt: "2026-07-20T01:00:00.000Z",
    },
  ],
  adminCorrections: [],
  scoreDetails: [
    {
      criterion: "감사 수행 경험",
      score: 22,
      weight: 25,
      note: "최근 농협 감사실적 확인",
    },
  ],
  feeAnalysis: [
    {
      firmName: "한빛회계법인",
      fee: 18500000,
      average: 19250000,
      variance: "-3.9%",
    },
  ],
  reportVersions: [
    {
      version: "v1",
      status: "failed",
      createdAt: "2026-07-20T02:00:00.000Z",
    },
  ],
  timeline: [
    {
      action: "문서 검증 완료",
      detail: "견적서 2건",
      actor: "system",
      createdAt: "2026-07-20T01:30:00.000Z",
    },
  ],
  access: {
    status: "active",
    expiresAt: "2026-07-27T08:30:00.000Z",
    issuedAt: "2026-07-19T08:31:00.000Z",
  },
};

const previewConfigRecord: JsonRecord = {
  configId: "preview-config",
  name: "2026 회계감사 평가기준",
  status: "DRAFT",
  version: 3,
  applicationYear: "2026",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  requiredFields: [
    "accountingFirmName",
    "auditFee",
    "accountingFirmRevenue",
    "recentNonghyupAuditCount",
  ],
  criteria: [
    {
      id: "experience",
      name: "감사 수행 경험",
      description: "최근 농협 감사 수행실적을 기준으로 확인합니다.",
      weightBasisPoints: 5_000,
      required: true,
      rule: {
        type: "weighted-subcriteria",
        subcriteria: [
          {
            id: "recent-count",
            name: "최근 수행 건수",
            relativeWeightBasisPoints: 6_000,
            rule: {
              type: "range",
              field: "recentNonghyupAuditCount",
              bands: [
                {
                  id: "low",
                  minimumInclusive: null,
                  maximumExclusive: { kind: "INTEGER", value: 10 },
                  scoreBasisPoints: 0,
                },
                {
                  id: "high",
                  minimumInclusive: { kind: "INTEGER", value: 10 },
                  maximumExclusive: null,
                  scoreBasisPoints: 10_000,
                },
              ],
            },
          },
          {
            id: "revenue",
            name: "회계법인 매출액",
            relativeWeightBasisPoints: 4_000,
            rule: {
              type: "threshold",
              field: "accountingFirmRevenue",
              operator: "GTE",
              threshold: { kind: "DECIMAL_STRING", value: "5000000000" },
            },
          },
        ],
      },
    },
    {
      id: "proposal",
      name: "제안서 충실성",
      description: "필수 제안항목 제출 여부를 확인합니다.",
      weightBasisPoints: 5_000,
      required: true,
      rule: {
        type: "checklist",
        field: "requiredProposalItems",
        items: [
          {
            id: "schedule",
            label: "감사 일정 제출",
            required: true,
            scoreBasisPoints: 10_000,
            condition: {
              type: "PROPOSAL_ITEM_PRESENT",
              itemId: "audit-schedule",
            },
          },
        ],
      },
    },
  ],
  report: {
    sections: [
      {
        id: "summary",
        title: "평가 요약",
        visible: true,
        order: 1,
        locked: true,
      },
      {
        id: "fee-analysis",
        title: "보수 분석",
        visible: true,
        order: 2,
        locked: false,
      },
    ],
    title: "회계감사 견적 평가보고서",
    guidance: "평가 결과와 원문 견적을 함께 확인해 주세요.",
    disclaimer: "본 보고서는 의사결정 참고자료입니다.",
    contact: "문의: 농협지원센터",
    logoAssetId: "asset-logo",
    primaryColor: "#166534",
    accentColor: "#d97706",
    watermark: "내부 검토용",
    filenameRule: "cooperative-reference",
    downloadDays: 30,
  },
};

const previewErrors: JsonRecord[] = [
  {
    errorId: "error-1",
    type: "document_parse",
    customerImpact: "평가 진행 대기",
    occurredAt: "2026-07-20T02:00:00.000Z",
    retryStatus: "available",
    resolution: "문서 재처리 필요",
    internalDetail: "암호화된 객체 스트림 감지",
    caseId: "preview-case",
    publicReference: "AE-2026-0719",
  },
];

const previewLogs: JsonRecord[] = [
  {
    logId: "log-1",
    action: "admin_correction",
    caseId: "preview-case",
    actor: "audit-admin@example.com",
    target: "감사보수",
    detail: "관리자 정정 저장",
    createdAt: "2026-07-20T02:10:00.000Z",
  },
];

export function AdminAuditEvaluationPanel({
  content,
  previewMode = false,
  onMessage,
}: Props) {
  const copy = useMemo(() => createAdminOperationsCopy(content), [content]);
  const section = copy.section("auditEvaluationAdmin");
  const t = section.text;
  const [menu, setMenu] = useState<AdminMenu>("cases");
  const [caseState, setCaseState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [cases, setCases] = useState<CaseRow[]>(
    previewMode ? [normalizeCase(previewCaseRecord, 0)] : [],
  );
  const [caseFilters, setCaseFilters] = useState({
    status: "",
    fiscalYear: "",
    cooperativeName: "",
    createdFrom: "",
    createdTo: "",
    hasError: "",
    reportCompleted: "",
  });
  const [caseReload, setCaseReload] = useState(0);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(
    previewMode ? "preview-case" : null,
  );
  const [detail, setDetail] = useState<JsonRecord | null>(
    previewMode ? previewDetail : null,
  );
  const [detailState, setDetailState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [correctionField, setCorrectionField] = useState("");
  const [correctionValue, setCorrectionValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [confirmationLoading, setConfirmationLoading] = useState(false);

  const [configState, setConfigState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [configs, setConfigs] = useState<ConfigDraft[]>(
    previewMode ? [normalizeConfig(previewConfigRecord, 0)] : [],
  );
  const [assets, setAssets] = useState<AssetOption[]>(
    previewMode ? [{ id: "asset-logo", name: "농협지원센터 로고" }] : [],
  );
  const [selectedConfigId, setSelectedConfigId] = useState(
    previewMode ? "preview-config::3" : "",
  );
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(
    previewMode ? normalizeConfig(previewConfigRecord, 0) : null,
  );
  const [configSaving, setConfigSaving] = useState(false);
  const [validationIssues, setValidationIssues] = useState<string[]>([]);
  const [publishWarnings, setPublishWarnings] = useState<string[]>([]);
  const [publishWarningConfirmed, setPublishWarningConfirmed] = useState(false);
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const [calculator, setCalculator] = useState({
    accountingFirmName: "",
    auditFee: "",
    accountingFirmRevenue: "",
    recentNonghyupAuditCount: "",
    totalPlannedHours: "",
    requiredProposalItems: "",
  });
  const [calculatorResult, setCalculatorResult] = useState<JsonRecord | null>(
    null,
  );
  const [retentionState, setRetentionState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [retentionPreview, setRetentionPreview] =
    useState<JsonRecord | null>(
      previewMode
        ? {
            asOf: "2026-07-20T00:00:00.000Z",
            planHash: "preview",
            items: [],
            counts: {},
            automaticDeletionEnabled: false,
          }
        : null,
    );

  const [errorState, setErrorState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [errors, setErrors] = useState<JsonRecord[]>(
    previewMode ? previewErrors : [],
  );
  const [errorType, setErrorType] = useState("");
  const [selectedError, setSelectedError] = useState<JsonRecord | null>(
    previewMode ? previewErrors[0] : null,
  );
  const [logState, setLogState] = useState<LoadState>(
    previewMode ? "ready" : "idle",
  );
  const [logs, setLogs] = useState<JsonRecord[]>(
    previewMode ? previewLogs : [],
  );
  const [logFilters, setLogFilters] = useState({
    action: "",
    caseId: "",
    from: "",
    to: "",
  });

  const handleRequestError = useCallback(
    (error: unknown, fallbackKey: string, setState?: (state: LoadState) => void) => {
      const code =
        error instanceof AdminEvaluationRequestError ? error.code : "";
      if (code === "unauthorized" || code === "auth_required") {
        setState?.("denied");
        onMessage({ tone: "error", text: copy.message("auditEvaluationUnauthorized") });
        return;
      }
      if (code === "forbidden") {
        setState?.("denied");
        onMessage({ tone: "error", text: copy.message("auditEvaluationForbidden") });
        return;
      }
      setState?.("error");
      onMessage({ tone: "error", text: copy.message(fallbackKey) });
    },
    [copy, onMessage],
  );

  useEffect(() => {
    if (previewMode || menu !== "cases") return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setCaseState("loading");
      const params = new URLSearchParams();
      Object.entries(caseFilters).forEach(([key, value]) => {
        if (!value) return;
        params.set(
          key,
          key === "createdFrom"
            ? toFilterInstant(value)
            : key === "createdTo"
              ? toFilterInstant(value, true)
              : value,
        );
      });
      try {
        const response = await adminFetch(`${BASE_PATH}?${params.toString()}`);
        if (cancelled) return;
        setCases(responseRecords(response, ["cases", "items"]).map(normalizeCase));
        setCaseState("ready");
      } catch (error) {
        if (!cancelled) {
          handleRequestError(error, "auditEvaluationCasesFailed", setCaseState);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [caseFilters, caseReload, handleRequestError, menu, previewMode]);

  const loadDetail = useCallback(
    async (caseId: string) => {
      setSelectedCaseId(caseId);
      if (previewMode) {
        setDetail(previewDetail);
        setDetailState("ready");
        return;
      }
      setDetailState("loading");
      try {
        const response = await adminFetch(
          `${BASE_PATH}/${encodeURIComponent(caseId)}`,
        );
        setDetail(responseRecord(response, ["detail", "case", "item"]));
        setDetailState("ready");
      } catch (error) {
        handleRequestError(
          error,
          "auditEvaluationDetailFailed",
          setDetailState,
        );
      }
    },
    [handleRequestError, previewMode],
  );

  const loadConfigs = useCallback(async () => {
    if (previewMode) return;
    await Promise.resolve();
    setConfigState("loading");
    try {
      const response = await adminFetch(`${BASE_PATH}/configs`);
      const nextConfigs = responseRecords(response, ["configs", "items"]).map(
        normalizeConfig,
      );
      const nextAssets = responseRecords(response, ["assets", "logoAssets"]).map(
        (asset, index) => ({
          id: readString(asset, ["assetId", "id"], `asset-${index}`),
          name: readString(
            asset,
            ["originalFileName", "name", "filename", "title"],
            "-",
          ),
        }),
      );
      setConfigs(nextConfigs);
      setAssets(nextAssets);
      const selected =
        nextConfigs.find((config) => configKey(config) === selectedConfigId) ??
        nextConfigs[0];
      setSelectedConfigId(selected ? configKey(selected) : "");
      setConfigDraft(selected ? structuredClone(selected) : null);
      setConfigState("ready");
    } catch (error) {
      handleRequestError(error, "auditEvaluationConfigsFailed", setConfigState);
    }
  }, [
    handleRequestError,
    previewMode,
    selectedConfigId,
    setAssets,
    setConfigDraft,
    setConfigState,
    setConfigs,
    setSelectedConfigId,
  ]);

  useEffect(() => {
    if (
      (menu !== "criteria" && menu !== "report") ||
      configState !== "idle"
    ) {
      return;
    }
    void Promise.resolve().then(loadConfigs);
  }, [configState, loadConfigs, menu]);

  const loadRetentionPreview = useCallback(async () => {
    if (previewMode) return;
    setRetentionState("loading");
    try {
      const response = await adminFetch(`${BASE_PATH}/retention`);
      setRetentionPreview(responseRecord(response, ["preview"]));
      setRetentionState("ready");
    } catch (error) {
      handleRequestError(
        error,
        "auditEvaluationRetentionLoadFailed",
        setRetentionState,
      );
    }
  }, [
    handleRequestError,
    previewMode,
    setRetentionPreview,
    setRetentionState,
  ]);

  useEffect(() => {
    if (menu !== "report" || retentionState !== "idle") return;
    void Promise.resolve().then(loadRetentionPreview);
  }, [loadRetentionPreview, menu, retentionState]);

  const loadErrors = useCallback(async () => {
    if (previewMode) return;
    await Promise.resolve();
    setErrorState("loading");
    try {
      const query = errorType ? `?type=${encodeURIComponent(errorType)}` : "";
      const response = await adminFetch(`${BASE_PATH}/errors${query}`);
      setErrors(responseRecords(response, ["errors", "items"]));
      setErrorState("ready");
    } catch (error) {
      handleRequestError(error, "auditEvaluationErrorsFailed", setErrorState);
    }
  }, [
    errorType,
    handleRequestError,
    previewMode,
    setErrors,
    setErrorState,
  ]);

  useEffect(() => {
    if (menu === "errors" && errorState === "idle") {
      void Promise.resolve().then(loadErrors);
    }
  }, [errorState, loadErrors, menu]);

  const loadLogs = useCallback(async () => {
    if (previewMode) return;
    await Promise.resolve();
    setLogState("loading");
    try {
      const params = new URLSearchParams();
      Object.entries(logFilters).forEach(([key, value]) => {
        if (!value) return;
        params.set(
          key,
          key === "from"
            ? toFilterInstant(value)
            : key === "to"
              ? toFilterInstant(value, true)
              : value,
        );
      });
      const response = await adminFetch(
        `${BASE_PATH}/audit-logs?${params.toString()}`,
      );
      setLogs(responseRecords(response, ["logs", "items"]));
      setLogState("ready");
    } catch (error) {
      handleRequestError(error, "auditEvaluationLogsFailed", setLogState);
    }
  }, [
    handleRequestError,
    logFilters,
    previewMode,
    setLogs,
    setLogState,
  ]);

  useEffect(() => {
    if (menu === "logs" && logState === "idle") {
      void Promise.resolve().then(loadLogs);
    }
  }, [loadLogs, logState, menu]);

  const extractedValues = detail
    ? extractedValueRows(detail).map((record) => {
        const field = readString(record, ["field", "fieldKey", "id"]);
        return {
          ...record,
          label: section.item(`field.${field}`),
        };
      })
    : [];
  const correctionFieldRecord =
    extractedValues.find(
      (record) =>
        readString(record, ["field", "fieldKey", "id"]) === correctionField,
    ) ?? null;
  const correctionValueType = correctionFieldRecord
    ? readString(correctionFieldRecord, ["valueType", "type"], "text")
    : "text";
  const detailRevision = correctionFieldRecord
    ? readNumber(correctionFieldRecord, ["revision", "quoteRevision"], 0)
    : 0;

  async function saveCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCaseId || !correctionField || !correctionReason.trim()) {
      onMessage({
        tone: "error",
        text: copy.message("auditEvaluationCorrectionRequired"),
      });
      return;
    }
    if (previewMode) {
      onMessage({
        tone: "success",
        text: copy.message("auditEvaluationCorrectionSaved"),
      });
      return;
    }
    setCorrectionSaving(true);
    try {
      const quoteId = correctionFieldRecord
        ? readString(correctionFieldRecord, ["quoteId"])
        : "";
      if (!quoteId) {
        throw new AdminEvaluationRequestError("quote_not_found");
      }
      const normalizedValue =
        correctionValueType === "number"
          ? Number(correctionValue)
          : correctionValueType === "boolean"
            ? correctionValue === "true"
            : correctionValue;
      await adminFetch(
        `${BASE_PATH}/${encodeURIComponent(selectedCaseId)}/quotes/${encodeURIComponent(quoteId)}/corrections`,
        {
          method: "POST",
          body: JSON.stringify({
            field: correctionField,
            correctedValue: normalizedValue,
            reason: correctionReason.trim(),
            expectedRevision: detailRevision,
          }),
        },
      );
      onMessage({
        tone: "success",
        text: copy.message("auditEvaluationCorrectionSaved"),
      });
      setCorrectionValue("");
      setCorrectionReason("");
      await loadDetail(selectedCaseId);
    } catch (error) {
      handleRequestError(error, "auditEvaluationCorrectionFailed");
    } finally {
      setCorrectionSaving(false);
    }
  }

  async function executeConfirmation() {
    if (!confirmation || !confirmationChecked) return;
    if (previewMode) {
      onMessage({
        tone: "success",
        text: copy.message(`auditEvaluation${capitalize(confirmation.action)}Success`),
      });
      setConfirmation(null);
      setConfirmationChecked(false);
      return;
    }
    setConfirmationLoading(true);
    try {
      const casePath = `${BASE_PATH}/${encodeURIComponent(confirmation.caseId)}`;
      if (confirmation.action === "retention") {
        if (!confirmation.resourceId || !confirmation.expectedExpiresAt) {
          throw new AdminEvaluationRequestError("retention_plan_missing");
        }
        await adminFetch(`${BASE_PATH}/retention`, {
          method: "POST",
          body: JSON.stringify({
            confirm: true,
            asOf: confirmation.expectedExpiresAt,
            expectedPlanHash: confirmation.resourceId,
          }),
        });
      } else if (confirmation.action === "reprocess") {
        if (!confirmation.resourceId) {
          throw new AdminEvaluationRequestError("document_not_found");
        }
        await adminFetch(
          `${casePath}/documents/${encodeURIComponent(confirmation.resourceId)}/reprocess`,
          {
            method: "POST",
            body: JSON.stringify({ confirm: true }),
          },
        );
      } else if (confirmation.action === "regenerate") {
        if (!confirmation.resourceId) {
          throw new AdminEvaluationRequestError("report_not_found");
        }
        const sourceVersion = Number(confirmation.resourceId);
        await adminFetch(
          `${casePath}/reports/${encodeURIComponent(confirmation.resourceId)}/regenerate`,
          {
            method: "POST",
            body: JSON.stringify({
              confirm: true,
              expectedSourceVersion: sourceVersion,
            }),
          },
        );
      } else {
        if (!confirmation.expectedExpiresAt) {
          throw new AdminEvaluationRequestError("access_expiry_missing");
        }
        await adminFetch(`${casePath}/access/reissue`, {
          method: "POST",
          body: JSON.stringify({
            confirm: true,
            extendDays: 7,
            expectedExpiresAt: confirmation.expectedExpiresAt,
          }),
        });
      }
      onMessage({
        tone: "success",
        text: copy.message(`auditEvaluation${capitalize(confirmation.action)}Success`),
      });
      setConfirmation(null);
      setConfirmationChecked(false);
      if (confirmation.action === "retention") {
        setRetentionState("idle");
        setRetentionPreview(null);
      } else {
        setCaseReload((value) => value + 1);
        await loadDetail(confirmation.caseId);
      }
    } catch (error) {
      handleRequestError(
        error,
        `auditEvaluation${capitalize(confirmation.action)}Failed`,
      );
    } finally {
      setConfirmationLoading(false);
    }
  }

  async function configAction(
    action: "createDefault" | "cloneVersion" | "republishVersion",
    sourceConfigKey?: string,
  ) {
    if (previewMode) {
      onMessage({
        tone: "success",
        text: copy.message("auditEvaluationConfigCreated"),
      });
      return;
    }
    setConfigSaving(true);
    try {
      const response = await adminFetch(`${BASE_PATH}/configs`, {
        method: "POST",
        body: JSON.stringify({
          action,
          ...(sourceConfigKey
            ? (() => {
                const source = configs.find(
                  (config) => configKey(config) === sourceConfigKey,
                );
                return {
                  configId: source?.id ?? "",
                  version: Number(source?.version ?? 0),
                };
              })()
            : {}),
        }),
      });
      const created = normalizeConfig(
        responseRecord(response, ["config", "item"]),
        configs.length,
      );
      setConfigs((current) => [created, ...current]);
      setSelectedConfigId(configKey(created));
      setConfigDraft(created);
      setValidationIssues([]);
      setPublishWarnings([]);
      setPublishWarningConfirmed(false);
      setCalculatorResult(null);
      onMessage({
        tone: "success",
        text: copy.message("auditEvaluationConfigCreated"),
      });
    } catch (error) {
      handleRequestError(error, "auditEvaluationConfigCreateFailed");
    } finally {
      setConfigSaving(false);
    }
  }

  function validateConfig(draft: ConfigDraft): string[] {
    const issues: string[] = [];
    if (!draft.name.trim()) issues.push(t("validationName"));
    if (!draft.applicationYear && !draft.effectiveFrom) {
      issues.push(t("validationEffectivePeriod"));
    }
    if (
      draft.applicationYear &&
      (
        !/^\d{4}$/.test(draft.applicationYear) ||
        Number(draft.applicationYear) < 2_000
      )
    ) {
      issues.push(t("validationEffectivePeriod"));
    }
    if (draft.requiredFields.length === 0) {
      issues.push(t("validationRequiredFields"));
    }
    if (draft.criteria.length === 0) issues.push(t("validationCriteria"));
    const totalWeight = draft.criteria.reduce(
      (sum, criterion) => sum + criterion.weight,
      0,
    );
    if (totalWeight !== 100) issues.push(t("validationWeight"));
    if (
      draft.criteria.some(
        (criterion) =>
          !criterion.name.trim() ||
          criterion.weight < 0,
      )
    ) {
      issues.push(t("validationCriterionFields"));
    }
    if (!draft.report.title.trim()) issues.push(t("validationReportTitle"));
    return issues.filter(Boolean);
  }

  async function saveConfig(publish = false, confirmWarnings = false) {
    if (!configDraft || configDraft.status === "PUBLISHED") return;
    const issues = validateConfig(configDraft);
    setValidationIssues(issues);
    if (issues.length > 0) {
      onMessage({
        tone: "error",
        text: copy.message("auditEvaluationConfigValidationFailed"),
      });
      return;
    }
    if (previewMode) {
      setPublishWarnings([]);
      setPublishWarningConfirmed(false);
      onMessage({
        tone: "success",
        text: copy.message(
          publish
            ? "auditEvaluationConfigPublished"
            : "auditEvaluationConfigSaved",
        ),
      });
      return;
    }
    setConfigSaving(true);
    try {
      const versionPath = `${BASE_PATH}/configs/${encodeURIComponent(configDraft.id)}/${encodeURIComponent(configDraft.version)}`;
      let candidate = configDraft;
      let validation: ServerValidationIssue[] = [];

      if (publish && confirmWarnings) {
        const refreshed = await adminFetch(versionPath);
        validation = serverValidationIssues(refreshed, t("validationServerIssue"));
        const refreshedRecord = responseRecord(refreshed, ["config", "item"]);
        if (Object.keys(refreshedRecord).length > 0) {
          candidate = normalizeConfig(refreshedRecord, 0);
          setConfigDraft(candidate);
        }
      } else {
        const patched = await adminFetch(versionPath, {
          method: "PATCH",
          body: JSON.stringify({
            expectedDraftRevision: configDraft.draftRevision,
            changes: buildConfigChanges(configDraft, {
              guidance: t("guidanceLabel"),
              disclaimer: t("disclaimerLabel"),
            }),
          }),
        });
        validation = serverValidationIssues(patched, t("validationServerIssue"));
        const patchedRecord = responseRecord(patched, ["config", "item"]);
        if (Object.keys(patchedRecord).length > 0) {
          candidate = normalizeConfig(patchedRecord, 0);
          setConfigDraft(candidate);
        }
      }
      setConfigs((current) =>
        current.map((config) =>
          configKey(config) === configKey(candidate) ? candidate : config,
        ),
      );

      const serverMessages = validation.map(({ message }) => message).filter(Boolean);
      setValidationIssues(serverMessages);
      if (validation.some(({ severity }) => severity === "error")) {
        onMessage({
          tone: "error",
          text: copy.message("auditEvaluationConfigValidationFailed"),
        });
        return;
      }
      const warnings = validation
        .filter(({ severity }) => severity === "warning")
        .map(({ message }) => message)
        .filter(Boolean);
      if (publish && warnings.length > 0 && !confirmWarnings) {
        setPublishWarnings(warnings);
        setPublishWarningConfirmed(false);
        return;
      }

      if (!publish) {
        setPublishWarnings([]);
        onMessage({
          tone: "success",
          text: copy.message("auditEvaluationConfigSaved"),
        });
        return;
      }

      const response = await adminFetch(`${versionPath}/publish`, {
        method: "POST",
        body: JSON.stringify({
          expectedDraftRevision: candidate.draftRevision,
          confirmWarnings,
        }),
      });
      const savedRecord = responseRecord(response, ["config", "item"]);
      const saved =
        Object.keys(savedRecord).length > 0
          ? normalizeConfig(savedRecord, 0)
          : { ...candidate, status: "PUBLISHED" };
      setConfigs((current) =>
        current.map((config) =>
          configKey(config) === configKey(saved) ? saved : config,
        ),
      );
      setConfigDraft(saved);
      setPublishWarnings([]);
      setPublishWarningConfirmed(false);
      onMessage({
        tone: "success",
        text: copy.message("auditEvaluationConfigPublished"),
      });
    } catch (error) {
      if (
        error instanceof AdminEvaluationRequestError &&
        error.code === "warnings_confirmation_required"
      ) {
        const warnings = serverValidationIssues(
          error.payload,
          t("validationServerIssue"),
        )
          .filter(({ severity }) => severity === "warning")
          .map(({ message }) => message)
          .filter(Boolean);
        setPublishWarnings(warnings);
        setPublishWarningConfirmed(false);
        return;
      }
      handleRequestError(
        error,
        publish
          ? "auditEvaluationConfigPublishFailed"
          : "auditEvaluationConfigSaveFailed",
      );
    } finally {
      setConfigSaving(false);
    }
  }

  async function calculateTest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configDraft) return;
    if (previewMode) {
      setCalculatorResult({
        score: {
          totalScoreBasisPoints: 7850,
          rank: 1,
          missingInformation: [],
        },
      });
      return;
    }
    setConfigSaving(true);
    try {
      const response = await adminFetch(`${BASE_PATH}/configs/calculate`, {
        method: "POST",
        body: JSON.stringify({
          config: {
            ...configDraft.raw,
            ...buildConfigChanges(configDraft, {
              guidance: t("guidanceLabel"),
              disclaimer: t("disclaimerLabel"),
            }),
          },
          sample: {
            quoteId: "preview-quote",
            accountingFirmName: calculator.accountingFirmName.trim(),
            accountingFirmRevenueWon:
              calculator.accountingFirmRevenue || null,
            recentNonghyupAuditCount: Number(
              calculator.recentNonghyupAuditCount,
            ),
            auditedNonghyupTypes: [],
            taxAgencyExperience: false,
            subsidySettlementExperience: false,
            totalPlannedHours: calculator.totalPlannedHours
              ? Number(calculator.totalPlannedHours)
              : null,
            partnerHours: null,
            auditPlanChecklist: [],
            proposalChecklist: [
              {
                itemId: "required-proposal",
                checked: calculator.requiredProposalItems === "true",
              },
            ],
            qualityControlPlan: [],
          },
        }),
      });
      setCalculatorResult(responseRecord(response, ["result", "calculation"]));
    } catch (error) {
      handleRequestError(error, "auditEvaluationCalculateFailed");
    } finally {
      setConfigSaving(false);
    }
  }

  const selectedCase =
    cases.find((candidate) => candidate.id === selectedCaseId) ?? null;
  const leftConfig = configs.find((config) => configKey(config) === compareLeft);
  const rightConfig = configs.find(
    (config) => configKey(config) === compareRight,
  );

  return (
    <div className="audit-admin">
      <div
        className="admin-subtabs audit-admin__menus"
        role="tablist"
        aria-label={t("menuAriaLabel")}
      >
        {MENU_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={menu === id}
            className={`admin-subtab${menu === id ? " is-active" : ""}`}
            onClick={() => setMenu(id)}
          >
            <span>{section.item(`menu.${id}`)}</span>
            <em>{t(`${id}MenuDescription`)}</em>
          </button>
        ))}
      </div>

      {menu === "cases" && (
        <CasesView
          copy={copy}
          cases={cases}
          state={caseState}
          filters={caseFilters}
          setFilters={setCaseFilters}
          selectedCase={selectedCase}
          detail={detail}
          detailState={detailState}
          extractedValues={extractedValues}
          correctionField={correctionField}
          correctionValue={correctionValue}
          correctionReason={correctionReason}
          correctionValueType={correctionValueType}
          correctionSaving={correctionSaving}
          onSelectCase={(caseId) => void loadDetail(caseId)}
          onRefresh={() => setCaseReload((value) => value + 1)}
          onCorrectionField={setCorrectionField}
          onCorrectionValue={setCorrectionValue}
          onCorrectionReason={setCorrectionReason}
          onSaveCorrection={saveCorrection}
          onConfirm={(nextConfirmation) => {
            setConfirmation(nextConfirmation);
            setConfirmationChecked(false);
          }}
        />
      )}

      {(menu === "criteria" || menu === "report") && (
        <div className="audit-admin__config-layout">
          <ConfigSidebar
            copy={copy}
            configs={configs}
            state={configState}
            selectedId={selectedConfigId}
            saving={configSaving}
            onSelect={(id) => {
              setSelectedConfigId(id);
              const selected = configs.find(
                (config) => configKey(config) === id,
              );
              setConfigDraft(selected ? structuredClone(selected) : null);
              setValidationIssues([]);
              setPublishWarnings([]);
              setPublishWarningConfirmed(false);
              setCalculatorResult(null);
            }}
            onCreateDefault={() => void configAction("createDefault")}
            onClone={(id) => void configAction("cloneVersion", id)}
            onRepublish={(id) =>
              void configAction("republishVersion", id)
            }
            onReload={() => void loadConfigs()}
          />
          {menu === "criteria" ? (
            <CriteriaEditor
              copy={copy}
              draft={configDraft}
              saving={configSaving}
              validationIssues={validationIssues}
              configs={configs}
              compareLeft={compareLeft}
              compareRight={compareRight}
              leftConfig={leftConfig}
              rightConfig={rightConfig}
              calculator={calculator}
              calculatorResult={calculatorResult}
              onDraft={setConfigDraft}
              onSave={() => void saveConfig(false)}
              onPublish={() => void saveConfig(true)}
              onClone={(id) => void configAction("cloneVersion", id)}
              onCompareLeft={setCompareLeft}
              onCompareRight={setCompareRight}
              onCalculator={setCalculator}
              onCalculate={calculateTest}
            />
          ) : (
            <ReportSettings
              copy={copy}
              draft={configDraft}
              assets={assets}
              saving={configSaving}
              retentionState={retentionState}
              retentionPreview={retentionPreview}
              onDraft={setConfigDraft}
              onSave={() => void saveConfig(false)}
              onPublish={() => void saveConfig(true)}
              onRetentionPreview={() => {
                setRetentionState("idle");
                setRetentionPreview(null);
              }}
              onRetentionExecute={() => {
                const planHash = readString(
                  retentionPreview ?? {},
                  ["planHash"],
                );
                const asOf = readString(retentionPreview ?? {}, ["asOf"]);
                if (!planHash || !asOf) return;
                setConfirmation({
                  action: "retention",
                  caseId: "retention",
                  resourceId: planHash,
                  expectedExpiresAt: asOf,
                });
                setConfirmationChecked(false);
              }}
            />
          )}
        </div>
      )}

      {menu === "errors" && (
        <ErrorsView
          copy={copy}
          state={errorState}
          errors={errors}
          type={errorType}
          selected={selectedError}
          onType={(value) => {
            setErrorType(value);
            setErrorState("idle");
          }}
          onSelect={setSelectedError}
          onReload={() => void loadErrors()}
          onOpenCase={(caseId) => {
            setMenu("cases");
            void loadDetail(caseId);
          }}
        />
      )}

      {menu === "logs" && (
        <LogsView
          copy={copy}
          state={logState}
          logs={logs}
          filters={logFilters}
          onFilters={(next) => {
            setLogFilters(next);
            setLogState("idle");
          }}
          onReload={() => void loadLogs()}
        />
      )}

      {confirmation && (
        <ConfirmationDialog
          copy={copy}
          confirmation={confirmation}
          checked={confirmationChecked}
          loading={confirmationLoading}
          onChecked={setConfirmationChecked}
          onCancel={() => {
            if (confirmationLoading) return;
            setConfirmation(null);
            setConfirmationChecked(false);
          }}
          onConfirm={() => void executeConfirmation()}
        />
      )}
      {publishWarnings.length > 0 && (
        <PublishWarningsDialog
          copy={copy}
          warnings={publishWarnings}
          checked={publishWarningConfirmed}
          loading={configSaving}
          onChecked={setPublishWarningConfirmed}
          onCancel={() => {
            if (configSaving) return;
            setPublishWarnings([]);
            setPublishWarningConfirmed(false);
          }}
          onConfirm={() => void saveConfig(true, true)}
        />
      )}
    </div>
  );
}

function CasesView({
  copy,
  cases,
  state,
  filters,
  setFilters,
  selectedCase,
  detail,
  detailState,
  extractedValues,
  correctionField,
  correctionValue,
  correctionReason,
  correctionValueType,
  correctionSaving,
  onSelectCase,
  onRefresh,
  onCorrectionField,
  onCorrectionValue,
  onCorrectionReason,
  onSaveCorrection,
  onConfirm,
}: {
  copy: AdminOperationsCopy;
  cases: CaseRow[];
  state: LoadState;
  filters: {
    status: string;
    fiscalYear: string;
    cooperativeName: string;
    createdFrom: string;
    createdTo: string;
    hasError: string;
    reportCompleted: string;
  };
  setFilters: React.Dispatch<React.SetStateAction<typeof filters>>;
  selectedCase: CaseRow | null;
  detail: JsonRecord | null;
  detailState: LoadState;
  extractedValues: JsonRecord[];
  correctionField: string;
  correctionValue: string;
  correctionReason: string;
  correctionValueType: string;
  correctionSaving: boolean;
  onSelectCase: (caseId: string) => void;
  onRefresh: () => void;
  onCorrectionField: (value: string) => void;
  onCorrectionValue: (value: string) => void;
  onCorrectionReason: (value: string) => void;
  onSaveCorrection: (event: React.FormEvent<HTMLFormElement>) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  const t = section.text;
  return (
    <>
      <section className="admin-card audit-admin__filter-card">
        <header className="admin-card__head">
          <div>
            <h2>{t("caseFiltersTitle")}</h2>
            <p>{t("caseFiltersDescription")}</p>
          </div>
          <button
            type="button"
            className="admin-btn"
            onClick={onRefresh}
            disabled={state === "loading"}
          >
            {state === "loading" ? t("loading") : t("refresh")}
          </button>
        </header>
        <div className="audit-admin__filters">
          <FilterSelect
            label={t("statusFilterLabel")}
            value={filters.status}
            onChange={(status) => setFilters((current) => ({ ...current, status }))}
          >
            {CASE_STATUS_VALUES.map((status) => (
              <option key={status || "all"} value={status}>
                {status
                  ? section.item(`caseStatus.${status}`)
                  : t("allStatusOption")}
              </option>
            ))}
          </FilterSelect>
          <FilterInput
            label={t("fiscalYearFilterLabel")}
            value={filters.fiscalYear}
            placeholder={t("fiscalYearFilterExample")}
            inputMode="numeric"
            onChange={(fiscalYear) =>
              setFilters((current) => ({ ...current, fiscalYear }))
            }
          />
          <FilterInput
            label={t("cooperativeFilterLabel")}
            value={filters.cooperativeName}
            placeholder={t("cooperativeFilterExample")}
            onChange={(cooperativeName) =>
              setFilters((current) => ({ ...current, cooperativeName }))
            }
          />
          <FilterInput
            type="date"
            label={t("createdFromLabel")}
            value={filters.createdFrom}
            onChange={(createdFrom) =>
              setFilters((current) => ({ ...current, createdFrom }))
            }
          />
          <FilterInput
            type="date"
            label={t("createdToLabel")}
            value={filters.createdTo}
            onChange={(createdTo) =>
              setFilters((current) => ({ ...current, createdTo }))
            }
          />
          <FilterSelect
            label={t("hasErrorFilterLabel")}
            value={filters.hasError}
            onChange={(hasError) =>
              setFilters((current) => ({ ...current, hasError }))
            }
          >
            <option value="">{t("allOption")}</option>
            <option value="true">{t("yesOption")}</option>
            <option value="false">{t("noOption")}</option>
          </FilterSelect>
          <FilterSelect
            label={t("reportCompletedFilterLabel")}
            value={filters.reportCompleted}
            onChange={(reportCompleted) =>
              setFilters((current) => ({ ...current, reportCompleted }))
            }
          >
            <option value="">{t("allOption")}</option>
            <option value="true">{t("completedOption")}</option>
            <option value="false">{t("notCompletedOption")}</option>
          </FilterSelect>
        </div>
      </section>

      <div className="audit-admin__case-layout">
        <section className="admin-card audit-admin__case-list">
          <header className="admin-card__head">
            <div>
              <h2>{t("caseListTitle")}</h2>
              <p>
                {t("resultCountPrefix")} {cases.length.toLocaleString("ko-KR")}
                {t("resultCountSuffix")}
              </p>
            </div>
          </header>
          <StateNotice state={state} copy={copy} />
          {state === "ready" && (
            <div className="admin-table-wrap">
              <table className="admin-table audit-admin__case-table">
                <thead>
                  <tr>
                    <th>{t("referenceColumn")}</th>
                    <th>{t("cooperativeColumn")}</th>
                    <th>{t("fiscalYearColumn")}</th>
                    <th>{t("quoteCountColumn")}</th>
                    <th>{t("confirmationColumn")}</th>
                    <th>{t("statusColumn")}</th>
                    <th>{t("errorColumn")}</th>
                    <th>{t("reportColumn")}</th>
                    <th>{t("reportGeneratedAtColumn")}</th>
                    <th>{t("createdAtColumn")}</th>
                    <th>{t("updatedAtColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((row) => (
                    <tr
                      key={row.id}
                      className={`admin-row-clickable${
                        selectedCase?.id === row.id ? " is-selected" : ""
                      }`}
                      tabIndex={0}
                      onClick={() => onSelectCase(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectCase(row.id);
                        }
                      }}
                      aria-label={`${row.reference} ${t("openDetailAriaSuffix")}`}
                    >
                      <td><strong>{row.reference}</strong></td>
                      <td>{row.cooperativeName}</td>
                      <td>{row.fiscalYear}</td>
                      <td>{row.documentCount.toLocaleString("ko-KR")}</td>
                      <td>
                        {section.item(
                          `confirmation.${row.customerConfirmationStatus}`,
                        )}
                      </td>
                      <td>
                        <StatusChip
                          value={section.item(`caseStatus.${row.status}`)}
                          rawValue={row.status}
                        />
                      </td>
                      <td>{row.hasError ? t("yesOption") : t("noOption")}</td>
                      <td>
                        {row.reportCompleted
                          ? t("completedOption")
                          : t("notCompletedOption")}
                      </td>
                      <td>{formatDate(row.reportGeneratedAt)}</td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{formatDate(row.updatedAt)}</td>
                    </tr>
                  ))}
                  {cases.length === 0 && (
                    <tr>
                      <td colSpan={11} className="admin-empty">
                        {t("casesEmpty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <CaseDetail
          copy={copy}
          caseId={selectedCase?.id ?? null}
          detail={detail}
          state={detailState}
          extractedValues={extractedValues}
          correctionField={correctionField}
          correctionValue={correctionValue}
          correctionReason={correctionReason}
          correctionValueType={correctionValueType}
          correctionSaving={correctionSaving}
          onCorrectionField={onCorrectionField}
          onCorrectionValue={onCorrectionValue}
          onCorrectionReason={onCorrectionReason}
          onSaveCorrection={onSaveCorrection}
          onConfirm={onConfirm}
        />
      </div>
    </>
  );
}

function CaseDetail({
  copy,
  caseId,
  detail,
  state,
  extractedValues,
  correctionField,
  correctionValue,
  correctionReason,
  correctionValueType,
  correctionSaving,
  onCorrectionField,
  onCorrectionValue,
  onCorrectionReason,
  onSaveCorrection,
  onConfirm,
}: {
  copy: AdminOperationsCopy;
  caseId: string | null;
  detail: JsonRecord | null;
  state: LoadState;
  extractedValues: JsonRecord[];
  correctionField: string;
  correctionValue: string;
  correctionReason: string;
  correctionValueType: string;
  correctionSaving: boolean;
  onCorrectionField: (value: string) => void;
  onCorrectionValue: (value: string) => void;
  onCorrectionReason: (value: string) => void;
  onSaveCorrection: (event: React.FormEvent<HTMLFormElement>) => void;
  onConfirm: (confirmation: Confirmation) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  if (!caseId) {
    return (
      <aside className="admin-card audit-admin__detail">
        <h2>{t("detailTitle")}</h2>
        <p className="admin-empty">{t("detailSelect")}</p>
      </aside>
    );
  }
  const documents = detail
    ? readNestedArray(detail, ["documents", "documentIntegrity"])
    : [];
  const reprocessDocument =
    documents.find((document) =>
      ["FAILED", "NEEDS_REVIEW"].includes(
        readString(document, ["parsingStatus", "status"]).toUpperCase(),
      ),
    ) ?? documents[0];
  const reportVersions = detail
    ? readNestedArray(detail, ["reportVersions", "reports"])
    : [];
  const sourceReport =
    reportVersions.find((report) =>
      ["FAILED", "COMPLETED"].includes(
        readString(report, ["status"]).toUpperCase(),
      ),
    ) ?? reportVersions[0];
  const access = detail
    ? readNestedRecord(detail, ["access", "accessStatus"])
    : {};
  const expectedExpiresAt = detail
    ? readString(
        Object.keys(access).length > 0 ? access : detail,
        ["expiresAt", "accessExpiry"],
      )
    : "";
  return (
    <aside className="admin-card audit-admin__detail" aria-live="polite">
      <header className="admin-card__head">
        <div>
          <h2>{t("detailTitle")}</h2>
          <p>{detail ? readString(detail, ["publicReference", "reference"], caseId) : caseId}</p>
        </div>
      </header>
      <StateNotice state={state} copy={copy} detail />
      {detail && state === "ready" && (
        <>
          <DetailTable
            title={t("documentsIntegrityTitle")}
            empty={t("documentsIntegrityEmpty")}
            rows={documents}
            columns={[
              [t("documentNameColumn"), ["safeDisplayName", "name", "filename", "documentName"]],
              [t("statusColumn"), ["parsingStatus", "status", "uploadStatus"]],
              [t("integrityColumn"), ["integrity", "integrityStatus"]],
              [t("issueColumn"), ["issue", "message", "resolution"]],
            ]}
          />
          <DetailTable
            title={t("extractedEvidenceTitle")}
            empty={t("extractedEvidenceEmpty")}
            rows={extractedValues}
            columns={[
              [t("fieldColumn"), ["label", "fieldLabel", "field"]],
              [t("valueColumn"), ["value", "normalizedValue"]],
              [t("evidenceColumn"), ["evidence", "sourceText"]],
              [t("pageColumn"), ["page", "pageNumber"]],
            ]}
          />
          <DetailTable
            title={t("customerCorrectionsTitle")}
            empty={t("correctionsEmpty")}
            rows={
              readNestedArray(detail, ["customerCorrections"]).length > 0
                ? readNestedArray(detail, ["customerCorrections"])
                : readNestedArray(
                    readNestedRecord(detail, ["corrections"]),
                    ["customer"],
                  )
            }
            columns={correctionColumns(t)}
          />
          <DetailTable
            title={t("adminCorrectionsTitle")}
            empty={t("correctionsEmpty")}
            rows={
              readNestedArray(detail, ["adminCorrections"]).length > 0
                ? readNestedArray(detail, ["adminCorrections"])
                : readNestedArray(
                    readNestedRecord(detail, ["corrections"]),
                    ["admin"],
                  )
            }
            columns={correctionColumns(t)}
          />
          <form className="audit-admin__correction admin-form" onSubmit={onSaveCorrection}>
            <h3>{t("adminCorrectionFormTitle")}</h3>
            <p className="audit-admin__help">{t("adminCorrectionDescription")}</p>
            <label>
              <span>{t("correctionFieldLabel")}</span>
              <select
                className="admin-input"
                value={correctionField}
                onChange={(event) => onCorrectionField(event.target.value)}
                required
              >
                <option value="">{t("correctionFieldPlaceholder")}</option>
                {extractedValues.map((record, index) => {
                  const value = readString(
                    record,
                    ["field", "fieldKey", "id"],
                    `field-${index}`,
                  );
                  return (
                    <option key={value} value={value}>
                      {readString(record, ["label", "fieldLabel", "field"], value)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>{t("correctionValueLabel")}</span>
              {correctionValueType === "boolean" ? (
                <select
                  className="admin-input"
                  value={correctionValue}
                  onChange={(event) => onCorrectionValue(event.target.value)}
                  required
                >
                  <option value="">{t("correctionValuePlaceholder")}</option>
                  <option value="true">{t("yesOption")}</option>
                  <option value="false">{t("noOption")}</option>
                </select>
              ) : (
                <input
                  className="admin-input"
                  type={
                    correctionValueType === "number"
                      ? "number"
                      : correctionValueType === "date"
                        ? "date"
                        : "text"
                  }
                  value={correctionValue}
                  onChange={(event) => onCorrectionValue(event.target.value)}
                  placeholder={t("correctionValueExample")}
                  required
                />
              )}
            </label>
            <label>
              <span>{t("correctionReasonLabel")}</span>
              <textarea
                className="admin-input admin-input--area"
                value={correctionReason}
                onChange={(event) => onCorrectionReason(event.target.value)}
                placeholder={t("correctionReasonExample")}
                required
              />
              <small className="admin-form__hint">{t("correctionReasonHelp")}</small>
            </label>
            <p className="audit-admin__warning">{t("correctionRegenerationWarning")}</p>
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={correctionSaving}
            >
              {correctionSaving ? t("saving") : t("saveCorrection")}
            </button>
          </form>
          <DetailTable
            title={t("scoreDetailsTitle")}
            empty={t("scoreDetailsEmpty")}
            rows={scoreRows(detail)}
            columns={[
              [t("criterionColumn"), ["criterion", "name", "label"]],
              [t("scoreColumn"), ["score", "value"]],
              [t("weightColumn"), ["weight"]],
              [t("noteColumn"), ["note", "reason", "detail"]],
            ]}
          />
          <DetailTable
            title={t("feeAnalysisTitle")}
            empty={t("feeAnalysisEmpty")}
            rows={feeRows(detail)}
            columns={[
              [t("firmColumn"), ["firmName", "accountingFirmName", "name"]],
              [t("feeColumn"), ["fee", "auditFee"]],
              [t("averageColumn"), ["average", "averageFee"]],
              [t("varianceColumn"), ["variance", "difference"]],
            ]}
          />
          <DetailTable
            title={t("reportVersionsTitle")}
            empty={t("reportVersionsEmpty")}
            rows={reportVersions}
            columns={[
              [t("versionColumn"), ["version", "reportVersion"]],
              [t("statusColumn"), ["status"]],
              [t("createdAtColumn"), ["createdAt", "generatedAt"]],
            ]}
          />
          <DetailTable
            title={t("timelineTitle")}
            empty={t("timelineEmpty")}
            rows={readNestedArray(detail, ["timeline", "events", "processingTimeline"])}
            columns={[
              [t("actionColumn"), ["action", "event", "type"]],
              [t("detailColumn"), ["detail", "description"]],
              [t("actorColumn"), ["actor", "actorName"]],
              [t("createdAtColumn"), ["createdAt", "occurredAt"]],
            ]}
          />
          <AccessSummary copy={copy} detail={detail} />
          <div className="audit-admin__actions">
            <button
              type="button"
              className="admin-btn admin-btn--danger"
              disabled={!reprocessDocument}
              onClick={() =>
                onConfirm({
                  action: "reprocess",
                  caseId,
                  resourceId: readString(reprocessDocument ?? {}, [
                    "documentId",
                    "id",
                  ]),
                })
              }
            >
              {t("reprocessButton")}
            </button>
            <button
              type="button"
              className="admin-btn"
              disabled={!sourceReport}
              onClick={() =>
                onConfirm({
                  action: "regenerate",
                  caseId,
                  resourceId: readString(sourceReport ?? {}, [
                    "reportVersion",
                    "version",
                  ]),
                })
              }
            >
              {t("regenerateButton")}
            </button>
            <button
              type="button"
              className="admin-btn"
              disabled={!expectedExpiresAt}
              onClick={() =>
                onConfirm({
                  action: "reissue",
                  caseId,
                  expectedExpiresAt,
                })
              }
            >
              {t("reissueButton")}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}

function ConfigSidebar({
  copy,
  configs,
  state,
  selectedId,
  saving,
  onSelect,
  onCreateDefault,
  onClone,
  onRepublish,
  onReload,
}: {
  copy: AdminOperationsCopy;
  configs: ConfigDraft[];
  state: LoadState;
  selectedId: string;
  saving: boolean;
  onSelect: (id: string) => void;
  onCreateDefault: () => void;
  onClone: (id: string) => void;
  onRepublish: (id: string) => void;
  onReload: () => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const selectedConfig = configs.find(
    (config) => configKey(config) === selectedId,
  );
  return (
    <aside className="admin-card audit-admin__config-list">
      <header className="admin-card__head">
        <div>
          <h2>{t("configListTitle")}</h2>
          <p>{t("configListDescription")}</p>
        </div>
        <button type="button" className="admin-btn" onClick={onReload}>
          {t("refresh")}
        </button>
      </header>
      <StateNotice state={state} copy={copy} />
      <div className="audit-admin__stack">
        {configs.map((config) => (
          <button
            key={configKey(config)}
            type="button"
            className={`audit-admin__config-option${
              selectedId === configKey(config) ? " is-selected" : ""
            }`}
            onClick={() => onSelect(configKey(config))}
          >
            <strong>{config.name}</strong>
            <span>
              {config.version} · {config.status}
            </span>
          </button>
        ))}
        {state === "ready" && configs.length === 0 && (
          <p className="admin-empty">{t("configsEmpty")}</p>
        )}
      </div>
      <div className="audit-admin__actions">
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={onCreateDefault}
          disabled={saving}
        >
          {t("createDefaultButton")}
        </button>
        <button
          type="button"
          className="admin-btn"
          onClick={() => selectedId && onClone(selectedId)}
          disabled={saving || !selectedId}
        >
          {t("cloneButton")}
        </button>
        <button
          type="button"
          className="admin-btn"
          onClick={() => selectedId && onRepublish(selectedId)}
          disabled={
            saving ||
            !selectedId ||
            selectedConfig?.status !== "PUBLISHED"
          }
        >
          {t("republishButton")}
        </button>
      </div>
    </aside>
  );
}

function CriteriaEditor({
  copy,
  draft,
  saving,
  validationIssues,
  configs,
  compareLeft,
  compareRight,
  leftConfig,
  rightConfig,
  calculator,
  calculatorResult,
  onDraft,
  onSave,
  onPublish,
  onClone,
  onCompareLeft,
  onCompareRight,
  onCalculator,
  onCalculate,
}: {
  copy: AdminOperationsCopy;
  draft: ConfigDraft | null;
  saving: boolean;
  validationIssues: string[];
  configs: ConfigDraft[];
  compareLeft: string;
  compareRight: string;
  leftConfig?: ConfigDraft;
  rightConfig?: ConfigDraft;
  calculator: {
    accountingFirmName: string;
    auditFee: string;
    accountingFirmRevenue: string;
    recentNonghyupAuditCount: string;
    totalPlannedHours: string;
    requiredProposalItems: string;
  };
  calculatorResult: JsonRecord | null;
  onDraft: (draft: ConfigDraft | null) => void;
  onSave: () => void;
  onPublish: () => void;
  onClone: (id: string) => void;
  onCompareLeft: (id: string) => void;
  onCompareRight: (id: string) => void;
  onCalculator: React.Dispatch<React.SetStateAction<typeof calculator>>;
  onCalculate: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  if (!draft) {
    return <section className="admin-card admin-empty">{t("selectConfig")}</section>;
  }
  const readOnly = draft.status === "PUBLISHED";
  const calculatorScore = calculatorResult
    ? readNestedRecord(calculatorResult, ["score"])
    : {};
  const updateCriterion = (
    index: number,
    update: (criterion: ConfigCriterion) => ConfigCriterion,
  ) => {
    const criteria = draft.criteria.map((criterion, candidateIndex) =>
      candidateIndex === index ? update(criterion) : criterion,
    );
    onDraft({ ...draft, criteria });
  };
  return (
    <section className="admin-card audit-admin__editor">
      <header className="admin-card__head">
        <div>
          <h2>{t("criteriaEditorTitle")}</h2>
          <p>
            {readOnly ? t("publishedReadOnly") : t("draftEditable")}
          </p>
        </div>
        <StatusChip value={draft.status} />
      </header>
      <div className="admin-form admin-form--grid">
        <Field
          label={t("configNameLabel")}
          help={t("configNameHelp")}
          value={draft.name}
          disabled={readOnly}
          onChange={(name) => onDraft({ ...draft, name })}
        />
        <Field
          label={t("applicationYearLabel")}
          help={t("applicationYearHelp")}
          value={draft.applicationYear}
          placeholder={t("applicationYearExample")}
          inputMode="numeric"
          disabled={readOnly}
          onChange={(applicationYear) => onDraft({ ...draft, applicationYear })}
        />
        <Field
          type="date"
          label={t("effectiveFromLabel")}
          help={t("effectiveDatesHelp")}
          value={draft.effectiveFrom}
          disabled={readOnly}
          onChange={(effectiveFrom) => onDraft({ ...draft, effectiveFrom })}
        />
        <Field
          type="date"
          label={t("effectiveToLabel")}
          help={t("effectiveDatesHelp")}
          value={draft.effectiveTo}
          disabled={readOnly}
          onChange={(effectiveTo) => onDraft({ ...draft, effectiveTo })}
        />
      </div>
      <fieldset className="audit-admin__required-fields" disabled={readOnly}>
        <legend>{t("requiredFieldsTitle")}</legend>
        <p className="audit-admin__help">{t("requiredFieldsHelp")}</p>
        <div className="audit-admin__required-grid">
          {NORMALIZED_QUOTE_FIELDS.map((field) => (
            <label key={field} className="audit-admin__check">
              <input
                type="checkbox"
                checked={draft.requiredFields.includes(field)}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    requiredFields: event.target.checked
                      ? [...new Set([...draft.requiredFields, field])]
                      : draft.requiredFields.filter(
                          (candidate) => candidate !== field,
                        ),
                  })
                }
              />
              <span>{copy.section("auditEvaluationAdmin").item(`field.${field}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="audit-admin__criteria">
        {draft.criteria.map((criterion, index) => (
          <fieldset key={criterion.id} disabled={readOnly}>
            <legend>
              {t("criterionLegendPrefix")} {index + 1}
            </legend>
            <div className="admin-form admin-form--grid">
              <Field
                label={t("criterionNameLabel")}
                help={t("criterionNameHelp")}
                value={criterion.name}
                onChange={(name) =>
                  updateCriterion(index, (current) => ({ ...current, name }))
                }
              />
              <NumberField
                label={t("weightLabel")}
                help={t("weightHelp")}
                value={criterion.weight}
                min={0}
                max={100}
                onChange={(weight) =>
                  updateCriterion(index, (current) => ({ ...current, weight }))
                }
              />
              <Field
                label={t("criterionHelpLabel")}
                help={t("criterionHelpHelp")}
                value={criterion.help}
                onChange={(help) =>
                  updateCriterion(index, (current) => ({ ...current, help }))
                }
              />
            </div>
            <RuleEditor
              copy={copy}
              rule={readNestedRecord(criterion.raw, ["rule"])}
              disabled={readOnly}
              allowWeighted
              onChange={(rule) =>
                updateCriterion(index, (current) => ({
                  ...current,
                  raw: { ...current.raw, rule },
                }))
              }
            />
          </fieldset>
        ))}
        {!readOnly && (
          <button
            type="button"
            className="admin-btn"
            onClick={() =>
              onDraft({
                ...draft,
                criteria: [
                  ...draft.criteria,
                  createCriterionDraft(draft.criteria),
                ],
              })
            }
          >
            {t("addCriterionButton")}
          </button>
        )}
      </div>
      {validationIssues.length > 0 && (
        <div className="audit-admin__issues" role="alert">
          <h3>{t("validationIssuesTitle")}</h3>
          <ul>
            {validationIssues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
      <div className="audit-admin__publish-bar">
        <div>
          <strong>{t("draftPublishTitle")}</strong>
          <p>{t("draftPublishDescription")}</p>
        </div>
        {readOnly ? (
          <button
            type="button"
            className="admin-btn"
            onClick={() => onClone(configKey(draft))}
          >
            {t("clonePublishedButton")}
          </button>
        ) : (
          <div className="audit-admin__actions">
            <button
              type="button"
              className="admin-btn"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? t("saving") : t("saveDraftButton")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={onPublish}
              disabled={saving}
            >
              {t("publishButton")}
            </button>
          </div>
        )}
      </div>

      <section className="audit-admin__subsection">
        <h3>{t("versionCompareTitle")}</h3>
        <p>{t("versionCompareDescription")}</p>
        <div className="audit-admin__compare-selects">
          <ConfigSelect
            label={t("compareLeftLabel")}
            value={compareLeft}
            configs={configs}
            onChange={onCompareLeft}
          />
          <ConfigSelect
            label={t("compareRightLabel")}
            value={compareRight}
            configs={configs}
            onChange={onCompareRight}
          />
        </div>
        {leftConfig && rightConfig && (
          <dl className="audit-admin__compare">
            <div>
              <dt>{t("compareNameField")}</dt>
              <dd>{leftConfig.name} → {rightConfig.name}</dd>
            </div>
            <div>
              <dt>{t("comparePeriodField")}</dt>
              <dd>
                {leftConfig.applicationYear || leftConfig.effectiveFrom} →{" "}
                {rightConfig.applicationYear || rightConfig.effectiveFrom}
              </dd>
            </div>
            <div>
              <dt>{t("compareCriteriaField")}</dt>
              <dd>
                {leftConfig.criteria.length.toLocaleString("ko-KR")} →{" "}
                {rightConfig.criteria.length.toLocaleString("ko-KR")}
              </dd>
            </div>
            <div>
              <dt>{t("compareWeightField")}</dt>
              <dd>
                {leftConfig.criteria.reduce((sum, item) => sum + item.weight, 0)}
                {" → "}
                {rightConfig.criteria.reduce((sum, item) => sum + item.weight, 0)}
              </dd>
            </div>
          </dl>
        )}
        {leftConfig?.status === "PUBLISHED" && (
          <button
            type="button"
            className="admin-btn"
            onClick={() => onClone(configKey(leftConfig))}
          >
            {t("clonePreviousButton")}
          </button>
        )}
      </section>

      <form className="audit-admin__subsection admin-form" onSubmit={onCalculate}>
        <h3>{t("calculatorTitle")}</h3>
        <p>{t("calculatorDescription")}</p>
        <div className="admin-form admin-form--grid">
          <Field
            label={t("calculatorFirmNameLabel")}
            placeholder={t("calculatorFirmNameExample")}
            value={calculator.accountingFirmName}
            required
            onChange={(accountingFirmName) =>
              onCalculator((current) => ({
                ...current,
                accountingFirmName,
              }))
            }
          />
          {(
            [
              ["auditFee", "calculatorAuditFeeLabel", "calculatorAuditFeeExample"],
              [
                "accountingFirmRevenue",
                "calculatorRevenueLabel",
                "calculatorRevenueExample",
              ],
              [
                "recentNonghyupAuditCount",
                "calculatorAuditCountLabel",
                "calculatorAuditCountExample",
              ],
              [
                "totalPlannedHours",
                "calculatorHoursLabel",
                "calculatorHoursExample",
              ],
            ] as const
          ).map(([key, labelKey, exampleKey]) => (
            <Field
              key={key}
              type="number"
              label={t(labelKey)}
              placeholder={t(exampleKey)}
              value={calculator[key]}
              onChange={(value) =>
                onCalculator((current) => ({ ...current, [key]: value }))
              }
            />
          ))}
          <label className="admin-field">
            <span>{t("calculatorRequiredItemsLabel")}</span>
            <select
              className="admin-input"
              value={calculator.requiredProposalItems}
              onChange={(event) =>
                onCalculator((current) => ({
                  ...current,
                  requiredProposalItems: event.target.value,
                }))
              }
              required
            >
              <option value="">{t("selectOption")}</option>
              <option value="true">{t("yesOption")}</option>
              <option value="false">{t("noOption")}</option>
            </select>
          </label>
        </div>
        <button type="submit" className="admin-btn" disabled={saving}>
          {t("calculateButton")}
        </button>
        {calculatorResult && (
          <dl className="audit-admin__compare" aria-live="polite">
            <div>
              <dt>{t("calculatorScoreResult")}</dt>
              <dd>
                {readNumber(calculatorScore, ["totalScoreBasisPoints"], 0) / 100}
              </dd>
            </div>
            <div>
              <dt>{t("calculatorGradeResult")}</dt>
              <dd>{displayValue(firstValue(calculatorScore, ["rank"]))}</dd>
            </div>
            <div>
              <dt>{t("calculatorPassResult")}</dt>
              <dd>
                {asArray(calculatorScore.missingInformation).length}
              </dd>
            </div>
          </dl>
        )}
      </form>
    </section>
  );
}

type RuleType =
  | "threshold"
  | "boolean"
  | "checklist"
  | "range"
  | "informational-only"
  | "weighted-subcriteria";

const RULE_TYPES: readonly RuleType[] = [
  "threshold",
  "boolean",
  "checklist",
  "range",
  "informational-only",
  "weighted-subcriteria",
];
const COMPARABLE_KINDS = [
  "INTEGER",
  "DECIMAL_STRING",
  "BOOLEAN",
  "TEXT",
] as const;
const CONDITION_TYPES = [
  "",
  "FIELD_PRESENT",
  "BOOLEAN_EQUALS",
  "MINIMUM_INTEGER",
  "PROPOSAL_ITEM_PRESENT",
] as const;

function createRule(type: RuleType): JsonRecord {
  if (type === "threshold") {
    return {
      type,
      field: "recentNonghyupAuditCount",
      operator: "GTE",
      threshold: { kind: "INTEGER", value: 0 },
    };
  }
  if (type === "boolean") {
    return { type, field: "vatIncluded", expected: true };
  }
  if (type === "checklist") {
    return { type, field: "requiredProposalItems", items: [] };
  }
  if (type === "range") {
    return {
      type,
      field: "recentNonghyupAuditCount",
      bands: [
        {
          id: "range-lower",
          minimumInclusive: null,
          maximumExclusive: { kind: "INTEGER", value: 1 },
          scoreBasisPoints: 0,
        },
        {
          id: "range-upper",
          minimumInclusive: { kind: "INTEGER", value: 1 },
          maximumExclusive: null,
          scoreBasisPoints: 10_000,
        },
      ],
    };
  }
  if (type === "weighted-subcriteria") {
    return {
      type,
      subcriteria: [
        {
          id: "subcriterion-one",
          name: "",
          relativeWeightBasisPoints: 5_000,
          rule: createRule("informational-only"),
        },
        {
          id: "subcriterion-two",
          name: "",
          relativeWeightBasisPoints: 5_000,
          rule: createRule("informational-only"),
        },
      ],
    };
  }
  return { type: "informational-only", field: "accountingFirmName" };
}

function nextStableId(prefix: string, ids: readonly string[]): string {
  const used = new Set(ids);
  let suffix = ids.length + 1;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

function createCriterionDraft(existing: readonly ConfigCriterion[]): ConfigCriterion {
  const id = nextStableId(
    "criterion",
    existing.map((criterion) => criterion.id),
  );
  return {
    id,
    name: "",
    weight: 0,
    help: "",
    raw: {
      id,
      required: true,
      rule: createRule("informational-only"),
    },
  };
}

function RuleEditor({
  copy,
  rule,
  disabled,
  allowWeighted,
  onChange,
}: {
  copy: AdminOperationsCopy;
  rule: JsonRecord;
  disabled: boolean;
  allowWeighted: boolean;
  onChange: (rule: JsonRecord) => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  const t = section.text;
  const rawType = readString(rule, ["type"], "informational-only");
  const type = RULE_TYPES.includes(rawType as RuleType)
    ? (rawType as RuleType)
    : "informational-only";
  const availableTypes = allowWeighted
    ? RULE_TYPES
    : RULE_TYPES.filter((candidate) => candidate !== "weighted-subcriteria");
  return (
    <fieldset className="audit-admin__rule-editor" disabled={disabled}>
      <legend>{t("ruleEditorTitle")}</legend>
      <label className="admin-field">
        <span>{t("ruleTypeLabel")}</span>
        <select
          className="admin-input"
          value={type}
          onChange={(event) => onChange(createRule(event.target.value as RuleType))}
        >
          {availableTypes.map((value) => (
            <option key={value} value={value}>
              {section.item(`ruleType.${value}`)}
            </option>
          ))}
        </select>
      </label>

      {type === "weighted-subcriteria" && (
        <WeightedSubcriteriaEditor
          copy={copy}
          rule={rule}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {type === "range" && (
        <RangeRuleEditor
          copy={copy}
          rule={rule}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {type === "checklist" && (
        <ChecklistRuleEditor
          copy={copy}
          rule={rule}
          disabled={disabled}
          onChange={onChange}
        />
      )}
      {type === "threshold" && (
        <div className="admin-form admin-form--grid">
          <RuleFieldSelect
            copy={copy}
            value={readString(rule, ["field"], "recentNonghyupAuditCount")}
            disabled={disabled}
            onChange={(field) => onChange({ ...rule, field })}
          />
          <label className="admin-field">
            <span>{t("operatorLabel")}</span>
            <select
              className="admin-input"
              value={readString(rule, ["operator"], "GTE")}
              onChange={(event) =>
                onChange({ ...rule, operator: event.target.value })
              }
            >
              {["GT", "GTE", "LT", "LTE", "EQ"].map((operator) => (
                <option key={operator} value={operator}>
                  {section.item(`operator.${operator}`)}
                </option>
              ))}
            </select>
          </label>
          <ComparableValueEditor
            copy={copy}
            label={t("thresholdLabel")}
            value={readNestedRecord(rule, ["threshold"])}
            allowEmpty={false}
            onChange={(threshold) => onChange({ ...rule, threshold })}
          />
        </div>
      )}
      {type === "boolean" && (
        <div className="admin-form admin-form--grid">
          <RuleFieldSelect
            copy={copy}
            value={readString(rule, ["field"], "vatIncluded")}
            disabled={disabled}
            onChange={(field) => onChange({ ...rule, field })}
          />
          <label className="audit-admin__check">
            <input
              type="checkbox"
              checked={readBoolean(rule, ["expected"], true)}
              onChange={(event) =>
                onChange({ ...rule, expected: event.target.checked })
              }
            />
            <span>{t("booleanExpectedLabel")}</span>
          </label>
        </div>
      )}
      {type === "informational-only" && (
        <RuleFieldSelect
          copy={copy}
          value={readString(rule, ["field"], "accountingFirmName")}
          disabled={disabled}
          onChange={(field) => onChange({ ...rule, field })}
        />
      )}
    </fieldset>
  );
}

function WeightedSubcriteriaEditor({
  copy,
  rule,
  disabled,
  onChange,
}: {
  copy: AdminOperationsCopy;
  rule: JsonRecord;
  disabled: boolean;
  onChange: (rule: JsonRecord) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const subcriteria = readNestedArray(rule, ["subcriteria"]);
  const update = (index: number, next: JsonRecord) =>
    onChange({
      ...rule,
      subcriteria: subcriteria.map((item, itemIndex) =>
        itemIndex === index ? next : item,
      ),
    });
  return (
    <div className="audit-admin__subitems">
      <p className="audit-admin__help">{t("weightedSubcriteriaHelp")}</p>
      {subcriteria.map((subcriterion, index) => (
        <section
          key={readString(subcriterion, ["id"], `subcriterion-${index}`)}
          className="audit-admin__rule-item"
        >
          <div className="admin-form admin-form--grid">
            <Field
              label={t("subitemNameLabel")}
              value={readString(subcriterion, ["name"])}
              onChange={(name) => update(index, { ...subcriterion, name })}
            />
            <NumberField
              label={t("subitemWeightLabel")}
              value={
                readNumber(subcriterion, ["relativeWeightBasisPoints"], 0) / 100
              }
              min={0}
              max={100}
              onChange={(weight) =>
                update(index, {
                  ...subcriterion,
                  relativeWeightBasisPoints: Math.round(weight * 100),
                })
              }
            />
          </div>
          <RuleEditor
            copy={copy}
            rule={readNestedRecord(subcriterion, ["rule"])}
            disabled={disabled}
            allowWeighted={false}
            onChange={(nextRule) =>
              update(index, { ...subcriterion, rule: nextRule })
            }
          />
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            disabled={disabled || subcriteria.length <= 2}
            onClick={() =>
              onChange({
                ...rule,
                subcriteria: subcriteria.filter(
                  (_, itemIndex) => itemIndex !== index,
                ),
              })
            }
          >
            {t("removeSubitemButton")}
          </button>
        </section>
      ))}
      <button
        type="button"
        className="admin-btn"
        disabled={disabled}
        onClick={() => {
          const id = nextStableId(
            "subcriterion",
            subcriteria.map((item) => readString(item, ["id"])),
          );
          onChange({
            ...rule,
            subcriteria: [
              ...subcriteria,
              {
                id,
                name: "",
                relativeWeightBasisPoints: 0,
                rule: createRule("informational-only"),
              },
            ],
          });
        }}
      >
        {t("addSubitemButton")}
      </button>
    </div>
  );
}

function RangeRuleEditor({
  copy,
  rule,
  disabled,
  onChange,
}: {
  copy: AdminOperationsCopy;
  rule: JsonRecord;
  disabled: boolean;
  onChange: (rule: JsonRecord) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const bands = readNestedArray(rule, ["bands"]);
  const update = (index: number, next: JsonRecord) =>
    onChange({
      ...rule,
      bands: bands.map((band, bandIndex) => (bandIndex === index ? next : band)),
    });
  return (
    <div className="audit-admin__subitems">
      <RuleFieldSelect
        copy={copy}
        value={readString(rule, ["field"], "recentNonghyupAuditCount")}
        disabled={disabled}
        onChange={(field) => onChange({ ...rule, field })}
      />
      <p className="audit-admin__help">{t("rangeBandsHelp")}</p>
      {bands.map((band, index) => (
        <section
          key={readString(band, ["id"], `band-${index}`)}
          className="audit-admin__rule-item audit-admin__range-band"
        >
          <ComparableValueEditor
            copy={copy}
            label={t("minimumInclusiveLabel")}
            value={isRecord(band.minimumInclusive) ? band.minimumInclusive : null}
            allowEmpty
            onChange={(minimumInclusive) =>
              update(index, { ...band, minimumInclusive })
            }
          />
          <ComparableValueEditor
            copy={copy}
            label={t("maximumExclusiveLabel")}
            value={isRecord(band.maximumExclusive) ? band.maximumExclusive : null}
            allowEmpty
            onChange={(maximumExclusive) =>
              update(index, { ...band, maximumExclusive })
            }
          />
          <NumberField
            label={t("bandScoreLabel")}
            value={readNumber(band, ["scoreBasisPoints"], 0) / 100}
            min={0}
            max={100}
            onChange={(score) =>
              update(index, {
                ...band,
                scoreBasisPoints: Math.round(score * 100),
              })
            }
          />
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            disabled={disabled || bands.length <= 1}
            onClick={() =>
              onChange({
                ...rule,
                bands: bands.filter((_, bandIndex) => bandIndex !== index),
              })
            }
          >
            {t("removeBandButton")}
          </button>
        </section>
      ))}
      <button
        type="button"
        className="admin-btn"
        disabled={disabled}
        onClick={() =>
          onChange({
            ...rule,
            bands: [
              ...bands,
              {
                id: nextStableId(
                  "band",
                  bands.map((band) => readString(band, ["id"])),
                ),
                minimumInclusive: { kind: "INTEGER", value: 0 },
                maximumExclusive: null,
                scoreBasisPoints: 0,
              },
            ],
          })
        }
      >
        {t("addBandButton")}
      </button>
    </div>
  );
}

function ChecklistRuleEditor({
  copy,
  rule,
  disabled,
  onChange,
}: {
  copy: AdminOperationsCopy;
  rule: JsonRecord;
  disabled: boolean;
  onChange: (rule: JsonRecord) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const items = readNestedArray(rule, ["items"]);
  const update = (index: number, next: JsonRecord) =>
    onChange({
      ...rule,
      items: items.map((item, itemIndex) => (itemIndex === index ? next : item)),
    });
  return (
    <div className="audit-admin__subitems">
      <RuleFieldSelect
        copy={copy}
        value={readString(rule, ["field"], "requiredProposalItems")}
        disabled={disabled}
        onChange={(field) => onChange({ ...rule, field })}
      />
      <p className="audit-admin__help">{t("checklistItemsHelp")}</p>
      {items.map((item, index) => (
        <section
          key={readString(item, ["id"], `checklist-${index}`)}
          className="audit-admin__rule-item"
        >
          <div className="admin-form admin-form--grid">
            <Field
              label={t("checklistItemLabel")}
              value={readString(item, ["label"])}
              onChange={(label) => update(index, { ...item, label })}
            />
            <NumberField
              label={t("checklistScoreLabel")}
              value={readNumber(item, ["scoreBasisPoints"], 0) / 100}
              min={0}
              max={100}
              onChange={(score) =>
                update(index, {
                  ...item,
                  scoreBasisPoints: Math.round(score * 100),
                })
              }
            />
            <label className="audit-admin__check">
              <input
                type="checkbox"
                checked={readBoolean(item, ["required"], false)}
                onChange={(event) =>
                  update(index, { ...item, required: event.target.checked })
                }
              />
              <span>{t("checklistRequiredLabel")}</span>
            </label>
          </div>
          <ChecklistConditionEditor
            copy={copy}
            condition={readNestedRecord(item, ["condition"])}
            onChange={(condition) =>
              update(index, {
                ...item,
                ...(condition ? { condition } : { condition: undefined }),
              })
            }
          />
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...rule,
                items: items.filter((_, itemIndex) => itemIndex !== index),
              })
            }
          >
            {t("removeChecklistItemButton")}
          </button>
        </section>
      ))}
      <button
        type="button"
        className="admin-btn"
        disabled={disabled}
        onClick={() =>
          onChange({
            ...rule,
            items: [
              ...items,
              {
                id: nextStableId(
                  "checklist",
                  items.map((item) => readString(item, ["id"])),
                ),
                label: "",
                required: false,
                scoreBasisPoints: 0,
              },
            ],
          })
        }
      >
        {t("addChecklistItemButton")}
      </button>
    </div>
  );
}

function ChecklistConditionEditor({
  copy,
  condition,
  onChange,
}: {
  copy: AdminOperationsCopy;
  condition: JsonRecord;
  onChange: (condition: JsonRecord | null) => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  const t = section.text;
  const type = readString(condition, ["type"]);
  return (
    <div className="admin-form admin-form--grid">
      <label className="admin-field">
        <span>{t("conditionTypeLabel")}</span>
        <select
          className="admin-input"
          value={type}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) return onChange(null);
            if (next === "PROPOSAL_ITEM_PRESENT") {
              return onChange({ type: next, itemId: "proposal-item" });
            }
            if (next === "MINIMUM_INTEGER") {
              return onChange({
                type: next,
                field: "recentNonghyupAuditCount",
                minimum: 0,
              });
            }
            if (next === "BOOLEAN_EQUALS") {
              return onChange({ type: next, field: "vatIncluded", expected: true });
            }
            onChange({ type: next, field: "accountingFirmName" });
          }}
        >
          {CONDITION_TYPES.map((value) => (
            <option key={value || "none"} value={value}>
              {section.item(`condition.${value || "none"}`)}
            </option>
          ))}
        </select>
      </label>
      {type && type !== "PROPOSAL_ITEM_PRESENT" && (
        <RuleFieldSelect
          copy={copy}
          value={readString(condition, ["field"], "accountingFirmName")}
          onChange={(field) => onChange({ ...condition, field })}
        />
      )}
      {type === "BOOLEAN_EQUALS" && (
        <label className="audit-admin__check">
          <input
            type="checkbox"
            checked={readBoolean(condition, ["expected"], true)}
            onChange={(event) =>
              onChange({ ...condition, expected: event.target.checked })
            }
          />
          <span>{t("booleanExpectedLabel")}</span>
        </label>
      )}
      {type === "MINIMUM_INTEGER" && (
        <NumberField
          label={t("conditionMinimumLabel")}
          value={readNumber(condition, ["minimum"], 0)}
          min={0}
          max={Number.MAX_SAFE_INTEGER}
          onChange={(minimum) => onChange({ ...condition, minimum })}
        />
      )}
      {type === "PROPOSAL_ITEM_PRESENT" && (
        <Field
          label={t("conditionItemIdLabel")}
          value={readString(condition, ["itemId"])}
          onChange={(itemId) => onChange({ ...condition, itemId })}
        />
      )}
    </div>
  );
}

function RuleFieldSelect({
  copy,
  value,
  disabled,
  onChange,
}: {
  copy: AdminOperationsCopy;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  return (
    <label className="admin-field">
      <span>{section.text("ruleFieldLabel")}</span>
      <select
        className="admin-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {NORMALIZED_QUOTE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {section.item(`field.${field}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComparableValueEditor({
  copy,
  label,
  value,
  allowEmpty,
  onChange,
}: {
  copy: AdminOperationsCopy;
  label: string;
  value: JsonRecord | null;
  allowEmpty: boolean;
  onChange: (value: JsonRecord | null) => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  const kind = value
    ? readString(value, ["kind"], "INTEGER")
    : "";
  return (
    <label className="admin-field">
      <span>{label}</span>
      <span className="audit-admin__compound-field">
        <select
          className="admin-input"
          value={kind}
          onChange={(event) => {
            const nextKind = event.target.value;
            if (!nextKind) return onChange(null);
            onChange({
              kind: nextKind,
              value:
                nextKind === "INTEGER"
                  ? 0
                  : nextKind === "BOOLEAN"
                    ? true
                    : "",
            });
          }}
        >
          {allowEmpty && (
            <option value="">{section.item("valueKind.none")}</option>
          )}
          {COMPARABLE_KINDS.map((valueKind) => (
            <option key={valueKind} value={valueKind}>
              {section.item(`valueKind.${valueKind}`)}
            </option>
          ))}
        </select>
        {value && kind === "BOOLEAN" && (
          <label className="audit-admin__check">
            <input
              type="checkbox"
              checked={readBoolean(value, ["value"], false)}
              onChange={(event) =>
                onChange({ ...value, value: event.target.checked })
              }
            />
            <span>{section.text("booleanValueLabel")}</span>
          </label>
        )}
        {value && kind !== "BOOLEAN" && (
          <input
            className="admin-input"
            type={kind === "INTEGER" ? "number" : "text"}
            value={readString(value, ["value"], "0")}
            onChange={(event) =>
              onChange({
                ...value,
                value:
                  kind === "INTEGER"
                    ? Number(event.target.value)
                    : event.target.value,
              })
            }
          />
        )}
      </span>
    </label>
  );
}

function ReportSettings({
  copy,
  draft,
  assets,
  saving,
  retentionState,
  retentionPreview,
  onDraft,
  onSave,
  onPublish,
  onRetentionPreview,
  onRetentionExecute,
}: {
  copy: AdminOperationsCopy;
  draft: ConfigDraft | null;
  assets: AssetOption[];
  saving: boolean;
  retentionState: LoadState;
  retentionPreview: JsonRecord | null;
  onDraft: (draft: ConfigDraft | null) => void;
  onSave: () => void;
  onPublish: () => void;
  onRetentionPreview: () => void;
  onRetentionExecute: () => void;
}) {
  const section = copy.section("auditEvaluationAdmin");
  const t = section.text;
  if (!draft) {
    return <section className="admin-card admin-empty">{t("selectConfig")}</section>;
  }
  const readOnly = draft.status === "PUBLISHED";
  const updateReport = (patch: Partial<ConfigDraft["report"]>) =>
    onDraft({ ...draft, report: { ...draft.report, ...patch } });
  const updateRetention = (patch: Partial<ConfigDraft["retention"]>) =>
    onDraft({ ...draft, retention: { ...draft.retention, ...patch } });
  const retentionItems = recordArray(retentionPreview?.items);
  const retentionCounts = asRecord(retentionPreview?.counts);
  return (
    <section className="admin-card audit-admin__editor">
      <header className="admin-card__head">
        <div>
          <h2>{t("reportSettingsTitle")}</h2>
          <p>{t("reportSettingsDescription")}</p>
        </div>
        <StatusChip value={draft.status} />
      </header>
      <div className="audit-admin__exposure">
        <strong>{t("customerExposureTitle")}</strong>
        <p>{t("customerExposureDescription")}</p>
      </div>
      <fieldset disabled={readOnly} className="audit-admin__report-fieldset">
        <legend>{t("reportSectionsTitle")}</legend>
        <p className="audit-admin__help">{t("reportSectionsHelp")}</p>
        <div className="audit-admin__report-sections">
          {draft.report.sections.map((reportSection, index) => (
            <div key={reportSection.id} className="audit-admin__report-section">
              <label className="audit-admin__check">
                <input
                  type="checkbox"
                  checked={reportSection.visible}
                  disabled={reportSection.locked || readOnly}
                  onChange={(event) =>
                    updateReport({
                      sections: draft.report.sections.map((candidate, itemIndex) =>
                        itemIndex === index
                          ? { ...candidate, visible: event.target.checked }
                          : candidate,
                      ),
                    })
                  }
                />
                <span>{reportSection.title}</span>
              </label>
              <label className="admin-field">
                <span>{t("sectionOrderLabel")}</span>
                <input
                  className="admin-input"
                  type="number"
                  min={1}
                  max={draft.report.sections.length}
                  value={reportSection.order}
                  onChange={(event) =>
                    updateReport({
                      sections: draft.report.sections.map((candidate, itemIndex) =>
                        itemIndex === index
                          ? { ...candidate, order: Number(event.target.value) }
                          : candidate,
                      ),
                    })
                  }
                />
              </label>
              {reportSection.locked && (
                <span className="admin-chip">{t("mandatorySectionBadge")}</span>
              )}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="admin-form admin-form--grid">
        <Field
          label={t("reportTitleLabel")}
          help={t("reportTitleHelp")}
          value={draft.report.title}
          disabled={readOnly}
          onChange={(title) => updateReport({ title })}
        />
        <Field
          label={t("guidanceLabel")}
          help={t("guidanceHelp")}
          value={draft.report.guidance}
          disabled={readOnly}
          onChange={(guidance) => updateReport({ guidance })}
        />
        <Field
          label={t("disclaimerLabel")}
          help={t("disclaimerHelp")}
          value={draft.report.disclaimer}
          disabled={readOnly}
          onChange={(disclaimer) => updateReport({ disclaimer })}
        />
        <Field
          label={t("contactLabel")}
          help={t("contactHelp")}
          value={draft.report.contact}
          disabled={readOnly}
          onChange={(contact) => updateReport({ contact })}
        />
        <label className="admin-field">
          <span>{t("logoAssetLabel")}</span>
          <select
            className="admin-input"
            value={draft.report.logoAssetId}
            disabled={readOnly}
            onChange={(event) => updateReport({ logoAssetId: event.target.value })}
          >
            <option value="">{t("noLogoOption")}</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.name}</option>
            ))}
          </select>
          <small className="admin-form__hint">{t("logoAssetHelp")}</small>
        </label>
        <ColorField
          label={t("primaryColorLabel")}
          help={t("colorHelp")}
          value={draft.report.primaryColor}
          disabled={readOnly}
          onChange={(primaryColor) => updateReport({ primaryColor })}
        />
        <ColorField
          label={t("accentColorLabel")}
          help={t("colorHelp")}
          value={draft.report.accentColor}
          disabled={readOnly}
          onChange={(accentColor) => updateReport({ accentColor })}
        />
        <Field
          label={t("watermarkLabel")}
          help={t("watermarkHelp")}
          value={draft.report.watermark}
          disabled={readOnly}
          onChange={(watermark) => updateReport({ watermark })}
        />
        <label className="admin-field">
          <span>{t("filenameRuleLabel")}</span>
          <select
            className="admin-input"
            value={draft.report.filenameRule}
            disabled={readOnly}
            onChange={(event) => updateReport({ filenameRule: event.target.value })}
          >
            {FILENAME_RULE_VALUES.map((value) => (
              <option key={value} value={value}>
                {section.item(`filename.${value}`)}
              </option>
            ))}
          </select>
          <small className="admin-form__hint">{t("filenameRuleHelp")}</small>
        </label>
        <NumberField
          label={t("downloadDaysLabel")}
          help={t("downloadDaysHelp")}
          value={draft.report.downloadDays}
          min={1}
          max={365}
          disabled={readOnly}
          onChange={(downloadDays) => updateReport({ downloadDays })}
        />
      </div>
      <fieldset disabled={readOnly} className="audit-admin__report-fieldset">
        <legend>{t("retentionSettingsTitle")}</legend>
        <p className="audit-admin__help">{t("retentionSettingsHelp")}</p>
        <div className="admin-form admin-form--grid">
          <NumberField
            label={t("sourceDocumentRetentionLabel")}
            help={t("sourceDocumentRetentionHelp")}
            value={draft.retention.sourceDocumentDays}
            min={1}
            max={36_500}
            disabled={readOnly}
            onChange={(sourceDocumentDays) =>
              updateRetention({ sourceDocumentDays })
            }
          />
          <NumberField
            label={t("intermediateRetentionLabel")}
            help={t("intermediateRetentionHelp")}
            value={draft.retention.normalizedDataDays}
            min={1}
            max={36_500}
            disabled={readOnly}
            onChange={(normalizedDataDays) =>
              updateRetention({ normalizedDataDays })
            }
          />
          <NumberField
            label={t("reportRetentionLabel")}
            help={t("reportRetentionHelp")}
            value={draft.retention.reportDays}
            min={1}
            max={36_500}
            disabled={readOnly}
            onChange={(reportDays) => updateRetention({ reportDays })}
          />
          <NumberField
            label={t("expiredAccessRetentionLabel")}
            help={t("expiredAccessRetentionHelp")}
            value={draft.retention.expiredAccessTokenDays}
            min={1}
            max={3_650}
            disabled={readOnly}
            onChange={(expiredAccessTokenDays) =>
              updateRetention({ expiredAccessTokenDays })
            }
          />
          <NumberField
            label={t("auditLogRetentionLabel")}
            help={t("auditLogRetentionHelp")}
            value={draft.retention.auditLogDays}
            min={365}
            max={36_500}
            disabled={readOnly}
            onChange={(auditLogDays) => updateRetention({ auditLogDays })}
          />
          <label className="audit-admin__check">
            <input
              type="checkbox"
              checked={draft.retention.deleteAfterExpiry}
              disabled={readOnly}
              onChange={(event) =>
                updateRetention({ deleteAfterExpiry: event.target.checked })
              }
            />
            <span>{t("automaticRetentionLabel")}</span>
          </label>
        </div>
      </fieldset>
      <section className="audit-admin__exposure">
        <strong>{t("retentionPreviewTitle")}</strong>
        <p>{t("retentionPreviewHelp")}</p>
        <StateNotice state={retentionState} copy={copy} />
        {retentionState === "ready" && retentionPreview && (
          <>
            <p>
              {t("retentionTargetCountLabel")}:{" "}
              <strong>{retentionItems.length.toLocaleString("ko-KR")}</strong>
            </p>
            <dl className="audit-admin__compare">
              <SummaryField
                label={t("sourceDocumentRetentionTarget")}
                value={displayValue(retentionCounts.SOURCE_DOCUMENT)}
              />
              <SummaryField
                label={t("intermediateRetentionTarget")}
                value={displayValue(retentionCounts.INTERMEDIATE_DATA)}
              />
              <SummaryField
                label={t("reportRetentionTarget")}
                value={displayValue(retentionCounts.REPORT)}
              />
              <SummaryField
                label={t("expiredAccessRetentionTarget")}
                value={displayValue(retentionCounts.EXPIRED_ACCESS)}
              />
              <SummaryField
                label={t("auditLogRetentionTarget")}
                value={displayValue(retentionCounts.AUDIT_LOG)}
              />
            </dl>
            <div className="audit-admin__actions">
              <button
                type="button"
                className="admin-btn"
                onClick={onRetentionPreview}
              >
                {t("retentionRefreshButton")}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={onRetentionExecute}
                disabled={retentionItems.length === 0}
              >
                {t("retentionExecuteButton")}
              </button>
            </div>
          </>
        )}
      </section>
      <div className="audit-admin__publish-bar">
        <div>
          <strong>{readOnly ? t("publishedReadOnly") : t("reportDraftStatus")}</strong>
          <p>{t("reportPublishDescription")}</p>
        </div>
        {!readOnly && (
          <div className="audit-admin__actions">
            <button type="button" className="admin-btn" onClick={onSave} disabled={saving}>
              {saving ? t("saving") : t("saveDraftButton")}
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              onClick={onPublish}
              disabled={saving}
            >
              {t("publishButton")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ErrorsView({
  copy,
  state,
  errors,
  type,
  selected,
  onType,
  onSelect,
  onReload,
  onOpenCase,
}: {
  copy: AdminOperationsCopy;
  state: LoadState;
  errors: JsonRecord[];
  type: string;
  selected: JsonRecord | null;
  onType: (value: string) => void;
  onSelect: (error: JsonRecord) => void;
  onReload: () => void;
  onOpenCase: (caseId: string) => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  return (
    <div className="audit-admin__case-layout">
      <section className="admin-card">
        <header className="admin-card__head">
          <div>
            <h2>{t("errorsTitle")}</h2>
            <p>{t("errorsDescription")}</p>
          </div>
          <div className="audit-admin__actions">
            <FilterInput
              label={t("errorTypeFilterLabel")}
              value={type}
              placeholder={t("errorTypeFilterExample")}
              onChange={onType}
            />
            <button type="button" className="admin-btn" onClick={onReload}>
              {t("refresh")}
            </button>
          </div>
        </header>
        <StateNotice state={state} copy={copy} />
        {state === "ready" && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("errorTypeColumn")}</th>
                  <th>{t("customerImpactColumn")}</th>
                  <th>{t("occurredAtColumn")}</th>
                  <th>{t("retryColumn")}</th>
                  <th>{t("resolutionColumn")}</th>
                  <th>{t("internalDetailColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error, index) => (
                  <tr
                    key={readString(error, ["errorId", "id"], `error-${index}`)}
                    className="admin-row-clickable"
                    tabIndex={0}
                    onClick={() => onSelect(error)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(error);
                      }
                    }}
                  >
                    <td>{readString(error, ["type", "errorType"], "-")}</td>
                    <td>{readString(error, ["customerImpact", "impact"], "-")}</td>
                    <td>{formatDate(readString(error, ["occurredAt", "createdAt"]))}</td>
                    <td>
                      {readString(
                        error,
                        ["retryCount", "retryStatus", "retry"],
                        "-",
                      )}
                    </td>
                    <td>{readString(error, ["resolution", "status"], "-")}</td>
                    <td>{safeInternalDetail(error)}</td>
                  </tr>
                ))}
                {errors.length === 0 && (
                  <tr><td colSpan={6} className="admin-empty">{t("errorsEmpty")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="admin-card audit-admin__detail">
        <h2>{t("errorDetailTitle")}</h2>
        {!selected ? (
          <p className="admin-empty">{t("errorDetailSelect")}</p>
        ) : (
          <>
            <dl className="audit-admin__compare">
              <SummaryField label={t("errorTypeColumn")} value={readString(selected, ["type", "errorType"], "-")} />
              <SummaryField label={t("customerImpactColumn")} value={readString(selected, ["customerImpact", "impact"], "-")} />
              <SummaryField label={t("resolutionColumn")} value={readString(selected, ["resolution", "status"], "-")} />
              <SummaryField label={t("internalDetailColumn")} value={safeInternalDetail(selected)} />
            </dl>
            <p className="audit-admin__help">{t("rawStackHiddenNotice")}</p>
            <div className="audit-admin__actions">
              {readString(selected, ["caseId"]) && (
                <button
                  type="button"
                  className="admin-btn admin-btn--primary"
                  onClick={() => onOpenCase(readString(selected, ["caseId"]))}
                >
                  {t("openCaseButton")}
                </button>
              )}
              {readString(selected, ["actionUrl"]) && (
                <a className="admin-btn" href={readString(selected, ["actionUrl"])}>
                  {t("openActionButton")}
                </a>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function LogsView({
  copy,
  state,
  logs,
  filters,
  onFilters,
  onReload,
}: {
  copy: AdminOperationsCopy;
  state: LoadState;
  logs: JsonRecord[];
  filters: { action: string; caseId: string; from: string; to: string };
  onFilters: (filters: { action: string; caseId: string; from: string; to: string }) => void;
  onReload: () => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  return (
    <section className="admin-card">
      <header className="admin-card__head">
        <div>
          <h2>{t("logsTitle")}</h2>
          <p>{t("logsDescription")}</p>
        </div>
        <button type="button" className="admin-btn" onClick={onReload}>
          {t("refresh")}
        </button>
      </header>
      <div className="audit-admin__filters">
        <FilterInput
          label={t("logActionFilterLabel")}
          value={filters.action}
          placeholder={t("logActionFilterExample")}
          onChange={(action) => onFilters({ ...filters, action })}
        />
        <FilterInput
          label={t("logCaseFilterLabel")}
          value={filters.caseId}
          placeholder={t("logCaseFilterExample")}
          onChange={(caseId) => onFilters({ ...filters, caseId })}
        />
        <FilterInput
          type="date"
          label={t("createdFromLabel")}
          value={filters.from}
          onChange={(from) => onFilters({ ...filters, from })}
        />
        <FilterInput
          type="date"
          label={t("createdToLabel")}
          value={filters.to}
          onChange={(to) => onFilters({ ...filters, to })}
        />
      </div>
      <StateNotice state={state} copy={copy} />
      {state === "ready" && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("actionColumn")}</th>
                <th>{t("caseColumn")}</th>
                <th>{t("actorColumn")}</th>
                <th>{t("targetColumn")}</th>
                <th>{t("detailColumn")}</th>
                <th>{t("occurredAtColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={readString(log, ["logId", "id"], `log-${index}`)}>
                  <td>{readString(log, ["action", "type"], "-")}</td>
                  <td>{readString(log, ["publicReference", "caseId"], "-")}</td>
                  <td>{actorLabel(firstValue(log, ["actor", "actorName"]))}</td>
                  <td>{targetLabel(firstValue(log, ["target", "targetLabel"]))}</td>
                  <td>{readString(log, ["detail", "description"], "-")}</td>
                  <td>{formatDate(readString(log, ["createdAt", "occurredAt"]))}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td colSpan={6} className="admin-empty">{t("logsEmpty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PublishWarningsDialog({
  copy,
  warnings,
  checked,
  loading,
  onChecked,
  onCancel,
  onConfirm,
}: {
  copy: AdminOperationsCopy;
  warnings: string[];
  checked: boolean;
  loading: boolean;
  onChecked: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  return (
    <div className="audit-admin__dialog-backdrop" role="presentation">
      <section
        className="audit-admin__dialog audit-admin__dialog--danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="audit-publish-warning-title"
        aria-describedby="audit-publish-warning-description"
      >
        <h2 id="audit-publish-warning-title">{t("publishWarningTitle")}</h2>
        <p id="audit-publish-warning-description">
          {t("publishWarningDescription")}
        </p>
        <ul className="audit-admin__warning-list">
          {warnings.map((warning, index) => (
            <li key={`${warning}-${index}`}>{warning}</li>
          ))}
        </ul>
        <label className="audit-admin__confirm-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChecked(event.target.checked)}
          />
          <span>{t("publishWarningConfirmLabel")}</span>
        </label>
        <div className="audit-admin__actions">
          <button
            type="button"
            className="admin-btn"
            onClick={onCancel}
            disabled={loading}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            onClick={onConfirm}
            disabled={!checked || loading}
          >
            {loading ? t("processing") : t("publishWarningConfirmButton")}
          </button>
        </div>
      </section>
    </div>
  );
}

function ConfirmationDialog({
  copy,
  confirmation,
  checked,
  loading,
  onChecked,
  onCancel,
  onConfirm,
}: {
  copy: AdminOperationsCopy;
  confirmation: Confirmation;
  checked: boolean;
  loading: boolean;
  onChecked: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const title = t(`${confirmation.action}ConfirmTitle`);
  return (
    <div
      className="admin-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-evaluation-confirm-title"
      aria-describedby="audit-evaluation-confirm-description"
    >
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={t("cancel")}
        onClick={onCancel}
      />
      <div className="admin-modal__panel admin-modal__panel--sm">
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{t("confirmEyebrow")}</p>
            <h2 id="audit-evaluation-confirm-title">{title}</h2>
          </div>
          <button type="button" className="admin-btn admin-btn--ghost" onClick={onCancel}>
            {t("close")}
          </button>
        </header>
        <div className="admin-modal__body">
          <p id="audit-evaluation-confirm-description" className="admin-modal__lede">
            {t(`${confirmation.action}ConfirmDescription`)}
          </p>
          <label className="audit-admin__confirm-check">
            <input
              autoFocus
              type="checkbox"
              checked={checked}
              onChange={(event) => onChecked(event.target.checked)}
            />
            <span>{t(`${confirmation.action}ConfirmCheckbox`)}</span>
          </label>
          <div className="admin-modal__actions">
            <button type="button" className="admin-btn" onClick={onCancel} disabled={loading}>
              {t("cancel")}
            </button>
            <button
              type="button"
              className={
                confirmation.action === "reprocess"
                  ? "admin-btn admin-btn--danger"
                  : "admin-btn admin-btn--primary"
              }
              onClick={onConfirm}
              disabled={!checked || loading}
            >
              {loading ? t("processing") : t("confirmAction")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailTable({
  title,
  empty,
  rows,
  columns,
}: {
  title: string;
  empty: string;
  rows: JsonRecord[];
  columns: ReadonlyArray<readonly [string, readonly string[]]>;
}) {
  return (
    <section className="audit-admin__detail-section">
      <h3>{title}</h3>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>{columns.map(([label]) => <th key={label}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={readString(row, ["id", "documentId", "correctionId"], `row-${index}`)}>
                {columns.map(([label, keys]) => (
                  <td key={label}>
                    {keys.some((key) => key.toLowerCase().includes("at"))
                      ? formatDate(readString(row, keys))
                      : displayValue(firstValue(row, keys))}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="admin-empty">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccessSummary({
  copy,
  detail,
}: {
  copy: AdminOperationsCopy;
  detail: JsonRecord;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  const access = readNestedRecord(detail, ["access", "accessStatus"]);
  const accessSource = Object.keys(access).length > 0 ? access : detail;
  return (
    <section className="audit-admin__detail-section">
      <h3>{t("accessTitle")}</h3>
      <dl className="audit-admin__compare">
        <SummaryField label={t("accessStatusLabel")} value={readString(readNestedRecord(detail, ["case"]), ["status"], readString(accessSource, ["status"], "-"))} />
        <SummaryField label={t("accessIssuedLabel")} value={formatDate(readString(accessSource, ["issuedAt", "createdAt"]))} />
        <SummaryField label={t("accessExpiresLabel")} value={formatDate(readString(accessSource, ["expiresAt", "accessExpiry"]))} />
        <SummaryField label={t("accessLastUsedLabel")} value={formatDate(readString(accessSource, ["lastUsedAt"]))} />
      </dl>
    </section>
  );
}

function StateNotice({
  state,
  copy,
  detail = false,
}: {
  state: LoadState;
  copy: AdminOperationsCopy;
  detail?: boolean;
}) {
  const t = copy.section("auditEvaluationAdmin").text;
  if (state === "idle" || state === "ready") return null;
  const message =
    state === "loading"
      ? detail
        ? t("detailLoading")
        : t("loading")
      : state === "denied"
        ? t("permissionDenied")
        : detail
          ? t("detailError")
          : t("loadError");
  return (
    <p
      className={`audit-admin__state audit-admin__state--${state}`}
      role={state === "error" || state === "denied" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

function StatusChip({
  value,
  rawValue = value,
}: {
  value: string;
  rawValue?: string;
}) {
  const normalized = rawValue.toLowerCase();
  const tone =
    normalized.includes("fail") || normalized.includes("error")
      ? "red"
      : normalized.includes("publish") ||
          normalized.includes("complete") ||
          normalized.includes("ready")
        ? "green"
        : normalized.includes("draft") || normalized.includes("review")
          ? "amber"
          : "blue";
  return <span className={`admin-pill admin-pill--${tone}`}>{value || "-"}</span>;
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        className="admin-input"
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <select
        className="admin-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

function Field({
  label,
  help,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
  disabled,
  required,
}: {
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        className="admin-input"
        type={type}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
      {help && <small className="admin-form__hint">{help}</small>}
    </label>
  );
}

function NumberField({
  label,
  help,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <input
        className="admin-input"
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {help && <small className="admin-form__hint">{help}</small>}
    </label>
  );
}

function ColorField({
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="admin-field audit-admin__color-field">
      <span>{label}</span>
      <span>
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#166534"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          className="admin-input"
          value={value}
          pattern="^#[0-9A-Fa-f]{6}$"
          maxLength={7}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      <small className="admin-form__hint">{help}</small>
    </label>
  );
}

function ConfigSelect({
  label,
  value,
  configs,
  onChange,
}: {
  label: string;
  value: string;
  configs: ConfigDraft[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <select
        className="admin-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">-</option>
        {configs.map((config) => (
          <option key={configKey(config)} value={configKey(config)}>
            {config.name} · {config.version} · {config.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function correctionColumns(
  t: (key: string) => string,
): ReadonlyArray<readonly [string, readonly string[]]> {
  return [
    [t("fieldColumn"), ["fieldLabel", "label", "field"]],
    [t("beforeValueColumn"), ["beforeValue", "previousValue", "originalExtractedValue"]],
    [t("afterValueColumn"), ["afterValue", "correctedValue", "value"]],
    [t("reasonColumn"), ["reason"]],
    [t("actorColumn"), ["actor", "actorName", "correctedBy"]],
    [t("createdAtColumn"), ["createdAt", "correctedAt"]],
  ];
}

function capitalize(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
