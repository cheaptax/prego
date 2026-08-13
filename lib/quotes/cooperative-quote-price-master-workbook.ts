import ExcelJS from "exceljs";
import type { WonAmount } from "@/lib/audit-evaluation/types";
import type {
  CooperativeQuotePartnerPrice,
  CooperativeQuotePriceMasterRow,
} from "@/lib/quotes/cooperative-quote-price-master-types";
import { parseWonCell } from "@/lib/quotes/cooperative-quote-price-master-schemas";
import {
  NON_SELECTED_FEE_BPS,
  nonSelectedFeeFromPlanned,
  pickRandomPartners,
  safeMinFromPlanned,
} from "@/lib/quotes/cooperative-quote-price-master-pricing";
import { normalizeCooperativeSearchText } from "@/lib/cooperatives/master";

/**
 * Default template = uploaded 농협정보_마스터.xlsx sheet "시트9" columns.
 * 제휴사_* cells store partner names (operator edits only 제휴사_선정).
 */
export const QUOTE_PRICE_MASTER_EXCEL_HEADERS = [
  "cooperativeId",
  "농협명",
  "25년감사인",
  "예정견적",
  "최저안전견적",
  "제휴사_선정",
  "제휴사_비선정1",
  "제휴사_비선정2",
] as const;

type HeaderKey = (typeof QUOTE_PRICE_MASTER_EXCEL_HEADERS)[number];

export type QuotePriceMasterExcelPartner = {
  id: string;
  name: string;
};

export type QuotePriceMasterExcelCooperative = {
  cooperativeId: string;
  cooperativeName: string;
};

export type QuotePriceMasterFeeSeed = {
  cooperativeName: string;
  priorAuditorName?: string;
  plannedAuditFeeWon: string;
  safePriceMinWon?: string | null;
};

export type QuotePriceMasterWideExcelRow = {
  rowNumber: number;
  cooperativeId: string;
  cooperativeName: string;
  priorAuditorName: string;
  plannedAuditFeeWon: WonAmount | null;
  safePriceMinWon: WonAmount | null;
  selectedPartnerName: string;
  nonSelectedPartnerName1: string;
  nonSelectedPartnerName2: string;
};

export type QuotePriceMasterExcelRow = QuotePriceMasterWideExcelRow;

export type QuotePriceMasterExcelValidation = {
  ok: boolean;
  validRows: QuotePriceMasterWideExcelRow[];
  errors: Array<{ rowNumber: number; code: string; message: string }>;
  summary: {
    totalRows: number;
    validRows: number;
    errorRows: number;
    cooperativeCount: number;
    partnerCount: number;
  };
};

