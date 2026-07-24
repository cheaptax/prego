import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUDIT_QUOTE_REQUEST_ENDPOINT,
  buildAuditQuoteRequestPayload,
} from "@/lib/audit-quote/client-payload";
import type { PublicAuditQuoteConfig } from "@/lib/audit-quote/public-types";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const config: PublicAuditQuoteConfig = {
  enabled: true,
  privacyPolicyVersion: "2026-07-20",
  campaign: "fy27-audit-quote",
  channel: "event_page",
  pagePath: "/events/audit-quote",
  privacyPolicyHref: "/signup",
  guaranteeMinQuotes: false,
  showPointsBenefit: false,
  pointsBenefitBaseLabel: null,
  retentionCopy: null,
  closedMessage: "closed",
};

describe("audit-quote CMS payload boundary", () => {
  it("builds the exact pre-CMS request payload and endpoint", () => {
    const payload = buildAuditQuoteRequestPayload(
      {
        email: "finance.team@nonghyup.com",
        name: "김농협",
        phone: "010-1234-5678",
        targetCooperativeName: "프리고농협",
        fiscalYear: 2026,
        marketingConsent: true,
        companyWebsite: "",
      },
      config,
    );
    assert.equal(AUDIT_QUOTE_REQUEST_ENDPOINT, "/api/audit-quote/requests");
    assert.deepEqual(payload, {
      email: "finance.team@nonghyup.com",
      name: "김농협",
      phone: "010-1234-5678",
      targetCooperativeName: "프리고농협",
      fiscalYear: 2026,
      privacyConsent: true,
      privacyPolicyVersion: "2026-07-20",
      marketingConsent: true,
      source: {
        campaign: "fy27-audit-quote",
        channel: "event_page",
      },
      companyWebsite: "",
    });
    assert.deepEqual(Object.keys(payload), [
      "email",
      "name",
      "phone",
      "targetCooperativeName",
      "fiscalYear",
      "privacyConsent",
      "privacyPolicyVersion",
      "marketingConsent",
      "source",
      "companyWebsite",
    ]);
  });

  it("cannot receive CMS copy or style values when building the payload", () => {
    const before = structuredClone(CMS_PAGE_DEFAULTS["event.auditQuote"]);
    const after = structuredClone(before);
    after.sections[0].title = "관리자가 바꾼 화면 제목";
    after.sections[1].text.emailLabel = "업무용 이메일";
    after.sections[1].text.privacyConsentLabel = "변경된 필수 동의 안내";
    after.sections[1].style.button = {
      tone: "ink",
      size: "large",
      radius: "rounded",
    };

    const input = {
      email: "finance.team@nonghyup.com",
      name: "김농협",
      phone: "010-1234-5678",
      targetCooperativeName: "프리고농협",
      fiscalYear: 2026,
      marketingConsent: false,
      companyWebsite: "",
    };
    const payloadBefore = buildAuditQuoteRequestPayload(input, config);
    const payloadAfter = buildAuditQuoteRequestPayload(input, config);
    assert.notDeepEqual(before, after);
    assert.deepEqual(payloadBefore, payloadAfter);
    assert.equal(JSON.stringify(payloadAfter).includes("관리자가"), false);
    assert.equal(JSON.stringify(payloadAfter).includes("변경된 필수"), false);
  });

  it("keeps protected form names, honeypot, and route mapping in code", () => {
    const pageSource = readFileSync(
      path.join(root, "components/AuditQuoteEventPage.tsx"),
      "utf8",
    );
    const routeSource = readFileSync(
      path.join(root, "app/api/audit-quote/requests/route.ts"),
      "utf8",
    );
    for (const name of [
      "email",
      "name",
      "phone",
      "targetCooperativeName",
      "fiscalYear",
    ]) {
      assert.match(pageSource, new RegExp(`name=\"${name}\"`));
    }
    assert.match(pageSource, /company-website/);
    assert.match(pageSource, /buildAuditQuoteRequestPayload/);
    assert.match(routeSource, /contactName:\s*body\.name/);
    assert.match(routeSource, /companyWebsite:\s*body\.companyWebsite/);
    assert.match(routeSource, /privacyConsent:\s*body\.privacyConsent === true/);
  });
});
