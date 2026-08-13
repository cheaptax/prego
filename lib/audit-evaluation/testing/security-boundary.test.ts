import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertTrustedMutationRequest,
  AuditEvaluationApiSecurityError,
  nextRateLimitState,
  readLimitedJson,
} from "@/lib/audit-evaluation/api-security-core";
import { safeReportDownloadFilename } from "@/lib/audit-evaluation/report-view-model";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { isActiveAdminProfile } from "@/lib/firebase/server";
import { createValidEvaluationConfig } from "@/lib/audit-evaluation/testing/fixtures";

describe("audit evaluation API security boundary", () => {
  it("accepts same-origin JSON and rejects CSRF origins or non-JSON bodies", () => {
    assert.doesNotThrow(() =>
      assertTrustedMutationRequest(new Request(
        "https://support.example/api/audit-evaluations/access/request",
        {
          method: "POST",
          headers: {
            origin: "https://support.example",
            "content-type": "application/json; charset=utf-8",
          },
        },
      ))
    );
    assert.doesNotThrow(() =>
      assertTrustedMutationRequest(new Request(
        "http://127.0.0.1:5000/api/audit-evaluations/access/request",
        {
          method: "POST",
          headers: {
            referer: "http://127.0.0.1:5000/events/audit-quote/evaluate",
            "content-type": "application/json",
          },
        },
      ))
    );
    const invalidHeaderSets: HeadersInit[] = [
      {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      {
        origin: "https://support.example",
        "content-type": "text/plain",
      },
      {
        referer: "https://attacker.example/phish",
        "content-type": "application/json",
      },
    ];

    for (const headers of invalidHeaderSets) {
      assert.throws(
        () => assertTrustedMutationRequest(new Request(
          "https://support.example/api/audit-evaluations/access/request",
          { method: "POST", headers },
        )),
        AuditEvaluationApiSecurityError,
      );
    }
  });

  it("enforces JSON payload byte limits even without Content-Length", async () => {
    const request = new Request("https://support.example/api/test", {
      method: "POST",
      headers: {
        origin: "https://support.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "가".repeat(100) }),
    });
    await assert.rejects(
      () => readLimitedJson(request, 100),
      (error: unknown) =>
        error instanceof AuditEvaluationApiSecurityError &&
        error.code === "payload_too_large",
    );
  });

  it("limits brute-force attempts in a fixed window and resets later", () => {
    const now = "2026-07-21T00:00:00.000Z";
    assert.deepEqual(
      nextRateLimitState(null, now, 60_000, 2),
      { allowed: true, count: 1, windowStartedAt: now },
    );
    assert.equal(
      nextRateLimitState(
        { count: 2, windowStartedAt: now },
        "2026-07-21T00:00:30.000Z",
        60_000,
        2,
      ).allowed,
      false,
    );
    assert.equal(
      nextRateLimitState(
        { count: 99, windowStartedAt: now },
        "2026-07-21T00:01:00.000Z",
        60_000,
        2,
      ).count,
      1,
    );
  });

  it("keeps public email access enumeration-safe and requires link exchange", () => {
    const route = readFileSync(
      join(
        process.cwd(),
        "app/api/audit-evaluations/access/request/route.ts",
      ),
      "utf8",
    );
    assert.match(route, /requestEmailAccess/u);
    assert.match(route, /access_instructions_if_eligible/u);
    assert.doesNotMatch(route, /createEmailCustomerSession/u);
    assert.doesNotMatch(route, /AUDIT_EVALUATION_SESSION_COOKIE/u);
    assert.doesNotMatch(route, /caseId:\s*grant/u);
  });

  it("requires claim, active profile, and admin role independently", () => {
    assert.equal(
      isActiveAdminProfile({ role: "admin", status: "active" }),
      true,
    );
    assert.equal(
      isActiveAdminProfile({ role: "admin", status: "rejected" }),
      false,
    );
    assert.equal(
      isActiveAdminProfile({ role: "member", status: "active" }),
      false,
    );
    const source = readFileSync(
      join(process.cwd(), "lib/firebase/server.ts"),
      "utf8",
    );
    assert.match(source, /isAdminToken\(decoded\)/);
    assert.match(source, /profile\.role !== "admin"/);
    assert.match(source, /!isAdminRole\(profile\.adminRole\)/);
    assert.match(source, /createAuthorizationContext\(profile\)/);
    assert.match(source, /isAccountActive\(session\.context\)/);
  });

  it("produces header-safe report filenames only", () => {
    const filename = safeReportDownloadFilename(
      2026,
      1,
      "CASE_VERSION",
      "aec_case-safe",
    );
    assert.equal(/[\r\n"\\/:]/.test(filename), false);
    const cooperativeFilename = safeReportDownloadFilename(
      2026,
      2,
      "FISCAL_YEAR_VERSION",
      "aec_case-safe",
      "긴 이름 농협/본점\r\n",
    );
    assert.match(
      cooperativeFilename,
      /^긴 이름 농협본점_FY2026 감사인견적평가보고서_v2\.pdf$/u,
    );
    assert.equal(/[\r\n"\\/:]/.test(cooperativeFilename), false);
    assert.throws(() =>
      safeReportDownloadFilename(
        2026,
        1,
        "CASE_VERSION",
        "case\r\nContent-Length:0",
      )
    );
  });
});

describe("retention policy security contract", () => {
  it("accepts five bounded periods and keeps automatic deletion opt-in", () => {
    const parsed = evaluationConfigSchema.parse({
      ...createValidEvaluationConfig(),
      retentionPolicy: {
        sourceDocumentDays: 365,
        normalizedDataDays: 730,
        reportDays: 1_825,
        expiredAccessTokenDays: 30,
        auditLogDays: 2_555,
        deleteAfterExpiry: false,
      },
    });
    assert.equal(parsed.retentionPolicy.deleteAfterExpiry, false);
    assert.equal(parsed.retentionPolicy.auditLogDays, 2_555);
    assert.equal(
      evaluationConfigSchema.safeParse({
        ...parsed,
        retentionPolicy: {
          ...parsed.retentionPolicy,
          auditLogDays: 30,
        },
      }).success,
      false,
    );
  });

  it("requires dry-run plan hash confirmation and identifier-only logs", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "lib/audit-evaluation/retention-service.ts",
      ),
      "utf8",
    );
    assert.match(source, /expectedPlanHash/);
    assert.match(source, /retention_plan_changed/);
    assert.match(source, /action: "RETENTION_EXPIRED"/);
    assert.doesNotMatch(source, /originalFileName/);
    assert.doesNotMatch(source, /normalizedPayload/);
  });
});

describe("security audit coverage", () => {
  it("records every required lifecycle event without raw secret fields", () => {
    const files = [
      "lib/audit-evaluation/customer-access-repository.ts",
      "lib/audit-evaluation/upload-repository.ts",
      "lib/audit-evaluation/parsing-repository.ts",
      "lib/audit-evaluation/review-repository.ts",
      "lib/audit-evaluation/admin-repository.ts",
      "lib/audit-evaluation/admin-config-repository.ts",
      "lib/audit-evaluation/report-repository.ts",
      "lib/audit-evaluation/retention-service.ts",
      "lib/audit-evaluation/api-security.ts",
    ].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
    for (const action of [
      "EVALUATION_CASE_CREATED",
      "ACCESS_LINK_ISSUED",
      "ACCESS_LINK_REVOKED",
      "QUOTE_DOCUMENT_UPLOADED",
      "QUOTE_DOCUMENT_DELETED",
      "QUOTE_EXTRACTION_COMPLETED",
      "CUSTOMER_QUOTE_CORRECTED",
      "ADMIN_QUOTE_CORRECTED",
      "CUSTOMER_FINAL_CONFIRMED",
      "EVALUATION_EXECUTED",
      "CONFIG_VERSION_PUBLISHED",
      "REPORT_GENERATED",
      "ADMIN_REPORT_REGENERATION_REQUESTED",
      "REPORT_DOWNLOADED",
      "ACCESS_DENIED",
      "RETENTION_EXPIRED",
    ]) {
      assert.match(files, new RegExp(`["']${action}["']`));
    }
    assert.doesNotMatch(
      files,
      /detail:\s*(?:input\.)?(?:rawToken|tokenHash|password|email)\b/,
    );
  });

  it("uses React rendering without executable HTML injection points", () => {
    const files = [
      "components/AdminAuditEvaluationPanel.tsx",
      "components/AuditEvaluationReportWorkspace.tsx",
      "components/AuditQuoteReviewWorkspace.tsx",
    ].map((file) => readFileSync(join(process.cwd(), file), "utf8")).join("\n");
    assert.doesNotMatch(files, /dangerouslySetInnerHTML|\.innerHTML\s*=|eval\(/);
  });
});
