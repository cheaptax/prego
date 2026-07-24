import { z } from "zod";
import {
  REPORT_SECTION_IDS,
  auditEvaluationReportViewModelSchema,
  scanForbiddenReportPhrases,
  type AuditEvaluationReportViewModel,
  type ReportSectionId,
} from "@/lib/audit-evaluation/report-view-model";
import type { NarrativeData } from "@/lib/audit-evaluation/types";

export const REPORT_NARRATIVE_SCHEMA_VERSION = 1 as const;

const factIdSchema = z.string().regex(/^fact-[0-9]{4,}$/);
export const reportNarrativeOutputSchema = z
  .object({
    schemaVersion: z.literal(REPORT_NARRATIVE_SCHEMA_VERSION),
    paragraphs: z
      .array(
        z
          .object({
            sectionId: z.enum(REPORT_SECTION_IDS),
            text: z.string().trim().min(1).max(2_000),
            factIds: z.array(factIdSchema).min(1).max(20),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

export type ReportNarrativeInput = {
  readonly schemaVersion: typeof REPORT_NARRATIVE_SCHEMA_VERSION;
  readonly reportVersion: number;
  readonly facts: ReadonlyArray<{
    readonly id: string;
    readonly sectionId: ReportSectionId;
    readonly text: string;
  }>;
};

export interface ReportNarrativeAdapter {
  generate(input: ReportNarrativeInput): Promise<unknown>;
}

export type ReportNarrativeResult = {
  viewModel: AuditEvaluationReportViewModel;
  narrativeData: NarrativeData;
};

export async function applyOptionalReportNarrative(input: {
  viewModel: AuditEvaluationReportViewModel;
  enabled: boolean;
  adapter?: ReportNarrativeAdapter;
}): Promise<ReportNarrativeResult> {
  const template = auditEvaluationReportViewModelSchema.parse(input.viewModel);
  const ruleBasedSections = REPORT_SECTION_IDS.map((sectionId) => ({
    sectionId,
    facts: template.facts
      .filter((fact) => fact.sectionId === sectionId)
      .map(({ text }) => text),
  }));
  if (!input.enabled) {
    return {
      viewModel: template,
      narrativeData: {
        mode: "RULE_BASED",
        ruleBasedSections,
        aiStatus: "NOT_REQUESTED",
        aiText: null,
      },
    };
  }
  if (!input.adapter) {
    return failedNarrative(template, ruleBasedSections);
  }
  try {
    const narrativeInput = immutableClone({
      schemaVersion: REPORT_NARRATIVE_SCHEMA_VERSION,
      reportVersion: template.metadata.version,
      facts: template.facts.map(({ id, sectionId, text }) => ({
        id,
        sectionId,
        text,
      })),
    });
    const output = reportNarrativeOutputSchema.parse(
      await input.adapter.generate(narrativeInput),
    );
    assertNarrativeFacts(output.paragraphs, template);
    assertNarrativeNumbers(output.paragraphs, template);
    if (
      scanForbiddenReportPhrases(
        output.paragraphs.map(({ text }) => text),
      ).length > 0
    ) {
      return failedNarrative(template, ruleBasedSections);
    }
    const viewModel = auditEvaluationReportViewModelSchema.parse({
      ...template,
      narrative: {
        mode: "AI_ASSISTED",
        paragraphs: output.paragraphs,
      },
    });
    return {
      viewModel,
      narrativeData: {
        mode: "AI_ASSISTED",
        ruleBasedSections,
        aiStatus: "COMPLETED",
        aiText: JSON.stringify(output),
      },
    };
  } catch {
    return failedNarrative(template, ruleBasedSections);
  }
}

function assertNarrativeFacts(
  paragraphs: z.infer<typeof reportNarrativeOutputSchema>["paragraphs"],
  viewModel: AuditEvaluationReportViewModel,
) {
  const facts = new Map(viewModel.facts.map((fact) => [fact.id, fact]));
  for (const paragraph of paragraphs) {
    for (const factId of paragraph.factIds) {
      const fact = facts.get(factId);
      if (!fact || fact.sectionId !== paragraph.sectionId) {
        throw new Error("invalid_narrative_fact_reference");
      }
    }
  }
}

function assertNarrativeNumbers(
  paragraphs: z.infer<typeof reportNarrativeOutputSchema>["paragraphs"],
  viewModel: AuditEvaluationReportViewModel,
) {
  const facts = new Map(viewModel.facts.map((fact) => [fact.id, fact.text]));
  for (const paragraph of paragraphs) {
    const cited = paragraph.factIds
      .map((id) => facts.get(id) ?? "")
      .join(" ");
    for (const numericToken of numberTokens(paragraph.text)) {
      if (!numberTokens(cited).includes(numericToken)) {
        throw new Error("narrative_added_numeric_fact");
      }
    }
  }
}

function numberTokens(value: string): string[] {
  return value.match(/-?[0-9][0-9,.]*/g) ?? [];
}

function failedNarrative(
  viewModel: AuditEvaluationReportViewModel,
  ruleBasedSections: NarrativeData["ruleBasedSections"],
): ReportNarrativeResult {
  return {
    viewModel,
    narrativeData: {
      mode: "RULE_BASED",
      ruleBasedSections,
      aiStatus: "FAILED",
      aiText: null,
    },
  };
}

function immutableClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(immutableClone)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          immutableClone(item),
        ]),
      ),
    ) as T;
  }
  return value;
}
