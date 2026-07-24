import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type EvaluationConfig,
  type EvaluationLeafRule,
  type NormalizedAuditQuote,
  type NormalizedAuditQuoteField,
  type QuoteEvidenceValue,
  type TrustedStandardQuotePayload,
} from "@/lib/audit-evaluation/types";
import { normalizedAuditQuoteSchema } from "@/lib/audit-evaluation/quote-extraction-schemas";
import { trustedStandardQuotePayloadSchema } from "@/lib/audit-evaluation/quote-document-schemas";

export type PartnerEvaluationControl =
  | "money"
  | "integer"
  | "tag-list"
  | "experience"
  | "person"
  | "team-list"
  | "schedule-list"
  | "text-list"
  | "proposal-checklist";

export type PartnerEvaluationField = {
  id: NormalizedAuditQuoteField;
  label: string;
  help: string;
  section: "법인 정보" | "감사 경험" | "투입인력" | "수행계획" | "제안 충실성";
  control: PartnerEvaluationControl;
  required: boolean;
  checklistItems?: Array<{
    id: string;
    label: string;
    required: boolean;
  }>;
};

export type PartnerEvaluationForm = {
  configId: string;
  configVersion: number;
  configName: string;
  source: "published" | "fallback";
  criteria: Array<{
    id: string;
    name: string;
    description: string;
    weightPercent: number;
    required: boolean;
    fieldIds: NormalizedAuditQuoteField[];
  }>;
  fields: PartnerEvaluationField[];
};

export type PartnerEvaluationAnswers = Partial<
  Record<NormalizedAuditQuoteField, QuoteEvidenceValue>
>;

export type PartnerEvaluationNormalization = {
  answers: PartnerEvaluationAnswers;
  normalizedQuote: NormalizedAuditQuote;
  missingRequiredFields: NormalizedAuditQuoteField[];
  missingRequiredProposalItemIds: string[];
};

const FIELD_PRESENTATION: Partial<
  Record<
    NormalizedAuditQuoteField,
    Omit<PartnerEvaluationField, "id" | "required" | "checklistItems">
  >
> = {
  accountingFirmRevenue: {
    label: "회계법인 연간 매출액",
    help: "최근 확정 재무제표 기준 금액을 원 단위로 입력해 주세요.",
    section: "법인 정보",
    control: "money",
  },
  recentNonghyupAuditCount: {
    label: "최근 3년 농협 감사 수행 건수",
    help: "계약 또는 완료 사실을 확인할 수 있는 수행 건수를 입력해 주세요.",
    section: "감사 경험",
    control: "integer",
  },
  auditedNonghyupTypes: {
    label: "감사 수행 농협 유형",
    help: "지역농협, 품목농협, 축협 등 수행 경험이 있는 유형을 구분해 입력해 주세요.",
    section: "감사 경험",
    control: "tag-list",
  },
  taxAgencyExperience: {
    label: "농협 세무대리 경험",
    help: "경험 유무와 대표 수행사례를 입력해 주세요.",
    section: "감사 경험",
    control: "experience",
  },
  subsidySettlementExperience: {
    label: "농협 보조금 정산 경험",
    help: "경험 유무와 대표 수행사례를 입력해 주세요.",
    section: "감사 경험",
    control: "experience",
  },
  engagementPartner: {
    label: "책임회계사",
    help: "성명, 직급, 총 경력연수를 입력해 주세요.",
    section: "투입인력",
    control: "person",
  },
  engagementTeam: {
    label: "감사 투입인력",
    help: "투입 인력별 성명, 역할, 예정 투입시간을 입력해 주세요.",
    section: "투입인력",
    control: "team-list",
  },
  totalPlannedHours: {
    label: "총 예정 투입시간",
    help: "전체 감사팀의 예정 투입시간 합계를 입력해 주세요.",
    section: "투입인력",
    control: "integer",
  },
  partnerHours: {
    label: "책임회계사 예정 투입시간",
    help: "총 투입시간 중 책임회계사가 직접 투입하는 시간을 입력해 주세요.",
    section: "투입인력",
    control: "integer",
  },
  auditSchedule: {
    label: "감사 수행 일정",
    help: "단계별 업무명과 시작일·종료일을 입력해 주세요.",
    section: "수행계획",
    control: "schedule-list",
  },
  qualityControlPlan: {
    label: "품질관리 계획",
    help: "검토 체계, 주요 보고 절차, 커뮤니케이션 계획을 항목별로 입력해 주세요.",
    section: "수행계획",
    control: "text-list",
  },
  requiredProposalItems: {
    label: "필수 제안항목",
    help: "각 평가항목의 포함 여부와 구체적인 제안 내용을 입력해 주세요.",
    section: "제안 충실성",
    control: "proposal-checklist",
  },
};

