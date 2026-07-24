import { z } from "zod";
import {
  parseVatTreatment,
  parseWonAmountText,
} from "@/lib/audit-evaluation/quote-extraction-schemas";
import {
  NORMALIZED_AUDIT_QUOTE_FIELDS,
  type NormalizedAuditQuoteField,
  type QuoteEvidenceValue,
} from "@/lib/audit-evaluation/types";

const SAFE_ID = /^[a-z][a-zA-Z0-9._-]{0,127}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const customerQuoteCorrectionSchema = z
  .object({
    field: z.enum(NORMALIZED_AUDIT_QUOTE_FIELDS),
    valueText: z.string().trim().min(1).max(10_000),
    reason: z.string().trim().min(2).max(1_000),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const customerFinalConfirmationSchema = z
  .object({
    finalAcknowledged: z.literal(true),
    expectedQuoteRevisions: z.record(
      z.string().regex(SAFE_ID),
      z.number().int().nonnegative(),
    ),
  })
  .strict();

export const customerReportRequestSchema = z
  .object({
    confirmationVersion: z.number().int().positive(),
  })
  .strict();

export type CustomerQuoteCorrectionInput = z.infer<
  typeof customerQuoteCorrectionSchema
>;

export class CustomerCorrectionValueError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "CustomerCorrectionValueError";
    this.code = code;
  }
}

export function parseCustomerCorrectionValue(
  field: NormalizedAuditQuoteField,
  valueText: string,
): QuoteEvidenceValue {
  const value = valueText.trim();
  if (field === "auditFee" || field === "accountingFirmRevenue") {
    const parsed = parseWonAmountText(value);
    if (!parsed.value) {
      throw new CustomerCorrectionValueError(
        parsed.warning?.code ?? "invalid_amount",
      );
    }
    return parsed.value;
  }
  if (field === "vatIncluded") {
    const parsed = parseVatTreatment(value);
    if (parsed.value === null) {
      throw new CustomerCorrectionValueError(
        parsed.warning?.code ?? "invalid_vat",
      );
    }
    return parsed.value;
  }
  if (
    field === "recentNonghyupAuditCount" ||
    field === "totalPlannedHours" ||
    field === "partnerHours"
  ) {
    const normalized = value.replaceAll(",", "").replace(/(?:건|시간)$/u, "");
    const parsed = Number(normalized.trim());
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new CustomerCorrectionValueError("invalid_integer");
    }
    return parsed;
  }
  if (
    field === "auditedNonghyupTypes" ||
    field === "qualityControlPlan"
  ) {
    return splitEntries(value);
  }
  if (
    field === "taxAgencyExperience" ||
    field === "subsidySettlementExperience"
  ) {
    const hasExperience = !/^(?:없음|무|해당없음)$/u.test(value);
    return {
      hasExperience,
      descriptions: hasExperience ? splitEntries(value) : [],
    };
  }
  if (field === "engagementPartner") {
    if (/^(?:없음|해당없음)$/u.test(value)) return null;
    const [name, title, years] = value.split("|").map((item) => item.trim());
    if (!name) throw new CustomerCorrectionValueError("invalid_partner");
    const yearsOfExperience = years ? Number(years) : null;
    if (
      yearsOfExperience !== null &&
      (
        !Number.isInteger(yearsOfExperience) ||
        yearsOfExperience < 0 ||
        yearsOfExperience > 100
      )
    ) {
      throw new CustomerCorrectionValueError("invalid_partner");
    }
    return {
      name,
      title: title || null,
      yearsOfExperience,
    };
  }
  if (field === "engagementTeam") {
    return splitEntries(value).map((entry) => {
      const [name, role, hours] = entry.split("|").map((item) => item.trim());
      const plannedHours = hours ? Number(hours) : null;
      if (
        !name ||
        !role ||
        (
          plannedHours !== null &&
          (!Number.isSafeInteger(plannedHours) || plannedHours < 0)
        )
      ) {
        throw new CustomerCorrectionValueError("invalid_team");
      }
      return { name, role, plannedHours };
    });
  }
  if (field === "auditSchedule") {
    return splitEntries(value).map((entry, index) => {
      const [label, startsOn, endsOn] = entry
        .split("|")
        .map((item) => item.trim());
      if (
        !label ||
        (startsOn && !DATE_ONLY.test(startsOn)) ||
        (endsOn && !DATE_ONLY.test(endsOn))
      ) {
        throw new CustomerCorrectionValueError("invalid_schedule");
      }
      return {
        id: `customer-schedule-${index + 1}`,
        label,
        startsOn: startsOn || null,
        endsOn: endsOn || startsOn || null,
      };
    });
  }
  if (field === "requiredProposalItems") {
    return Object.fromEntries(
      splitEntries(value).map((entry, index) => {
        const [rawId, rawPresent, ...description] = entry
          .split("|")
          .map((item) => item.trim());
        const id = /^[a-z][a-zA-Z0-9._-]{0,79}$/.test(rawId)
          ? rawId
          : `customer-item-${index + 1}`;
        const present = /^(?:충족|예|있음|true)$/iu.test(rawPresent);
        if (!rawId || !rawPresent) {
          throw new CustomerCorrectionValueError(
            "invalid_required_proposal_item",
          );
        }
        return [
          id,
          {
            present,
            value: description.join(" | ") || rawId,
          },
        ];
      }),
    );
  }
  if (field === "accountingFirmId") {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
      throw new CustomerCorrectionValueError("invalid_firm_id");
    }
    return value;
  }
  if (field === "accountingFirmName") {
    return value;
  }
  throw new CustomerCorrectionValueError("unsupported_correction_field");
}

function splitEntries(value: string) {
  const entries = value
    .split(/\r?\n|\s*;\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (entries.length === 0 || entries.length > 100) {
    throw new CustomerCorrectionValueError("invalid_list");
  }
  return [...new Set(entries)];
}
