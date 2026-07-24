import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();
const source = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("portal authentication boundaries", () => {
  it("requires an active member for customer mutation APIs", () => {
    for (const route of [
      "app/api/me/consents/route.ts",
      "app/api/me/requests/[requestId]/complete/route.ts",
      "app/api/me/answers/[requestId]/rating/route.ts",
      "app/api/me/answers/[requestId]/view/route.ts",
      "app/api/me/quotes/route.ts",
      "app/api/me/quotes/[quoteId]/download/route.ts",
    ]) {
      assert.match(
        source(route),
        /requireActiveMember\(req\)|requireWritableActiveMember\(req\)|requireQuoteInboxMember\(req\)/,
        route,
      );
    }
  });

  it("rejects non-member profiles from customer status and overview APIs", () => {
    assert.match(
      source("app/api/me/status/route.ts"),
      /requireMember\(req\)/,
    );
    assert.match(
      source("app/api/me/overview/route.ts"),
      /requireActiveMember\(req\)/,
    );
    assert.match(
      source("lib/firebase/server.ts"),
      /profile\.role !== "member"/,
    );
    assert.match(
      source("app/api/inquiries/route.ts"),
      /user\?\.role === "member" && user\.status === "active"/,
    );
  });

  it("redirects non-customer claims away from the customer portal", () => {
    const dashboard = source("components/MyPageDashboard.tsx");
    assert.match(dashboard, /tokenResult\.claims\.admin === true/);
    assert.match(dashboard, /router\.replace\("\/admin"\)/);
    assert.match(dashboard, /tokenResult\.claims\.partner === true/);
    assert.match(dashboard, /router\.replace\("\/partner"\)/);
  });

  it("keeps the public login page out of search indexes", () => {
    assert.match(
      source("app/login/page.tsx"),
      /robots: \{ index: false, follow: false \}/,
    );
  });
});
