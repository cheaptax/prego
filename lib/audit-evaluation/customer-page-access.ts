import "server-only";

import { cookies } from "next/headers";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { AUDIT_EVALUATION_SESSION_COOKIE } from "@/lib/audit-evaluation/customer-access-token";
import {
  getServerFeatureFlags,
  isAuditEvaluationCapabilityEnabled,
} from "@/lib/audit-evaluation/feature-flags";

export type AuditEvaluationCustomerPageState =
  | { kind: "disabled" }
  | { kind: "denied" }
  | {
      kind: "authorized";
      caseId: string;
      fiscalYear: number;
      currentQuoteCount: number;
      minimumQuoteCount: number;
      status: string;
      reportFeatureEnabled: boolean;
      reportAvailable: boolean;
    };

export function isAuditEvaluationCustomerEntryOpen() {
  return isAuditEvaluationCapabilityEnabled(
    "customerEntryEnabled",
    getServerFeatureFlags().auditEvaluation,
  );
}

export async function loadAuditEvaluationCustomerPageState(
  caseId: string,
): Promise<AuditEvaluationCustomerPageState> {
  const flags = getServerFeatureFlags().auditEvaluation;
  if (
    !isAuditEvaluationCapabilityEnabled(
      "customerEntryEnabled",
      flags,
    )
  ) {
    return { kind: "disabled" };
  }
  const cookieStore = await cookies();
  const rawSessionToken =
    cookieStore.get(AUDIT_EVALUATION_SESSION_COOKIE)?.value ?? "";
  if (!rawSessionToken) return { kind: "denied" };
  try {
    const service = new AuditEvaluationCustomerAccessService(
      undefined,
      { flags },
    );
    const access = await service.validateCaseSession(
      rawSessionToken,
      caseId,
      new Date().toISOString(),
    );
    if (!access) return { kind: "denied" };
    return {
      kind: "authorized",
      caseId: access.evaluationCase.id,
      fiscalYear: access.evaluationCase.fiscalYear,
      currentQuoteCount:
        access.evaluationCase.confirmedQuoteCount,
      minimumQuoteCount:
        access.evaluationCase.expectedQuoteCount,
      status: access.evaluationCase.status,
      reportFeatureEnabled:
        isAuditEvaluationCapabilityEnabled(
          "reportDownloadEnabled",
          flags,
        ),
      reportAvailable:
        isAuditEvaluationCapabilityEnabled(
          "reportDownloadEnabled",
          flags,
        ) && access.evaluationCase.status === "COMPLETED",
    };
  } catch {
    return { kind: "denied" };
  }
}
