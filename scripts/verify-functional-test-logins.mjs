/**
 * Verifies Firebase password sign-in, portal session creation, guarded pages,
 * role APIs, cross-role denial, and key public endpoints.
 * Passwords and tokens are never printed.
 */

import { existsSync, readFileSync } from "node:fs";

const ACCOUNTS = [
  {
    email: "admin@gmail.com",
    group: "admin",
    portal: "admin",
    page: "/admin/operations",
    api: "/api/admin/session",
    passwordEnv: "ADMIN_ROLE_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "cheaptax1@insungacc.com",
    group: "admin",
    portal: "admin",
    page: "/admin/operations",
    api: "/api/admin/session",
    passwordEnv: "ADMIN_ROLE_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "cheaptaxworld1@gmail.com",
    group: "partner",
    portal: "partner",
    page: "/partner",
    api: "/api/partner/session",
    passwordEnv: "PARTNER_TEST_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "cheaptaxworld2@gmail.com",
    group: "partner",
    portal: "partner",
    page: "/partner",
    api: "/api/partner/session",
    passwordEnv: "PARTNER_TEST_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "cheaptaxworld@gmail.com",
    group: "customer",
    portal: "customer",
    page: "/mypage",
    api: "/api/me/status",
    passwordEnv: "CUSTOMER_TEST_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "cheaptax@naver.com",
    group: "customer",
    portal: "customer",
    page: "/mypage",
    api: "/api/me/status",
    passwordEnv: "CUSTOMER_TEST_PASSWORD",
    pageText: "사이트맵",
  },
  {
    email: "requiem77k@naver.com",
    group: "customer",
    portal: "customer",
    page: "/mypage",
    api: "/api/me/status",
    passwordEnv: "CUSTOMER_TEST_PASSWORD",
    redirect: "/pending-approval",
  },
  {
    email: "prego.ceo@gmail.com",
    group: "customer",
    portal: "customer",
    page: "/mypage",
    api: "/api/me/status",
    passwordEnv: "CUSTOMER_TEST_PASSWORD",
    redirect: "/mypage/quotes",
    followPage: "/mypage/quotes",
  },
];

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match || process.env[match[1]]) continue;
    if (match[1].endsWith("_PASSWORD")) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
  }
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment:${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function signIn(apiKey, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  const body = await response.json().catch(() => ({}));
  assert(response.ok && typeof body.idToken === "string", `sign_in_failed:${email}`);
  return body.idToken;
}

function sessionCookie(response) {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(/(?:^|,\s*)(nh_portal_session=[^;]+)/u);
  assert(match, "portal_session_cookie_missing");
  return match[1];
}

async function bearerGet(baseUrl, path, token) {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
  });
}

loadLocalEnv();
const baseUrl = (process.env.TEST_BASE_URL ?? "https://nh.prego.im").replace(
  /\/$/u,
  "",
);
const apiKey = requiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY");
const verified = [];

for (const account of ACCOUNTS) {
  const token = await signIn(
    apiKey,
    account.email,
    requiredEnv(account.passwordEnv),
  );
  const apiResponse = await bearerGet(baseUrl, account.api, token);
  const apiBody = await apiResponse.json().catch(() => ({}));
  assert(apiResponse.ok && apiBody.ok === true, `role_api_failed:${account.email}`);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/portal-session`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      expectedPortal: account.portal,
      rememberMe: false,
    }),
    redirect: "manual",
  });
  const sessionBody = await sessionResponse.json().catch(() => ({}));
  assert(
    sessionResponse.ok && sessionBody.ok === true,
    `portal_session_failed:${account.email}`,
  );
  const cookie = sessionCookie(sessionResponse);
  const pageResponse = await fetch(`${baseUrl}${account.page}`, {
    headers: { cookie },
    redirect: "manual",
  });
  if (account.redirect) {
    const location = pageResponse.headers.get("location") ?? "";
    assert(
      [302, 303, 307, 308].includes(pageResponse.status) &&
        new URL(location, baseUrl).pathname === account.redirect,
      `portal_redirect_failed:${account.email}:${pageResponse.status}:${location}`,
    );
  } else {
    const html = await pageResponse.text();
    assert(pageResponse.ok, `portal_page_failed:${account.email}`);
    assert(
      !account.pageText || html.includes(account.pageText),
      `portal_page_content_missing:${account.email}`,
    );
  }
  if (account.followPage) {
    const followResponse = await fetch(`${baseUrl}${account.followPage}`, {
      headers: { cookie },
      redirect: "manual",
    });
    assert(followResponse.ok, `portal_follow_page_failed:${account.email}`);
  }
  verified.push({ account, token });
  console.log(
    `verified=true group=${account.group} email=${account.email} portal=${account.portal}`,
  );
}

const customer = verified.find(
  ({ account }) => account.email === "cheaptaxworld@gmail.com",
);
const partner = verified.find(({ account }) => account.group === "partner");
const admin = verified.find(({ account }) => account.group === "admin");
for (const negative of [
  { token: customer.token, path: "/api/admin/session", label: "customer_to_admin" },
  { token: partner.token, path: "/api/me/status", label: "partner_to_customer" },
  { token: admin.token, path: "/api/partner/session", label: "admin_to_partner" },
]) {
  const response = await bearerGet(baseUrl, negative.path, negative.token);
  assert(
    response.status === 403,
    `cross_role_not_denied:${negative.label}:${response.status}`,
  );
  console.log(`denied=true case=${negative.label} status=${response.status}`);
}

const invalidResponse = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "cheaptaxworld@gmail.com",
      password: "intentionally-wrong-password",
      returnSecureToken: true,
    }),
  },
);
assert(invalidResponse.status === 400, "invalid_password_not_rejected");
console.log("denied=true case=invalid_password status=400");

for (const path of [
  "/",
  "/faq",
  "/api/cooperatives/search?q=%ED%94%84%EB%A0%88%EA%B3%A0",
]) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
  assert(response.ok, `public_smoke_failed:${path}:${response.status}`);
  console.log(`public=true path=${path} status=${response.status}`);
}
console.log(`verifiedAccounts=${verified.length}`);
console.log("verificationComplete=true");
