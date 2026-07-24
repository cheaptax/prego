import type { PartnerProfession } from "@/lib/firebase/schema";

export const PARTNER_PROFESSION_OPTIONS = [
  { value: "ACCOUNTANT", label: "회계사" },
  { value: "TAX_ACCOUNTANT", label: "세무사" },
  { value: "ATTORNEY", label: "변호사" },
  { value: "JUDICIAL_SCRIVENER", label: "법무사" },
  { value: "PATENT_ATTORNEY", label: "변리사" },
  { value: "CUSTOMS_BROKER", label: "관세사" },
  { value: "LABOR_ATTORNEY", label: "노무사" },
  { value: "APPRAISER", label: "감정평가사" },
  { value: "OTHER", label: "기타 전문가" },
] as const satisfies readonly {
  value: PartnerProfession;
  label: string;
}[];

const PARTNER_PROFESSION_SET = new Set<PartnerProfession>(
  PARTNER_PROFESSION_OPTIONS.map((option) => option.value),
);

const PARTNER_PROFESSION_LABEL_TO_VALUE = new Map<string, PartnerProfession>(
  PARTNER_PROFESSION_OPTIONS.map((option) => [option.label, option.value]),
);

export function isPartnerProfession(
  value: unknown,
): value is PartnerProfession {
  return PARTNER_PROFESSION_SET.has(value as PartnerProfession);
}

export function normalizePartnerProfession(
  value: unknown,
): PartnerProfession {
  const text = String(value ?? "").trim();
  if (isPartnerProfession(text)) return text;
  return PARTNER_PROFESSION_LABEL_TO_VALUE.get(text) ?? "OTHER";
}

export function getPartnerProfessionLabel(value: unknown) {
  const profession = normalizePartnerProfession(value);
  return PARTNER_PROFESSION_OPTIONS.find((option) => option.value === profession)
    ?.label ?? "기타 전문가";
}
