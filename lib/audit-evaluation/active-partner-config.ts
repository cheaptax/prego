import { AUDIT_EVALUATION_COLLECTIONS } from "@/lib/audit-evaluation/collections";
import { createDefaultAuditQualityDraft } from "@/lib/audit-evaluation/default-evaluation-draft";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import type {
  ChecklistRule,
  EvaluationConfig,
} from "@/lib/audit-evaluation/types";
import { adminDb } from "@/lib/firebase/admin";

export type ActivePartnerEvaluationConfig = {
  config: EvaluationConfig;
  source: "published" | "fallback";
};

export async function loadActivePartnerEvaluationConfig(
  now = new Date().toISOString(),
): Promise<ActivePartnerEvaluationConfig> {
  const snapshot = await adminDb()
    .collection(AUDIT_EVALUATION_COLLECTIONS.configVersions)
    .get();
  const nowMs = Date.parse(now);
  const configuredId =
    process.env.AUDIT_EVALUATION_ACTIVE_CONFIG_ID?.trim() || null;
  const candidates = snapshot.docs
    .flatMap((document) => {
      const parsed = evaluationConfigSchema.safeParse(document.data());
      return parsed.success ? [parsed.data] : [];
    })
    .filter(
      (config) =>
        config.status === "PUBLISHED" &&
        (!configuredId || config.id === configuredId) &&
        (!config.effectiveFrom ||
          Date.parse(config.effectiveFrom) <= nowMs) &&
        (!config.effectiveTo || Date.parse(config.effectiveTo) > nowMs),
    )
    .sort(
      (left, right) =>
        Date.parse(right.publishedAt ?? right.createdAt) -
          Date.parse(left.publishedAt ?? left.createdAt) ||
        right.version - left.version,
    );

  if (configuredId) {
    const configured = candidates.find((config) => config.id === configuredId);
    if (configured) return { config: configured, source: "published" };
  } else {
    const activeIds = new Set(candidates.map((config) => config.id));
    if (activeIds.size === 1 && candidates[0]) {
      return { config: candidates[0], source: "published" };
    }
  }

  return {
    config: createOperationalFallbackConfig(now),
    source: "fallback",
  };
}

function createOperationalFallbackConfig(now: string): EvaluationConfig {
  const draft = createDefaultAuditQualityDraft({
    createdBy: "system:partner-quote",
    createdAt: now,
  });
  const criteria = draft.criteria.map((criterion) => {
    if (criterion.id === "audit-plan-and-staffing") {
      return {
        ...criterion,
        rule: {
          type: "checklist",
          field: "engagementTeam",
          items: [
            {
              id: "engagement-team",
              label: "감사 투입인력 구성",
              required: true,
              scoreBasisPoints: 3_500,
              condition: {
                type: "FIELD_PRESENT",
                field: "engagementTeam",
              },
            },
            {
              id: "total-planned-hours",
              label: "총 예정 투입시간",
              required: true,
              scoreBasisPoints: 3_000,
              condition: {
                type: "MINIMUM_INTEGER",
                field: "totalPlannedHours",
                minimum: 1,
              },
            },
            {
              id: "partner-hours",
              label: "책임회계사 투입시간",
              required: true,
              scoreBasisPoints: 3_500,
              condition: {
                type: "MINIMUM_INTEGER",
                field: "partnerHours",
                minimum: 1,
              },
            },
          ],
        } satisfies ChecklistRule,
      };
    }
    if (criterion.id === "proposal-completeness") {
      return {
        ...criterion,
        rule: {
          type: "checklist",
          field: "requiredProposalItems",
          items: [
            {
              id: "audit-methodology",
              label: "감사 접근방법 및 중점 감사사항",
              required: true,
              scoreBasisPoints: 2_500,
            },
            {
              id: "staffing-plan",
              label: "투입인력 및 역할 분담계획",
              required: true,
              scoreBasisPoints: 2_500,
            },
            {
              id: "audit-schedule",
              label: "감사 일정 및 산출물 계획",
              required: true,
              scoreBasisPoints: 2_500,
            },
            {
              id: "quality-control",
              label: "품질관리 및 커뮤니케이션 계획",
              required: true,
              scoreBasisPoints: 2_500,
            },
          ],
        } satisfies ChecklistRule,
      };
    }
    return criterion;
  });

  return evaluationConfigSchema.parse({
    ...draft,
    id: "audit-quality.partner-fallback.v1",
    name: "회계감사 제휴사 견적 기본 평가기준",
    status: "PUBLISHED",
    criteria,
    requiredFields: [
      ...new Set([
        ...draft.requiredFields,
        "engagementPartner",
        "engagementTeam",
        "totalPlannedHours",
        "partnerHours",
        "auditSchedule",
        "qualityControlPlan",
        "requiredProposalItems",
      ]),
    ],
    publishedBy: "system:partner-quote",
    publishedAt: now,
  });
}