const DERIVED_FIELDS = new Set<NormalizedAuditQuoteField>([
  "accountingFirmId",
  "accountingFirmName",
  "auditFee",
  "vatIncluded",
]);

const STANDARD_PARTNER_INPUT_FIELDS = new Set<NormalizedAuditQuoteField>([
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
]);

export function buildPartnerEvaluationForm(
  config: EvaluationConfig,
  source: PartnerEvaluationForm["source"],
): PartnerEvaluationForm {
  const required = requiredFieldsForConfig(config);
  const usedFields = fieldsForConfig(config);
  const checklistItems = proposalItemsForConfig(config);
  const fields = NORMALIZED_AUDIT_QUOTE_FIELDS.flatMap((id) => {
    if (!usedFields.has(id) || DERIVED_FIELDS.has(id)) return [];
    const presentation = FIELD_PRESENTATION[id];
    if (!presentation) return [];
    return [{
      id,
      ...presentation,
      required: required.has(id),
      ...(id === "requiredProposalItems" ? { checklistItems } : {}),
    }];
  });

  return {
    configId: config.id,
    configVersion: config.version,
    configName: config.name,
    source,
    criteria: config.criteria.map((criterion) => ({
      id: criterion.id,
      name: criterion.name,
      description: criterion.description,
      weightPercent: criterion.weightBasisPoints / 100,
      required: criterion.required,
      fieldIds: fieldsForCriterion(criterion.rule),
    })),
    fields,
  };
}