export async function buildQuotePriceMasterWorkbook(input: {
  fiscalYear: number;
  cooperatives: readonly QuotePriceMasterExcelCooperative[];
  partners: readonly QuotePriceMasterExcelPartner[];
  savedRows?: readonly CooperativeQuotePriceMasterRow[];
  feeSeeds?: readonly QuotePriceMasterFeeSeed[];
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NH support";
  workbook.created = new Date();

  const guide = workbook.addWorksheet("안내");
  guide.getColumn(1).width = 88;
  guide.addRow(["농협 견적 마스터 엑셀 안내"]);
  guide.addRow([
    "1) 시트9에서 예정견적·최저안전견적을 확인하고, 제휴사_선정만 제휴사목록에서 고르세요.",
  ]);
  guide.addRow([
    "2) 제휴사_비선정1·2는 비워 두면 업로드 반영 시 나머지 제휴사 중 자동 랜덤 배정됩니다.",
  ]);
  guide.addRow([
    "3) 제휴사_* 칸에는 금액이 아니라 제휴사 이름을 넣어야 합니다.",
  ]);
  guide.getRow(1).font = { bold: true, size: 14 };

  const partnerSheet = workbook.addWorksheet("제휴사목록");
  partnerSheet.addRow(["partnerId", "제휴사명"]);
  const partners = [...input.partners].sort((left, right) =>
    left.name.localeCompare(right.name, "ko"),
  );
  for (const partner of partners) {
    partnerSheet.addRow([partner.id, partner.name]);
  }
  partnerSheet.getRow(1).font = { bold: true };
  partnerSheet.getColumn(1).width = 28;
  partnerSheet.getColumn(2).width = 32;

  const sheet = workbook.addWorksheet("시트9");
  sheet.addRow([...QUOTE_PRICE_MASTER_EXCEL_HEADERS]);

  const savedByCooperative = new Map<string, CooperativeQuotePriceMasterRow>();
  for (const row of input.savedRows ?? []) {
    savedByCooperative.set(row.plan.cooperativeId, row);
  }
  const feeSeedByName = new Map<string, QuotePriceMasterFeeSeed>();
  for (const seed of input.feeSeeds ?? []) {
    feeSeedByName.set(
      normalizeCooperativeSearchText(seed.cooperativeName),
      seed,
    );
  }

  const cooperatives = [...input.cooperatives].sort((left, right) =>
    left.cooperativeName.localeCompare(right.cooperativeName, "ko"),
  );

  for (const cooperative of cooperatives) {
    const saved = savedByCooperative.get(cooperative.cooperativeId);
    const seed =
      feeSeedByName.get(
        normalizeCooperativeSearchText(cooperative.cooperativeName),
      ) ?? null;
    const winner =
      saved?.prices.find((price) => price.isPlannedWinner) ??
      saved?.prices.find(
        (price) => price.partnerId === saved.plan.plannedWinnerPartnerId,
      ) ??
      null;
    const nonWinners = (saved?.prices ?? []).filter(
      (price) => !price.isPlannedWinner && price.partnerId !== winner?.partnerId,
    );
    let nonSelected = nonWinners.slice(0, 2);
    if (winner && nonSelected.length < 2 && input.partners.length > 0) {
      const remaining = input.partners.filter(
        (partner) =>
          partner.id !== winner.partnerId &&
          !nonSelected.some((item) => item.partnerId === partner.id),
      );
      const picked = pickRandomPartners(remaining, 2 - nonSelected.length);
      nonSelected = [
        ...nonSelected,
        ...picked.map((partner) =>
          syntheticNonSelectedPrice({
            cooperative,
            partner,
            planned: winner.plannedAuditFeeWon,
            index: nonSelected.length,
            fiscalYear: input.fiscalYear,
          }),
        ),
      ];
    }

    const planned =
      winner?.plannedAuditFeeWon ||
      seed?.plannedAuditFeeWon ||
      "";
    const safeMin =
      winner?.safePriceMinWon ||
      seed?.safePriceMinWon ||
      (planned ? safeMinFromPlanned(String(planned) as WonAmount) : "");
    const priorAuditor =
      (saved?.plan.notes?.startsWith("priorAuditor:")
        ? saved.plan.notes.slice("priorAuditor:".length).split("\n")[0]
        : "") ||
      seed?.priorAuditorName ||
      "";

    sheet.addRow([
      cooperative.cooperativeId,
      cooperative.cooperativeName,
      priorAuditor,
      planned ? Number(planned) : "",
      safeMin ? Number(safeMin) : "",
      winner?.partnerName ?? "",
      // Keep non-selected blank in fresh template so operators only fill 선정.
      winner ? nonSelected[0]?.partnerName ?? "" : "",
      winner ? nonSelected[1]?.partnerName ?? "" : "",
    ]);
  }

  sheet.columns.forEach((column, index) => {
    column.width = index <= 1 ? 28 : index === 5 ? 22 : 16;
  });
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };
  sheet.getCell("F1").note =
    "제휴사목록 시트 이름을 입력하거나 아래 드롭다운에서 선택하세요. 금액 금지.";
  sheet.getCell("G1").note =
    "비워 두면 업로드 반영 시 자동 랜덤 배정됩니다.";
  sheet.getCell("H1").note =
    "비워 두면 업로드 반영 시 자동 랜덤 배정됩니다.";

  if (partners.length > 0 && cooperatives.length > 0) {
    const lastDataRow = cooperatives.length + 1;
    const listEnd = partners.length + 1;
    (
      sheet as ExcelJS.Worksheet & {
        dataValidations: {
          add: (
            range: string,
            validation: ExcelJS.DataValidation,
          ) => void;
        };
      }
    ).dataValidations.add(`F2:F${lastDataRow}`, {
      type: "list",
      allowBlank: true,
      formulae: [`제휴사목록!$B$2:$B$${listEnd}`],
      showErrorMessage: true,
      errorTitle: "제휴사_선정",
      error: "제휴사목록에 있는 제휴사명만 선택하세요.",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function syntheticNonSelectedPrice(input: {
  cooperative: QuotePriceMasterExcelCooperative;
  partner: QuotePriceMasterExcelPartner;
  planned: WonAmount;
  index: number;
  fiscalYear: number;
}): CooperativeQuotePartnerPrice {
  const fee = nonSelectedFeeFromPlanned(
    input.planned,
    NON_SELECTED_FEE_BPS[input.index] ?? 11_000n,
  );
  const now = new Date().toISOString();
  return {
    id: `${input.fiscalYear}_${input.cooperative.cooperativeId}_${input.partner.id}`,
    fiscalYear: input.fiscalYear,
    cooperativeId: input.cooperative.cooperativeId,
    cooperativeName: input.cooperative.cooperativeName,
    partnerId: input.partner.id,
    partnerName: input.partner.name,
    plannedAuditFeeWon: fee,
    expenseBillingMode: "INCLUDED_IN_AUDIT_FEE",
    expectedExpenseWon: "0" as WonAmount,
    safePriceMinWon: safeMinFromPlanned(fee),
    safePriceMaxWon: fee,
    isPlannedWinner: false,
    locked: false,
    updatedBy: "system",
    createdAt: now,
    updatedAt: now,
  };
}

export async function parseQuotePriceMasterWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet =
    workbook.getWorksheet("시트9") ||
    workbook.getWorksheet("견적마스터") ||
    workbook.worksheets.find((item) => item.name !== "안내" && item.name !== "제휴사목록") ||
    workbook.worksheets[0];
  if (!sheet) return [] as QuotePriceMasterWideExcelRow[];

  const headerRowIndex = findHeaderRow(sheet);
  if (!headerRowIndex) return [] as QuotePriceMasterWideExcelRow[];
  const headerRow = sheet.getRow(headerRowIndex);
  const headerByColumn = new Map<number, HeaderKey | "legacy">();
  headerRow.eachCell((cell, columnNumber) => {
    const header = normalizeHeader(String(cell.value ?? ""));
    if (!header) return;
    headerByColumn.set(columnNumber, header);
  });

  const rows: QuotePriceMasterWideExcelRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;
    const valueByHeader = new Map<string, unknown>();
    for (const [columnNumber, header] of headerByColumn.entries()) {
      valueByHeader.set(header, cellValue(row.getCell(columnNumber).value));
    }
    const cooperativeName = stringCell(
      valueByHeader.get("농협명") ?? valueByHeader.get("cooperativeName"),
    );
    const selectedPartnerRaw =
      valueByHeader.get("제휴사_선정") ?? valueByHeader.get("selectedPartnerName");
    const plannedAuditFeeWon = parseWonCell(
      valueByHeader.get("예정견적") ?? valueByHeader.get("plannedAuditFeeWon"),
    );
    if (!cooperativeName && !partnerNameCell(selectedPartnerRaw) && !plannedAuditFeeWon) {
      return;
    }

    const safeRaw = parseWonCell(
      valueByHeader.get("최저안전견적") ?? valueByHeader.get("safePriceMinWon"),
    );
    rows.push({
      rowNumber,
      cooperativeId: stringCell(
        valueByHeader.get("cooperativeId") ?? valueByHeader.get("농협ID"),
      ),
      cooperativeName,
      priorAuditorName: stringCell(
        valueByHeader.get("25년감사인") ?? valueByHeader.get("priorAuditorName"),
      ),
      plannedAuditFeeWon,
      safePriceMinWon:
        safeRaw ??
        (plannedAuditFeeWon ? safeMinFromPlanned(plannedAuditFeeWon) : null),
      selectedPartnerName: partnerNameCell(selectedPartnerRaw),
      nonSelectedPartnerName1: partnerNameCell(
        valueByHeader.get("제휴사_비선정1") ??
          valueByHeader.get("nonSelectedPartnerName1"),
      ),
      nonSelectedPartnerName2: partnerNameCell(
        valueByHeader.get("제휴사_비선정2") ??
          valueByHeader.get("nonSelectedPartnerName2"),
      ),
    });
  });
  return rows;
}

function findHeaderRow(sheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(5, sheet.rowCount); rowNumber += 1) {
    const values: string[] = [];
    sheet.getRow(rowNumber).eachCell((cell) => {
      values.push(normalizeHeader(String(cell.value ?? "")) || "");
    });
    if (
      values.includes("농협명") ||
      values.includes("제휴사_선정") ||
      values.includes("예정견적")
    ) {
      return rowNumber;
    }
  }
  return null;
}

