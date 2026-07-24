import type { PdfPageText, PdfTextCoordinates } from "@/lib/audit-evaluation/pdf-text-extractor";
import {
  emptyExtractionFields,
  parseVatTreatment,
  parseWonAmountText,
  quoteExtractionCandidateSchema,
  type ExtractionEvidence,
  type ExtractionWarning,
  type QuoteExtractionCandidate,
  type QuoteExtractionFields,
} from "@/lib/audit-evaluation/quote-extraction-schemas";
import type {
  AuditScheduleItem,
  EngagementPartner,
  EngagementTeamMember,
  ExperienceSummary,
  NormalizedAuditQuoteField,
  ProposalItemValue,
} from "@/lib/audit-evaluation/types";

type PageLine = {
  pageNumber: number;
  text: string;
  coordinates: PdfTextCoordinates | null;
};

type LabelMatch = {
  line: PageLine;
  value: string;
};

const MAX_INPUT_TEXT = 2_000_000;
const MAX_LINES = 20_000;
const MAX_VALUE = 2_000;

export function parseQuoteDeterministically(
  pages: readonly PdfPageText[],
): QuoteExtractionCandidate {
  const lines = collectLines(pages);
  const fields = emptyExtractionFields();
  const warnings: ExtractionWarning[] = [];
  const evidenceByField: QuoteExtractionCandidate["evidenceByField"] = {};
  const confidenceByField: QuoteExtractionCandidate["confidenceByField"] = {};

  setUniqueText(
    "accountingFirmId",
    findLabels(lines, /^(?:회계법인\s*(?:ID|아이디)|등록번호)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setUniqueText(
    "accountingFirmName",
    findLabels(lines, /^(?:회계법인명|법인명|제안사)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );

  const feeMatches = findLabels(
    lines,
    /^(?:감사보수|감사보수액|감사용역비|제안금액)\s*[:：]\s*(.+)$/i,
  );
  setMoney(
    "auditFee",
    feeMatches,
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setVat(feeMatches, fields, warnings, evidenceByField, confidenceByField);

  setMoney(
    "accountingFirmRevenue",
    findLabels(
      lines,
      /^(?:회계법인\s*)?(?:매출액|연간매출액)\s*[:：]\s*(.+)$/i,
    ),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setInteger(
    "recentNonghyupAuditCount",
    findLabels(
      lines,
      /^(?:최근\s*\d+\s*년\s*)?(?:농협|농·축협|농축협)\s*감사(?:실적|건수)\s*[:：]\s*(.+)$/i,
    ),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setStringList(
    "auditedNonghyupTypes",
    findLabels(
      lines,
      /^(?:감사\s*)?(?:농협종류|농협유형|농협유형별\s*실적)\s*[:：]\s*(.+)$/i,
    ),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );

  setExperience(
    "taxAgencyExperience",
    findLabels(lines, /^(?:세무대리|세무대리경험|세무조정경험)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setExperience(
    "subsidySettlementExperience",
    findLabels(
      lines,
      /^(?:보조금|보조금정산|보조금정산경험)\s*[:：]\s*(.+)$/i,
    ),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );

  setPartner(
    findLabels(lines, /^(?:담당이사|업무수행이사|책임회계사)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setTeam(
    findLabels(lines, /^(?:투입인력|감사팀|업무수행팀)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setInteger(
    "totalPlannedHours",
    findLabels(lines, /^(?:총\s*)?(?:투입시간|예정시간|감사시간)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setInteger(
    "partnerHours",
    findLabels(lines, /^(?:담당이사|파트너)\s*(?:투입)?시간\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );

  setSchedule(
    findLabels(lines, /^(?:감사일정|업무일정|수행일정)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setStringList(
    "qualityControlPlan",
    findLabels(lines, /^(?:품질관리|품질관리계획|품질보증)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );
  setRequiredItems(
    findLabels(lines, /^(?:필수제안항목|필수제안사항)\s*[:：]\s*(.+)$/i),
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  );

  return quoteExtractionCandidateSchema.parse({
    fields,
    warnings,
    evidenceByField,
    confidenceByField,
  });
}

function collectLines(pages: readonly PdfPageText[]): PageLine[] {
  const lines: PageLine[] = [];
  let consumed = 0;
  for (const page of pages) {
    const remaining = MAX_INPUT_TEXT - consumed;
    if (remaining <= 0 || lines.length >= MAX_LINES) break;
    const text = page.text.slice(0, remaining);
    consumed += text.length;
    for (const rawLine of text.split(/\r?\n/)) {
      if (lines.length >= MAX_LINES) break;
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      const item = page.items.find((candidate) =>
        line.includes(candidate.text.trim()),
      );
      lines.push({
        pageNumber: page.pageNumber,
        text: line.slice(0, MAX_VALUE),
        coordinates: item?.coordinates ?? null,
      });
    }
  }
  return lines;
}

function findLabels(lines: readonly PageLine[], pattern: RegExp): LabelMatch[] {
  return lines.flatMap((line) => {
    const match = line.text.match(pattern);
    const value = match?.[1]?.trim().slice(0, MAX_VALUE);
    return value ? [{ line, value }] : [];
  });
}

function setUniqueText(
  field: "accountingFirmId" | "accountingFirmName",
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch(field, matches, warnings);
  if (!selected) return;
  fields[field] = selected.value;
  setEvidence(field, selected, evidence, confidence);
}

function setMoney(
  field: "auditFee" | "accountingFirmRevenue",
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch(field, matches, warnings);
  if (!selected) return;
  const parsed = parseWonAmountText(selected.value);
  if (!parsed.value) {
    addWarning(warnings, parsed.warning?.code ?? "INVALID_AMOUNT", field,
      parsed.warning?.message ?? "금액을 확정할 수 없습니다.");
    return;
  }
  fields[field] = parsed.value;
  setEvidence(field, selected, evidence, confidence);
}

function setVat(
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch("vatIncluded", matches, warnings);
  if (!selected) return;
  const parsed = parseVatTreatment(selected.value);
  if (parsed.value === null) {
    addWarning(warnings, parsed.warning?.code ?? "VAT_NOT_STATED", "vatIncluded",
      parsed.warning?.message ?? "부가세 포함 여부를 확정할 수 없습니다.");
    return;
  }
  fields.vatIncluded = parsed.value;
  setEvidence("vatIncluded", selected, evidence, confidence);
}

function setInteger(
  field: "recentNonghyupAuditCount" | "totalPlannedHours" | "partnerHours",
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch(field, matches, warnings);
  if (!selected) return;
  const match = selected.value.match(/(?:^|\s)(\d[\d,]*)\s*(?:건|시간)?(?:\s|$)/);
  const value = match ? Number(match[1].replaceAll(",", "")) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 0) {
    addWarning(warnings, "INVALID_INTEGER", field, "정수 값을 확정할 수 없습니다.");
    return;
  }
  fields[field] = value;
  setEvidence(field, selected, evidence, confidence);
}

function setStringList(
  field: "auditedNonghyupTypes" | "qualityControlPlan",
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch(field, matches, warnings);
  if (!selected) return;
  const values = splitList(selected.value);
  if (values.length === 0) return;
  fields[field] = values;
  setEvidence(field, selected, evidence, confidence);
}

function setExperience(
  field: "taxAgencyExperience" | "subsidySettlementExperience",
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch(field, matches, warnings);
  if (!selected) return;
  const negative = /^(?:없음|무|해당없음|미보유)$/i.test(selected.value);
  const positive = /(?:있음|유|보유|수행|경험)/i.test(selected.value);
  if (!negative && !positive) {
    addWarning(warnings, "AMBIGUOUS_EXPERIENCE", field,
      "경험 보유 여부가 명확하지 않습니다.");
    return;
  }
  const summary: ExperienceSummary = {
    hasExperience: !negative,
    descriptions: negative ? [] : [selected.value],
  };
  fields[field] = summary;
  setEvidence(field, selected, evidence, confidence);
}

function setPartner(
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch("engagementPartner", matches, warnings);
  if (!selected) return;
  const parts = selected.value.split(/\s*[,/|]\s*/).filter(Boolean);
  if (!parts[0]) return;
  const years = selected.value.match(/(\d+)\s*년/);
  const partner: EngagementPartner = {
    name: parts[0].replace(/\([^)]*\)/g, "").trim(),
    title: parts[1]?.replace(/\d+\s*년.*/, "").trim() || null,
    yearsOfExperience: years ? Number(years[1]) : null,
  };
  fields.engagementPartner = partner;
  setEvidence("engagementPartner", selected, evidence, confidence);
}

function setTeam(
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch("engagementTeam", matches, warnings);
  if (!selected) return;
  const members = selected.value.split(/\s*;\s*/).flatMap((entry) => {
    const match = entry.match(
      /^([^,(]+)\s*(?:\(([^,)]*?)(?:,\s*(\d+)\s*시간)?\)|[,/]\s*([^,/]+)(?:[,/]\s*(\d+)\s*시간)?)$/,
    );
    if (!match) return [];
    const member: EngagementTeamMember = {
      name: match[1].trim(),
      role: (match[2] ?? match[4] ?? "역할 미상").trim(),
      plannedHours: match[3] || match[5] ? Number(match[3] ?? match[5]) : null,
    };
    return [member];
  });
  if (members.length === 0) {
    addWarning(warnings, "AMBIGUOUS_TEAM", "engagementTeam",
      "투입인력 표기를 구조화할 수 없습니다.");
    return;
  }
  fields.engagementTeam = members;
  setEvidence("engagementTeam", selected, evidence, confidence);
}

function setSchedule(
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch("auditSchedule", matches, warnings);
  if (!selected) return;
  const items: AuditScheduleItem[] = splitList(selected.value).map((label, index) => {
    const dates = [...label.matchAll(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/g)]
      .map((match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
    return {
      id: `schedule-${index + 1}`,
      label,
      startsOn: dates[0] ?? null,
      endsOn: dates[1] ?? dates[0] ?? null,
    };
  });
  fields.auditSchedule = items;
  setEvidence("auditSchedule", selected, evidence, confidence);
}

function setRequiredItems(
  matches: readonly LabelMatch[],
  fields: QuoteExtractionFields,
  warnings: ExtractionWarning[],
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const selected = uniqueMatch("requiredProposalItems", matches, warnings);
  if (!selected) return;
  const items: Record<string, ProposalItemValue> = {};
  splitList(selected.value).forEach((entry, index) => {
    const [label, ...rest] = entry.split(/\s*=\s*|\s*:\s*/);
    const id = safeItemId(label, index);
    items[id] = { present: true, value: rest.join(":").trim() || label };
  });
  fields.requiredProposalItems = items;
  setEvidence("requiredProposalItems", selected, evidence, confidence);
}

function uniqueMatch(
  field: NormalizedAuditQuoteField,
  matches: readonly LabelMatch[],
  warnings: ExtractionWarning[],
): LabelMatch | null {
  if (matches.length === 0) return null;
  const unique = [...new Map(matches.map((match) => [match.value, match])).values()];
  if (unique.length !== 1) {
    addWarning(warnings, "CONFLICTING_VALUES", field,
      "서로 다른 값이 둘 이상 발견되어 자동 확정하지 않았습니다.");
    return null;
  }
  return unique[0];
}

function setEvidence(
  field: NormalizedAuditQuoteField,
  match: LabelMatch,
  evidence: QuoteExtractionCandidate["evidenceByField"],
  confidence: QuoteExtractionCandidate["confidenceByField"],
) {
  const item: ExtractionEvidence = {
    pageNumber: match.line.pageNumber,
    excerpt: match.line.text.slice(0, 500),
    coordinates: match.line.coordinates,
    cellAddress: null,
    validationWarnings: [],
  };
  evidence[field] = [item];
  confidence[field] = 85;
}

function splitList(value: string) {
  return [...new Set(
    value.split(/\s*(?:;|\||•|·)\s*/).map((item) => item.trim()).filter(Boolean),
  )].slice(0, 100);
}

function safeItemId(label: string, index: number) {
  const normalized = label.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 60);
  return /^[a-z]/.test(normalized) ? normalized : `required-${index + 1}`;
}

function addWarning(
  warnings: ExtractionWarning[],
  code: string,
  field: NormalizedAuditQuoteField,
  message: string,
) {
  warnings.push({ code, field, message });
}