export function normalizePartnerEvaluationAnswers(input: {
  config: EvaluationConfig;
  rawAnswers: unknown;
  quoteId: string;
  quoteRequestId: string;
  partnerId: string;
  partnerName: string;
  auditFeeWon: number;
  vatIncluded: boolean;
  now: string;
}): PartnerEvaluationNormalization {
  const raw = isRecord(input.rawAnswers) ? input.rawAnswers : {};
  const answers: PartnerEvaluationAnswers = {};
  const present = new Set<NormalizedAuditQuoteField>();

  const accountingFirmRevenue = moneyAnswer(raw.accountingFirmRevenue);
  setAnswer("accountingFirmRevenue", accountingFirmRevenue);
  const recentNonghyupAuditCount = integerAnswer(raw.recentNonghyupAuditCount);
  setAnswer("recentNonghyupAuditCount", recentNonghyupAuditCount);
  const auditedNonghyupTypes = stringListAnswer(raw.auditedNonghyupTypes);
  setAnswer("auditedNonghyupTypes", auditedNonghyupTypes);
  const taxAgencyExperience = experienceAnswer(raw.taxAgencyExperience);
  setAnswer("taxAgencyExperience", taxAgencyExperience);
  const subsidySettlementExperience = experienceAnswer(
    raw.subsidySettlementExperience,
  );
  setAnswer("subsidySettlementExperience", subsidySettlementExperience);
  const engagementPartner = personAnswer(raw.engagementPartner);
  setAnswer("engagementPartner", engagementPartner);
  const engagementTeam = teamAnswer(raw.engagementTeam);
  setAnswer("engagementTeam", engagementTeam);
  const totalPlannedHours = integerAnswer(raw.totalPlannedHours);
  setAnswer("totalPlannedHours", totalPlannedHours);
  const partnerHours = integerAnswer(raw.partnerHours);
  setAnswer("partnerHours", partnerHours);
  const auditSchedule = scheduleAnswer(raw.auditSchedule);
  setAnswer("auditSchedule", auditSchedule);
  const qualityControlPlan = stringListAnswer(raw.qualityControlPlan);
  setAnswer("qualityControlPlan", qualityControlPlan);
  const requiredProposalItems = proposalAnswer(raw.requiredProposalItems);
  setAnswer("requiredProposalItems", requiredProposalItems);

  present.add("accountingFirmId");
  present.add("accountingFirmName");
  present.add("auditFee");
  present.add("vatIncluded");

  const normalizedQuote = normalizedAuditQuoteSchema.parse({
    quoteId: input.quoteId,
    caseId: input.quoteRequestId,
    documentId: input.quoteId,
    accountingFirmId: input.partnerId,
    accountingFirmName: input.partnerName,
    auditFee: String(input.auditFeeWon),
    vatIncluded: input.vatIncluded,
    accountingFirmRevenue: accountingFirmRevenue ?? null,
    recentNonghyupAuditCount: recentNonghyupAuditCount ?? null,
    auditedNonghyupTypes: auditedNonghyupTypes ?? [],
    taxAgencyExperience: taxAgencyExperience ?? {
      hasExperience: false,
      descriptions: [],
    },
    subsidySettlementExperience: subsidySettlementExperience ?? {
      hasExperience: false,
      descriptions: [],
    },
    engagementPartner,
    engagementTeam: engagementTeam ?? [],
    totalPlannedHours: totalPlannedHours ?? null,
    partnerHours: partnerHours ?? null,
    auditSchedule: auditSchedule ?? [],
    qualityControlPlan: qualityControlPlan ?? [],
    requiredProposalItems: requiredProposalItems ?? {},
    missingFields: NORMALIZED_AUDIT_QUOTE_FIELDS.filter(
      (field) => !present.has(field),
    ),
    warnings: [],
    confidenceByField: Object.fromEntries(
      [...present].map((field) => [field, 100]),
    ),
    evidenceByField: {},
    source: Object.fromEntries(
      [...present].map((field) => [field, "TRUSTED_SERVER_RECORD"]),
    ),
    confirmedByCustomer: false,
    confirmedAt: null,
    revision: 0,
    updatedAt: input.now,
  });

  const required = requiredFieldsForConfig(input.config);
  const missingRequiredFields = NORMALIZED_AUDIT_QUOTE_FIELDS.filter(
    (field) => required.has(field) && !present.has(field),
  );
  const missingRequiredProposalItemIds = proposalItemsForConfig(input.config)
    .filter(
      (item) =>
        item.required &&
        !Object.prototype.hasOwnProperty.call(
          requiredProposalItems ?? {},
          item.id,
        ),
    )
    .map((item) => item.id);

  return {
    answers,
    normalizedQuote,
    missingRequiredFields,
    missingRequiredProposalItemIds,
  };

  function setAnswer(
    field: NormalizedAuditQuoteField,
    value: QuoteEvidenceValue | undefined,
  ) {
    if (value === undefined || value === null) return;
    answers[field] = value;
    present.add(field);
  }
}

export function toTrustedStandardQuotePayload(
  quote: NormalizedAuditQuote,
): TrustedStandardQuotePayload {
  return trustedStandardQuotePayloadSchema.parse({
    accountingFirmId: quote.accountingFirmId,
    accountingFirmName: quote.accountingFirmName,
    auditFee: quote.auditFee,
    vatIncluded: quote.vatIncluded,
    accountingFirmRevenue: quote.accountingFirmRevenue,
    recentNonghyupAuditCount: quote.recentNonghyupAuditCount,
    auditedNonghyupTypes: quote.auditedNonghyupTypes,
    taxAgencyExperience: quote.taxAgencyExperience,
    subsidySettlementExperience: quote.subsidySettlementExperience,
    engagementPartner: quote.engagementPartner,
    engagementTeam: quote.engagementTeam,
    totalPlannedHours: quote.totalPlannedHours,
    partnerHours: quote.partnerHours,
    auditSchedule: quote.auditSchedule,
    qualityControlPlan: quote.qualityControlPlan,
    requiredProposalItems: quote.requiredProposalItems,
  });
}

function requiredFieldsForConfig(
  config: EvaluationConfig,
): Set<NormalizedAuditQuoteField> {
  const required = new Set([
    ...config.requiredFields,
    ...STANDARD_PARTNER_INPUT_FIELDS,
  ]);
  for (const criterion of config.criteria) {
    if (!criterion.required) continue;
    for (const field of fieldsForCriterion(criterion.rule)) {
      required.add(field);
    }
  }
  return required;
}