function normalizeHeader(value: string): HeaderKey | null {
  const trimmed = value.normalize("NFKC").trim();
  if (!trimmed) return null;
  const aliases: Record<string, HeaderKey> = {
    cooperativeId: "cooperativeId",
    농협ID: "cooperativeId",
    농협코드: "cooperativeId",
    농협명: "농협명",
    cooperativeName: "농협명",
    "25년감사인": "25년감사인",
    전기감사인: "25년감사인",
    예정견적: "예정견적",
    plannedAuditFeeWon: "예정견적",
    최저안전견적: "최저안전견적",
    safePriceMinWon: "최저안전견적",
    제휴사_선정: "제휴사_선정",
    선정제휴사: "제휴사_선정",
    제휴사_비선정1: "제휴사_비선정1",
    비선정1: "제휴사_비선정1",
    제휴사_비선정2: "제휴사_비선정2",
    비선정2: "제휴사_비선정2",
  };
  return aliases[trimmed] ?? null;
}

function cellValue(value: unknown) {
  if (value && typeof value === "object" && "result" in value) {
    return (value as { result: unknown }).result;
  }
  if (value && typeof value === "object" && "text" in value) {
    return (value as { text: unknown }).text;
  }
  return value;
}

function stringCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Legacy 시트9 put fee formulas in 제휴사_* — ignore pure numbers as partner names. */
function partnerNameCell(value: unknown) {
  const text = stringCell(value);
  if (!text) return "";
  if (/^[\d,.\s]+$/u.test(text)) return "";
  return text;
}
