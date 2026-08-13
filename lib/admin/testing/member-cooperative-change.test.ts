import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PREGO_COOPERATIVE_ID,
  TEST_COOPERATIVE_DEFINITIONS,
} from "@/lib/cooperatives/demo-cooperative";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import { AUDIT_ACTION_LABELS } from "@/lib/audit-log-display";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("member cooperative administration", () => {
  it("registers the test cooperative masters and prelaunch target", () => {
    assert.equal(TEST_COOPERATIVE_DEFINITIONS.length, 6);
    assert.equal(
      TEST_COOPERATIVE_DEFINITIONS.find(
        (definition) => definition.cooperativeId === PREGO_COOPERATIVE_ID,
      )?.cooperativeName,
      "프레고농협",
    );
  });

  it("keeps affiliation changes server-authorized, member-only and transactional", () => {
    const route = read(
      "app/api/admin/users/[uid]/cooperative/route.ts",
    );
    assert.match(route, /requireAdminCapability\(request, "members:write"\)/);
    assert.match(route, /user\.role !== "member"/);
    assert.match(route, /db\.runTransaction/);
    assert.match(route, /PURGE_LOCK_COLLECTION/);
    assert.match(route, /sourceOrganization\.users/);
    assert.match(route, /targetOrganization\?\.users/);
    assert.match(route, /user\.status === "active"/);
    assert.match(route, /user\.cooperative_changed/);
    assert.doesNotMatch(route, /type Payload = \{[^}]*\brole\b/s);
    assert.equal(
      AUDIT_ACTION_LABELS["user.cooperative_changed"],
      "회원 소속 농협 변경",
    );
  });

  it("provides a permission-gated administrator editor using master search", () => {
    const dashboard = read("components/AdminDashboard.tsx");
    assert.match(
      dashboard,
      /canShowAdminAction\(adminContext, "members:write"\)/,
    );
    assert.match(dashboard, /MemberCooperativeEditorModal/);
    assert.match(dashboard, /\/api\/cooperatives\/search/);
    assert.match(
      dashboard,
      /\/api\/admin\/users\/\$\{user\.uid\}\/cooperative/,
    );
  });

  it("keeps every new administrator label editable in CMS", () => {
    const members = CMS_PAGE_DEFAULTS["admin.operations"].sections.find(
      (section) => section.id === "members",
    );
    assert.ok(members);
    for (const key of [
      "changeCooperativeButton",
      "cooperativeEditorTitle",
      "newCooperativeSearchLabel",
      "cooperativeChangeReasonLabel",
      "cooperativeChangeConfirm",
      "cooperativeChangeSuccess",
      "cooperativeChangeFailed",
    ]) {
      assert.ok(members.text[key]?.trim(), key);
    }
  });

  it("makes bulk reassignment dry-run-first and production-confirmed", () => {
    const migration = read(
      "scripts/reassign-existing-members-to-prego.mjs",
    );
    assert.match(migration, /if \(!apply\) process\.exit\(0\)/);
    assert.match(migration, /checksum_mismatch/);
    assert.match(
      migration,
      /REASSIGN_ALL_MEMBERS_TO_PREGO_nong-1af31/,
    );
    assert.match(migration, /document\.data\(\)\.role === "member"/);
    assert.match(migration, /KEEP_REQUEST_QUOTE_POINT_AND_AUDIT_SNAPSHOTS_UNCHANGED/);
  });
});
