import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ADMIN_OPERATION_TAB_IDS,
  createAdminOperationsCopy,
} from "@/lib/cms/admin-operations-content";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import {
  CMS_ROUTE_MESSAGE_PRESENTATION,
  CMS_ROUTE_SECTION_PRESENTATION,
} from "@/lib/cms/route-presentation";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

describe("audit evaluation admin UI contract", () => {
  it("registers one feature-gated top-level tab and exactly five panel menus", () => {
    assert.ok(ADMIN_OPERATION_TAB_IDS.includes("auditEvaluations"));
    assert.equal(
      ADMIN_OPERATION_TAB_IDS.filter((id) => id === "auditEvaluations").length,
      1,
    );

    const defaults = CMS_PAGE_DEFAULTS["admin.operations"];
    const navigation = defaults.sections.find(
      (section) => section.id === "navigation",
    );
    const adminSection = defaults.sections.find(
      (section) => section.id === "auditEvaluationAdmin",
    );
    assert.ok(navigation);
    assert.ok(adminSection);
    assert.equal(
      navigation.items.filter((item) => item.id === "auditEvaluations").length,
      1,
    );
    assert.deepEqual(
      adminSection.items
        .filter((item) => item.id.startsWith("menu."))
        .map((item) => item.id),
      [
        "menu.cases",
        "menu.criteria",
        "menu.report",
        "menu.errors",
        "menu.logs",
      ],
    );

    const copy = createAdminOperationsCopy(structuredClone(defaults));
    assert.equal(
      copy.tabs.find((tab) => tab.key === "auditEvaluations")?.label,
      "감사평가 운영",
    );
  });

  it("does not mount the panel or call its API when the feature is disabled", () => {
    const dashboard = source("components/AdminDashboard.tsx");
    const page = source("app/admin/operations/page.tsx");

    assert.match(
      page,
      /auditEvaluationFlags\.enabled && auditEvaluationFlags\.adminEnabled/,
    );
    assert.match(
      dashboard,
      /item\.key !== "auditEvaluations" \|\| auditEvaluationAdminEnabled/,
    );
    assert.match(
      dashboard,
      /auditEvaluationAdminEnabled && tab === "auditEvaluations"/,
    );
    assert.match(
      dashboard,
      /auditEvaluationAdminEnabled = previewMode/,
    );
  });

  it("keeps auth, endpoints, payload keys and confirmation safety in code", () => {
    const panel = source("components/AdminAuditEvaluationPanel.tsx");
    assert.match(panel, /getFirebaseAuth\(\)\.currentUser/);
    assert.match(panel, /getIdToken\(\)/);
    assert.match(panel, /authorization: `Bearer \$\{idToken\}`/);
    assert.match(panel, /response\.status === 401/);
    assert.match(panel, /response\.status === 403/);

    for (const route of [
      '"/api/admin/audit-evaluations"',
      '`${BASE_PATH}?',
      '`${BASE_PATH}/configs`',
      '`${BASE_PATH}/errors',
      '`${BASE_PATH}/audit-logs?',
      '`${BASE_PATH}/configs/calculate`',
    ]) {
      assert.ok(panel.includes(route), `missing protected route: ${route}`);
    }
    for (const payloadKey of [
      "field: correctionField",
      "correctedValue: normalizedValue",
      "reason: correctionReason.trim()",
      "expectedRevision: detailRevision",
      "action,",
      "configId: source?.id",
      "expectedDraftRevision: configDraft.draftRevision",
      "criteria: draft.criteria.map",
      "fileNameRule: draft.report.filenameRule",
      "customerDownloadDays: draft.report.downloadDays",
    ]) {
      assert.ok(
        panel.includes(payloadKey),
        `missing protected payload key: ${payloadKey}`,
      );
    }
    assert.doesNotMatch(panel, /window\.(confirm|prompt)\(/);
    assert.match(panel, /role="dialog"/);
    assert.match(panel, /type="checkbox"/);
    assert.doesNotMatch(panel, /stackTrace|error\.stack/);
    assert.doesNotMatch(panel, /<textarea[^>]*(html|javascript|css)/i);
  });

  it("exposes the new section and messages through CMS presentation", () => {
    const defaults = CMS_PAGE_DEFAULTS["admin.operations"];
    const adminSection = defaults.sections.find(
      (section) => section.id === "auditEvaluationAdmin",
    );
    const presentation =
      CMS_ROUTE_SECTION_PRESENTATION["admin.operations"]?.auditEvaluationAdmin;
    const messages = CMS_ROUTE_MESSAGE_PRESENTATION["admin.operations"];
    assert.ok(adminSection);
    assert.ok(presentation);
    assert.ok(messages);
    for (const key of Object.keys(adminSection.text)) {
      assert.ok(
        presentation.textFields?.[key],
        `missing audit evaluation field presentation: ${key}`,
      );
    }
    for (const key of Object.keys(defaults.messages).filter((key) =>
      key.startsWith("auditEvaluation"),
    )) {
      assert.ok(messages[key], `missing audit evaluation message: ${key}`);
    }
  });

  it("covers required operational views without raw JSON editors", () => {
    const panel = source("components/AdminAuditEvaluationPanel.tsx");
    for (const contract of [
      "documentsIntegrityTitle",
      "extractedEvidenceTitle",
      "customerCorrectionsTitle",
      "adminCorrectionsTitle",
      "scoreDetailsTitle",
      "feeAnalysisTitle",
      "reportVersionsTitle",
      "timelineTitle",
      "expectedRevision",
      "versionCompareTitle",
      "calculatorTitle",
      "reportSectionsTitle",
      "mandatorySectionBadge",
      "internalDetailColumn",
      "logsTitle",
    ]) {
      assert.ok(panel.includes(contract), `missing UI contract: ${contract}`);
    }
    assert.doesNotMatch(panel, /JSON\.stringify\([^)]*,\s*null,\s*2\)/);
    assert.doesNotMatch(panel, /type=["']?file["']?/);
  });

  it("edits the actual strict config structures and reconfirms server warnings", () => {
    const panel = source("components/AdminAuditEvaluationPanel.tsx");
    for (const contract of [
      "requiredFields: draft.requiredFields",
      "minimumInclusive",
      "maximumExclusive",
      "scoreBasisPoints",
      "items: items.map",
      "relativeWeightBasisPoints",
      "subcriteria: subcriteria.map",
      "strictRulePayload",
      '"required" in criterion.raw',
      "warnings_confirmation_required",
      "confirmWarnings,",
      'role="alertdialog"',
    ]) {
      assert.ok(panel.includes(contract), `missing strict config UI: ${contract}`);
    }
    assert.match(
      panel,
      /const refreshed = await adminFetch\(versionPath\)/,
      "warning confirmation must refresh server validation before publishing",
    );
    assert.doesNotMatch(
      panel,
      /required:\s*criterion\.required|required:\s*subitem\.required/,
      "strict criterion payloads must not receive synthetic required properties",
    );
  });
});
