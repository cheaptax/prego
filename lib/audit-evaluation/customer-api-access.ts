import "server-only";

import type { NextRequest } from "next/server";
import { AuditEvaluationCustomerAccessService } from "@/lib/audit-evaluation/customer-access-service";
import { AUDIT_EVALUATION_SESSION_COOKIE } from "@/lib/audit-evaluation/customer-access-token";
import type {
  AuditEvaluationActor,
  CustomerAccessOwner,
} from "@/lib/audit-evaluation/types";
import {
  assertTrustedMutationRequest,
  recordSecurityAuditLog,
} from "@/lib/audit-evaluation/api-security";

export async function authenticateAuditEvaluationCaseRequest(
  request: NextRequest,
  caseId: string,
) {
  const rawSessionToken =
    request.cookies.get(AUDIT_EVALUATION_SESSION_COOKIE)?.value ?? "";
  if (!rawSessionToken) return null;
  try {
    const access = await new AuditEvaluationCustomerAccessService()
      .validateCaseSession(
        rawSessionToken,
        caseId,
        new Date().toISOString(),
      );
    if (!access) {
      await recordDenied(caseId, "invalid_case_session");
      return null;
    }
    return {
      ...access,
      actor: customerOwnerToActor(access.session.owner),
    };
  } catch {
    await recordDenied(caseId, "case_access_validation_failed");
    return null;
  }
}

export async function authenticateAuditEvaluationMutationRequest(
  request: NextRequest,
  caseId: string,
  options: { requireJson?: boolean } = {},
) {
  try {
    assertTrustedMutationRequest(request, options);
  } catch {
    await recordDenied(caseId, "cross_site_mutation_denied");
    return null;
  }
  return authenticateAuditEvaluationCaseRequest(request, caseId);
}

function customerOwnerToActor(
  owner: CustomerAccessOwner,
): Extract<AuditEvaluationActor, { type: "CUSTOMER" }> {
  return {
    type: "CUSTOMER",
    subjectId:
      owner.type === "FIREBASE_UID" ? owner.uid : owner.subjectId,
  };
}

async function recordDenied(caseId: string, detail: string) {
  await recordSecurityAuditLog({
    action: "ACCESS_DENIED",
    caseId,
    detail,
    occurredAt: new Date().toISOString(),
  }).catch(() => undefined);
}
