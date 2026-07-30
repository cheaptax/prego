import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_CUSTOMER_EMAILS } from "@/lib/test-data/email-classification";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const source = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

test("functional test account scripts use the approved identities only", () => {
  const provision = source("scripts/provision-functional-test-accounts.mjs");
  const reset = source("scripts/reset-role-passwords.mjs");
  for (const email of TEST_CUSTOMER_EMAILS) {
    assert.match(provision, new RegExp(email.replaceAll(".", "\\."), "u"));
    assert.match(reset, new RegExp(email.replaceAll(".", "\\."), "u"));
  }
  assert.match(provision, /cheaptaxworld1@gmail\.com/u);
  assert.match(provision, /cheaptaxworld2@gmail\.com/u);
  assert.match(reset, /TEST_PARTNER_EMAILS/u);
  assert.match(
    source("scripts/verify-functional-test-logins.mjs"),
    /cheaptaxworld2@gmail\.com/u,
  );
});

test("password mutations require project binding, confirmation, and shell secrets", () => {
  for (const script of [
    source("scripts/provision-functional-test-accounts.mjs"),
    source("scripts/reset-role-passwords.mjs"),
  ]) {
    assert.match(script, /project_mismatch/u);
    assert.match(script, /confirmation_required/u);
    assert.match(script, /process\.env/u);
    assert.doesNotMatch(script, /qwer1234|qbwkqbwk2\$|tkdgksrk\$\$/u);
  }
});

test("production verification covers successful and denied role boundaries", () => {
  const verify = source("scripts/verify-functional-test-logins.mjs");
  for (const route of [
    "/admin/operations",
    "/partner",
    "/mypage",
    "/mypage/quotes",
    "/api/admin/session",
    "/api/partner/session",
    "/api/me/status",
  ]) {
    assert.ok(verify.includes(route));
  }
  assert.match(verify, /customer_to_admin/u);
  assert.match(verify, /partner_to_customer/u);
  assert.match(verify, /admin_to_partner/u);
  assert.match(verify, /invalid_password/u);
  assert.doesNotMatch(verify, /qwer1234|qbwkqbwk2\$|tkdgksrk\$\$/u);
});