function fieldsForConfig(
  config: EvaluationConfig,
): Set<NormalizedAuditQuoteField> {
  const fields = new Set([
    ...config.requiredFields,
    ...STANDARD_PARTNER_INPUT_FIELDS,
  ]);
  for (const criterion of config.criteria) {
    for (const field of fieldsForCriterion(criterion.rule)) fields.add(field);
  }
  return fields;
}

function fieldsForCriterion(
  rule: EvaluationConfig["criteria"][number]["rule"],
): NormalizedAuditQuoteField[] {
  const leafRules =
    rule.type === "weighted-subcriteria"
      ? rule.subcriteria.map((item) => item.rule)
      : [rule];
  return [
    ...new Set(leafRules.flatMap((leaf) => fieldsForLeafRule(leaf))),
  ];
}

function fieldsForLeafRule(
  rule: EvaluationLeafRule,
): NormalizedAuditQuoteField[] {
  if (rule.type !== "checklist") return [rule.field];
  return [
    rule.field,
    ...rule.items.flatMap((item) => {
      const condition = item.condition;
      return condition?.type === "FIELD_PRESENT" ||
          condition?.type === "BOOLEAN_EQUALS" ||
          condition?.type === "MINIMUM_INTEGER"
        ? [condition.field]
        : condition?.type === "PROPOSAL_ITEM_PRESENT"
          ? ["requiredProposalItems" as const]
          : [];
    }),
  ];
}

function proposalItemsForConfig(config: EvaluationConfig) {
  const items = config.criteria.flatMap((criterion) => {
    const rules =
      criterion.rule.type === "weighted-subcriteria"
        ? criterion.rule.subcriteria.map((item) => item.rule)
        : [criterion.rule];
    return rules.flatMap((rule) =>
      rule.type === "checklist" && rule.field === "requiredProposalItems"
        ? rule.items.map((item) => ({
            id:
              item.condition?.type === "PROPOSAL_ITEM_PRESENT"
                ? item.condition.itemId
                : item.id,
            label: item.label,
            required: item.required,
          }))
        : [],
    );
  });
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function moneyAnswer(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const digits = String(value).replaceAll(",", "").replace(/[^\d]/g, "");
  return /^(?:0|[1-9]\d{0,29})$/.test(digits) ? digits : undefined;
}

function integerAnswer(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringListAnswer(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/u)
      : [];
  const normalized = values
    .map((item) => String(item).trim().slice(0, 2_000))
    .filter(Boolean)
    .slice(0, 100);
  return normalized.length > 0 ? normalized : undefined;
}

function experienceAnswer(value: unknown) {
  if (!isRecord(value) || typeof value.hasExperience !== "boolean") {
    return undefined;
  }
  return {
    hasExperience: value.hasExperience,
    descriptions: stringListAnswer(value.descriptions) ?? [],
  };
}

function personAnswer(value: unknown) {
  if (!isRecord(value)) return undefined;
  const name = String(value.name ?? "").trim().slice(0, 200);
  if (!name) return undefined;
  const title = String(value.title ?? "").trim().slice(0, 200);
  const years = integerAnswer(value.yearsOfExperience);
  return {
    name,
    title: title || null,
    yearsOfExperience: years ?? null,
  };
}

function teamAnswer(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const team = value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const name = String(item.name ?? "").trim().slice(0, 200);
    const role = String(item.role ?? "").trim().slice(0, 200);
    if (!name || !role) return [];
    return [{
      name,
      role,
      plannedHours: integerAnswer(item.plannedHours) ?? null,
    }];
  }).slice(0, 100);
  return team.length > 0 ? team : undefined;
}

function scheduleAnswer(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const schedule = value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const label = String(item.label ?? "").trim().slice(0, 200);
    if (!label) return [];
    return [{
      id: `schedule-${index + 1}`,
      label,
      startsOn: dateAnswer(item.startsOn),
      endsOn: dateAnswer(item.endsOn),
    }];
  }).slice(0, 100);
  return schedule.length > 0 ? schedule : undefined;
}

function proposalAnswer(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([id, item]) => {
    if (!/^[a-z][a-zA-Z0-9._-]{0,79}$/.test(id) || !isRecord(item)) {
      return [];
    }
    if (typeof item.present !== "boolean") return [];
    const detail = String(item.value ?? "").trim().slice(0, 2_000);
    return [[id, { present: item.present, value: detail || null }] as const];
  }).slice(0, 100);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function dateAnswer(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
