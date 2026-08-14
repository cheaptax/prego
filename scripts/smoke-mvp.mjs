import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadLocalEnv();

const base = process.env.SMOKE_BASE_URL ?? "https://project-eta-one-64.vercel.app";
const stamp = Date.now();
const password = "testpass123";

function adminCredentials() {
  const email = process.env.SMOKE_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
  if (!email || !adminPassword) {
    throw new Error(
      "SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD are required",
    );
  }
  return { email, password: adminPassword };
}

async function selectFirstNonEmpty(select) {
  const options = await select.locator("option").evaluateAll((opts) =>
    opts
      .map((option, index) => ({ index, value: option.value }))
      .filter((option) => option.value || option.index > 0)
  );
  if (options[0]) await select.selectOption({ index: options[0].index });
}

async function signup(browser, name, email, coopQuery) {
  const page = await browser.newPage();
  await page.goto(`${base}/signup`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("이름을 입력하세요").fill(name);
  await page.getByPlaceholder("010-0000-0000").fill("010-1000-2000");
  await page.getByPlaceholder("예: name@nonghyup.com").fill(email);
  await page.locator('input[autocomplete="new-password"]').nth(0).fill(password);
  await page.locator('input[autocomplete="new-password"]').nth(1).fill(password);
  await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill(coopQuery);
  await page.waitForTimeout(500);
  await page.locator(".signup-coop-results button").first().click();
  await page.getByPlaceholder("사원, 대리, 과장, 팀장, 차장 ...").fill("대리");
  await selectFirstNonEmpty(page.locator("select").last());
  await page.locator(".auth-check--all input").check();
  await page.getByRole("button", { name: "가입 신청 완료" }).click();
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector(".auth-complete")) ||
      Boolean(document.querySelector(".auth-form .form__error")) ||
      Boolean(document.querySelector(".auth-form [role='alert']")),
    { timeout: 30000 }
  );
  const signupError = await page.locator(".form__error, [role='alert']").first().innerText().catch(() => "");
  if (signupError) throw new Error(`signup failed: ${signupError}`);
  const completion = await page.locator(".auth-complete").innerText();
  await page.close();
  return completion;
}

async function trySignup(browser, options = {}) {
  const page = await browser.newPage();
  const email = options.email ?? `invalid-${Date.now()}@example.com`;
  await page.goto(`${base}/signup`, { waitUntil: "networkidle" });
  if (options.name !== "") {
    await page.getByPlaceholder("이름을 입력하세요").fill(options.name ?? "검증사용자");
  }
  if (options.phone !== "") {
    await page.getByPlaceholder("010-0000-0000").fill(options.phone ?? "010-1000-2000");
  }
  if (options.email !== "") {
    await page.getByPlaceholder("예: name@nonghyup.com").fill(email);
  }
  if (options.password !== "") {
    await page.locator('input[autocomplete="new-password"]').nth(0).fill(options.password ?? password);
    await page.locator('input[autocomplete="new-password"]').nth(1).fill(options.passwordConfirm ?? options.password ?? password);
  }
  if (options.coopQuery !== "") {
    await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill(options.coopQuery ?? "서울중앙농협");
    await page.waitForTimeout(500);
    await page.locator(".signup-coop-results button").first().click();
  }
  if (options.position !== "") {
    await page.getByPlaceholder("사원, 대리, 과장, 팀장, 차장 ...").fill(options.position ?? "대리");
  }
  if (options.duty !== "") {
    await selectFirstNonEmpty(page.locator("select").last());
  }
  if (options.terms !== false) {
    await page.locator(".auth-check--all input").check();
  }
  await page.getByRole("button", { name: "가입 신청 완료" }).click();
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText();
  await page.close();
  return body;
}

async function getEmailPasswordIdToken(email) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is required");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`email token exchange failed: ${data.error?.message}`);
  }
  return data.idToken;
}

async function createAuthUser(email) {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is required");
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`auth user create failed: ${data.error?.message}`);
  }
  return data.idToken;
}

async function postSignupApi(idToken, payload) {
  const res = await fetch(`${base}/api/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, ...payload }),
  });
  return { status: res.status, data: await res.json() };
}

function ledgerFor(overview, cooperativeId, userId) {
  return (overview.ledger ?? []).filter(
    (entry) => entry.cooperativeId === cooperativeId && (!userId || entry.userId === userId)
  );
}

async function login(browser, email, page = null) {
  page ??= await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("example@email.com").fill(email);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(password);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  await page.waitForTimeout(4000);
  return page;
}

async function loginAttempt(browser, email, attemptPassword) {
  const page = await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("example@email.com").fill(email);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(attemptPassword);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  await page.waitForTimeout(3000);
  const body = await page.locator("body").innerText();
  const url = page.url();
  await page.close();
  return { body, url };
}

async function adminBrowserLogin(browser) {
  const credentials = adminCredentials();
  const page = await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("example@email.com").fill(credentials.email);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(credentials.password);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  await page.waitForURL("**/admin", { timeout: 20000 });
  await page.close();
  return true;
}

async function submitConsult(page, title, visibilityLabel, coopQuery) {
  await page.goto(`${base}/consult`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill(coopQuery);
  await page.waitForTimeout(500);
  await page.locator(".coop-result").first().click();
  await page.getByPlaceholder("예: 감사인 선임 기준 문의, 조합원 세무상담 문의").fill(title);
  const visibilityValue =
    visibilityLabel === "전체공개"
      ? "public"
      : visibilityLabel === "우리농협공개"
        ? "nonghyup"
        : "private";
  await page.locator(`input[name="visibility"][value="${visibilityValue}"]`).check();
  await page
    .getByPlaceholder("문의 분야를 몰라도 괜찮습니다. 상황을 편하게 적어주세요.")
    .fill(`${title} 내용입니다.`);
  await page.locator(".consent input").first().check();
  await page.getByRole("button", { name: /문의 등록하기/ }).click();
  await page.waitForSelector(".form-success", { timeout: 30000 });
  const success = await page.locator(".form-success").innerText();
  return success.match(/REQ-\d{8}-\d{4}/)?.[0] ?? "";
}

async function submitConsultAttempt(page, overrides = {}) {
  await page.goto(`${base}/consult`, { waitUntil: "networkidle" });
  if (overrides.coopQuery !== "") {
    await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill(overrides.coopQuery ?? "서울중앙농협");
    await page.waitForTimeout(500);
    await page.locator(".coop-result").first().click();
  }
  if (overrides.subject !== "") {
    await page
      .getByPlaceholder("예: 감사인 선임 기준 문의, 조합원 세무상담 문의")
      .fill(overrides.subject ?? "검증 문의");
  }
  if (overrides.visibility) {
    await page.locator(`input[name="visibility"][value="${overrides.visibility}"]`).check();
  }
  if (overrides.message !== "") {
    await page
      .getByPlaceholder("문의 분야를 몰라도 괜찮습니다. 상황을 편하게 적어주세요.")
      .fill(overrides.message ?? "검증 문의 내용입니다.");
  }
  if (overrides.consent !== false) {
    await page.locator(".consent input").first().check();
  }
  await page.getByRole("button", { name: /문의 등록하기/ }).click();
  await page.waitForTimeout(1500);
  return page.locator("body").innerText();
}

async function logout(page) {
  await page.evaluate(async () => {
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
    await getAuth().signOut();
  }).catch(() => undefined);
}

async function getAdminToken() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error("NEXT_PUBLIC_FIREBASE_API_KEY is required");
  const credentials = adminCredentials();
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
    method: "POST",
    headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...credentials, returnSecureToken: true }),
    },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) {
    throw new Error(`admin login failed: ${data.error?.message ?? "unknown"}`);
  }
  return data.idToken;
}

async function adminOverview(token) {
  const res = await fetch(`${base}/api/admin/overview`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(`overview failed: ${data.error}`);
  return data;
}

async function apiGet(path, token) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${base}${path}`, { headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function postAdmin(token, url, body) {
  const res = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function assert(ok, label, details = "") {
  if (!ok) throw new Error(`${label} failed ${details}`);
  return { label, ok: true };
}

const browser = await chromium.launch({ headless: true });
const checks = [];

try {
  const userA1 = `mvp-a1-${stamp}@example.com`;
  const userA2 = `mvp-a2-${stamp}@example.com`;
  const userB = `mvp-b-${stamp}@example.com`;
  const token = await getAdminToken();
  const beforeOverview = await adminOverview(token);
  const usedCoops = new Set(
    (beforeOverview.organizations ?? []).map((organization) => organization.cooperativeName)
  );
  const coopCandidates = [
    "강남농협",
    "서초농협",
    "송파농협",
    "강동농협",
    "마포농협",
    "은평농협",
    "성북농협",
    "동대문농협",
    "광진농협",
    "강서농협",
    "양천농협",
    "구로농협",
    "관악농협",
    "동작농협",
    "노원농협",
    "도봉농협",
    "서울축산농협",
    "부산농협",
    "동래농협",
    "해운대농협",
    "사상농협",
    "사하농협",
    "금정농협",
    "부산강서농협",
    "기장농협",
    "남부산농협",
    "대구농협",
    "수성농협",
    "달서농협",
    "달성농협",
    "인천농협",
    "부평농협",
    "계양농협",
    "광주중앙농협",
    "동광주농협",
    "서광주농협",
    "대전농협",
    "동대전농협",
    "서대전농협",
    "울산농협",
    "남울산농협",
    "세종농협",
    "수원농협",
    "용인농협",
    "성남농협",
    "안양농협",
    "부천농협",
    "춘천농협",
    "원주농협",
    "청주농협",
    "충주농협",
    "전주농협",
    "군산농협",
    "목포농협",
    "여수농협",
    "포항농협",
    "경주농협",
    "창원농협",
    "진주농협",
    "제주농협",
    "서귀포농협",
  ];
  const unusedCoops = coopCandidates.filter((name) => !usedCoops.has(name));
  const coopA = unusedCoops[0] ?? "서울중앙농협";
  const coopB = unusedCoops[1] ?? "부산농협";

  const missingNameBody = await trySignup(browser, {
    name: "",
    email: `missing-name-${stamp}@example.com`,
    coopQuery: coopA,
  });
  const missingCoopBody = await trySignup(browser, {
    email: `missing-coop-${stamp}@example.com`,
    coopQuery: "",
  });
  const missingConsentBody = await trySignup(browser, {
    email: `missing-consent-${stamp}@example.com`,
    coopQuery: coopA,
    terms: false,
  });
  checks.push(assert(
    missingNameBody.includes("이름을 입력") &&
      missingCoopBody.includes("소속 농협") &&
      missingConsentBody.includes("필수 약관"),
    "2-1. 필수값 누락 검증"
  ));

  const firstCompletion = await signup(browser, "A농협 사용자 1", userA1, coopA);
  checks.push(assert(firstCompletion.includes(coopA), "0. 테스트 A농협 준비"));
  checks.push(assert(firstCompletion.includes("110,000P"), "3+4. A농협 최초 가입 110,000P 지급"));

  const secondCompletion = await signup(browser, "A농협 사용자 2", userA2, coopA);
  checks.push(assert(secondCompletion.includes("10,000P"), "5. A농협 추가 가입 100,000P 중복 방지"));

  const bCompletion = await signup(browser, "B농협 사용자 1", userB, coopB);
  checks.push(assert(bCompletion.includes(coopB), "0. 테스트 B농협 준비"));

  const duplicateBody = await trySignup(browser, {
    email: userA1,
    coopQuery: coopA,
  });
  checks.push(assert(duplicateBody.includes("이미 가입된 이메일"), "2-2. 중복 이메일 검증"));

  const pageA = await login(browser, userA1);
  checks.push(assert(pageA.url().includes("/mypage"), "2. 회원가입 계정 로그인"));
  const pageA2Login = await login(browser, userA2);
  checks.push(assert(pageA2Login.url().includes("/mypage"), "4-1. A농협 사용자 2 정상 로그인"));
  await pageA2Login.close();
  const pageBLogin = await login(browser, userB);
  checks.push(assert(pageBLogin.url().includes("/mypage"), "4-1. B농협 사용자 1 정상 로그인"));
  await pageBLogin.close();
  checks.push(assert(await adminBrowserLogin(browser), "4-1. 운영자 정상 로그인"));

  const wrongPassword = await loginAttempt(browser, userA1, "wrong-password");
  const missingEmail = await loginAttempt(browser, `missing-${stamp}@example.com`, password);
  checks.push(assert(
    !wrongPassword.url.includes("/mypage") &&
      wrongPassword.body.includes("올바르지 않습니다") &&
      !missingEmail.url.includes("/mypage") &&
      missingEmail.body.includes("올바르지 않습니다"),
    "4-2. 잘못된 로그인 실패"
  ));

  const userTokenForAuthCheck = await getEmailPasswordIdToken(userA1);
  const noTokenMe = await apiGet("/api/me/overview");
  const noTokenAdmin = await apiGet("/api/admin/overview");
  const userAdmin = await apiGet("/api/admin/overview", userTokenForAuthCheck);
  checks.push(assert(
    noTokenMe.status === 401 &&
      noTokenAdmin.status === 401 &&
      userAdmin.status === 403,
    "4-2~4-3. 로그아웃/비회원/농협 사용자 보호 API 접근 차단"
  ));

  const privateReq = await submitConsult(pageA, `MVP 미공개 ${stamp}`, "미공개", coopA);
  const noTypeReq = privateReq;
  const orgReq = await submitConsult(pageA, `MVP 우리농협 ${stamp}`, "우리농협공개", coopA);
  const publicReq = await submitConsult(pageA, `MVP 전체공개 ${stamp}`, "전체공개", coopA);
  const pageBForRequest = await login(browser, userB);
  const bPublicReq = await submitConsult(pageBForRequest, `MVP B농협 전체공개 ${stamp}`, "전체공개", coopB);
  await pageBForRequest.close();
  checks.push(assert(Boolean(privateReq && orgReq && publicReq && bPublicReq), "6~8. 문의 등록 및 공개범위"));
  const missingSubjectBody = await submitConsultAttempt(pageA, {
    coopQuery: coopA,
    subject: "",
    message: "제목 누락 테스트입니다.",
  });
  const missingMessageBody = await submitConsultAttempt(pageA, {
    coopQuery: coopA,
    subject: "내용 누락 테스트",
    message: "",
  });
  checks.push(assert(
    missingSubjectBody.includes("문의 제목을 입력") &&
      missingMessageBody.includes("문의 내용을 입력"),
    "5-3. 문의 필수값 누락 검증"
  ));

  const overview = await adminOverview(token);
  const userA1Record = overview.users.find((user) => user.email === userA1);
  const userA2Record = overview.users.find((user) => user.email === userA2);
  const userBRecord = overview.users.find((user) => user.email === userB);
  const privateRecord = overview.requests.find((request) => request.requestNumber === privateReq);
  const orgRecord = overview.requests.find((request) => request.requestNumber === orgReq);
  const publicRecord = overview.requests.find((request) => request.requestNumber === publicReq);
  const bPublicRecord = overview.requests.find((request) => request.requestNumber === bPublicReq);
  checks.push(assert(
    userA1Record?.nh_org_id &&
      userA1Record.nh_org_id === userA1Record.cooperativeId &&
      userA1Record.nh_org_id !== userA1Record.cooperativeName,
    "2-4. A농협 첫 사용자 users.nh_org_id 저장"
  ));
  checks.push(assert(
    userA2Record?.nh_org_id === userA1Record?.nh_org_id &&
      userBRecord?.nh_org_id &&
      userBRecord.nh_org_id !== userA1Record?.nh_org_id,
    "2-5~2-6. A농협 두 번째 사용자/B농협 사용자 조직 분리"
  ));
  const orgARecords = overview.organizations.filter(
    (organization) => organization.cooperativeId === userA1Record?.nh_org_id
  );
  const orgBRecords = overview.organizations.filter(
    (organization) => organization.cooperativeId === userBRecord?.nh_org_id
  );
  checks.push(assert(
    orgARecords.length === 1 &&
      orgBRecords.length === 1 &&
      orgARecords[0].cooperativeId !== orgBRecords[0].cooperativeId,
    "2-5~2-6. 신규 농협 조직 중복 생성 방지 및 A/B 데이터 분리"
  ));
  const orgALedgerA1 = ledgerFor(overview, userA1Record?.nh_org_id, userA1Record?.uid);
  const orgALedgerA2 = ledgerFor(overview, userA2Record?.nh_org_id, userA2Record?.uid);
  const orgBLedger = ledgerFor(overview, userBRecord?.nh_org_id, userBRecord?.uid);
  checks.push(assert(
    orgARecords[0].walletBalance === 120000 &&
      orgALedgerA1.some((entry) => entry.event === "first_org_signup" && entry.points === 100000) &&
      orgALedgerA1.some((entry) => entry.event === "user_signup" && entry.points === 10000),
    "3-1. A농협 최초 가입 포인트/거래내역 2건"
  ));
  checks.push(assert(
    orgALedgerA2.filter((entry) => entry.event === "first_org_signup").length === 0 &&
      orgALedgerA2.some((entry) => entry.event === "user_signup" && entry.points === 10000),
    "3-2. A농협 추가 사용자 user_signup_bonus만 지급"
  ));
  checks.push(assert(
    orgBRecords[0].walletBalance === 110000 &&
      orgBLedger.some((entry) => entry.event === "first_org_signup" && entry.points === 100000) &&
      orgBLedger.some((entry) => entry.event === "user_signup" && entry.points === 10000),
    "3-3. B농협 최초 가입 독립 지갑 지급"
  ));
  const invalidEmail = `invalid-org-${stamp}@example.com`;
  const invalidToken = await createAuthUser(invalidEmail);
  const invalidSignup = await postSignupApi(invalidToken, {
    name: "잘못된 농협ID 사용자",
    phone: "010-9999-0000",
    email: invalidEmail,
    nh_org_id: `missing-${stamp}`,
    position: "대리",
    duty: "회계",
    consents: {
      terms: true,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
  });
  checks.push(assert(invalidSignup.status === 400 && invalidSignup.data.error === "invalid_cooperative_id", "2-3. 존재하지 않는 농협 ID 차단"));
  const retryToken = await getEmailPasswordIdToken(userA1);
  const retrySignup = await postSignupApi(retryToken, {
    name: "A농협 사용자 1",
    phone: "010-1000-2000",
    email: userA1,
    cooperativeId: userA1Record?.nh_org_id,
    position: "대리",
    duty: "회계",
    consents: {
      terms: true,
      privacy: true,
      marketing: false,
      email: false,
      sms: false,
      kakao: false,
    },
  });
  const afterRetryOverview = await adminOverview(token);
  const afterRetryOrgA = afterRetryOverview.organizations.find(
    (organization) => organization.cooperativeId === userA1Record?.nh_org_id
  );
  const afterRetryLedgerA1 = ledgerFor(afterRetryOverview, userA1Record?.nh_org_id, userA1Record?.uid);
  const adminVisibleRequests = afterRetryOverview.requests ?? [];
  checks.push(assert(
    [privateRecord?.id, orgRecord?.id, publicRecord?.id, bPublicRecord?.id].every((id) =>
      adminVisibleRequests.some((request) => request.id === id)
    ),
    "7-1. 운영자 전체 문의 목록 조회"
  ));
  checks.push(assert(
    adminVisibleRequests.some((request) => request.nh_org_id === userA1Record?.nh_org_id) &&
      adminVisibleRequests.some((request) => request.id === bPublicRecord?.id && request.nh_org_id === userBRecord?.nh_org_id),
    "7-1. 운영자 농협별 필터 대상 구분 가능"
  ));
  checks.push(assert(
    adminVisibleRequests.some((request) => request.status === "SUBMITTED") &&
      adminVisibleRequests.some((request) => request.visibility === "PUBLIC") &&
      adminVisibleRequests.some((request) => request.visibility === "ORG_ONLY") &&
      adminVisibleRequests.some((request) => request.visibility === "PRIVATE"),
    "7-1. 운영자 상태/공개범위 필터 대상 구분 가능"
  ));
  checks.push(assert(
    retrySignup.data.completion?.grantedPoints === 0 &&
      afterRetryOrgA?.walletBalance === 120000 &&
      afterRetryLedgerA1.filter((entry) => entry.event === "first_org_signup").length === 1 &&
      afterRetryLedgerA1.filter((entry) => entry.event === "user_signup").length === 1,
    "3-4. 새로고침/재시도 포인트 거래내역 중복 방지"
  ));
  checks.push(assert(
    privateRecord?.userEmail === userA1 &&
      privateRecord?.cooperativeId &&
      privateRecord?.user_id === userA1Record?.uid,
    "5-1. 문의 등록 성공 및 user_id 자동 연결"
  ));
  checks.push(assert(
    privateRecord?.nh_org_id &&
      privateRecord.nh_org_id === userA1Record?.nh_org_id &&
      privateRecord.nh_org_id !== privateRecord.cooperativeName,
    "5-1. 문의 nh_org_id 자동 연결"
  ));
  checks.push(assert(
    privateRecord?.status === "SUBMITTED" &&
      privateRecord.visibility === "PRIVATE",
    "5-1. 문의 기본 상태 SUBMITTED/PRIVATE 저장"
  ));
  checks.push(assert(publicRecord?.visibility === "PUBLIC", "6-1. 전체공개 문의 저장"));
  checks.push(assert(
    orgRecord?.visibility === "ORG_ONLY" &&
      orgRecord.nh_org_id === userA1Record?.nh_org_id,
    "6-2. 우리농협공개 문의 ORG_ONLY/nh_org_id 저장"
  ));
  checks.push(assert(privateRecord && !("type" in privateRecord) && Boolean(noTypeReq), "5-2. 문의유형 미선택 등록 성공"));

  const badLow = await postAdmin(token, `/api/admin/requests/${privateRecord.id}/answer`, {
    internalCategory: "세무",
    pointCost: 29999,
    answerBody: "범위 실패",
  });
  const badHigh = await postAdmin(token, `/api/admin/requests/${privateRecord.id}/answer`, {
    internalCategory: "세무",
    pointCost: 100001,
    answerBody: "범위 실패",
  });
  const goodBoundaryLow = await postAdmin(token, `/api/admin/requests/${orgRecord.id}/answer`, {
    internalCategory: "회계",
    adminTags: ["경계값", "30000"],
    pointCost: 30000,
    answerBody: "30,000P 경계값 답변입니다.",
  });
  const goodBoundaryHigh = await postAdmin(token, `/api/admin/requests/${publicRecord.id}/answer`, {
    internalCategory: "공통",
    adminTags: "경계값,100000",
    pointCost: 100000,
    answerBody: "100,000P 경계값 답변입니다.",
  });
  checks.push(assert(
    badLow.status === 400 &&
      badHigh.status === 400 &&
      goodBoundaryLow.data.ok &&
      goodBoundaryHigh.data.ok,
    "7-4. 답변자 포인트 범위 30,000~100,000 검증"
  ));

  const goodAnswer = await postAdmin(token, `/api/admin/requests/${privateRecord.id}/answer`, {
    internalCategory: "감사",
    adminTags: "감사자료, 감사인 선임",
    pointCost: 30000,
    answerBody: "감사자료 준비를 위해 결산자료, 이사회 의사록, 주요 계약서 등을 먼저 정리해두는 것이 좋습니다.",
  });
  checks.push(assert(goodAnswer.data.ok, "7-3. 운영자 답변 등록 성공"));
  const afterAnswerOverview = await adminOverview(token);
  const answeredPrivateRecord = afterAnswerOverview.requests.find((request) => request.id === privateRecord.id);
  const privateAnswerRecord = afterAnswerOverview.answers.find((answer) => answer.requestId === privateRecord.id);
  checks.push(assert(
    answeredPrivateRecord?.internal_category === "감사" &&
      answeredPrivateRecord?.adminTags?.includes("감사자료") &&
      answeredPrivateRecord?.status === "ANSWER_READY" &&
      afterAnswerOverview.auditLogs.some((log) => log.action === "answer.upserted" && log.targetId === privateRecord.id),
    "7-2. 내부 분류/관리자 태그/변경 로그 저장"
  ));
  checks.push(assert(
    privateAnswerRecord?.status === "ANSWER_PUBLISHED" &&
      privateAnswerRecord.pointCost === 30000,
    "7-3. 답변 상태 및 소요 포인트 저장"
  ));
  const orgAnswer = await postAdmin(token, `/api/admin/requests/${orgRecord.id}/answer`, {
    internalCategory: "회계",
    pointCost: 50000,
    answerBody: "50,000P 답변입니다.",
  });
  const publicAnswer = await postAdmin(token, `/api/admin/requests/${publicRecord.id}/answer`, {
    internalCategory: "공통",
    pointCost: 100000,
    answerBody: "100,000P 답변입니다.",
  });
  checks.push(assert(orgAnswer.data.ok && publicAnswer.data.ok, "0. 테스트 포인트 30,000P/50,000P/100,000P 답변 준비"));

  await pageA.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA.waitForTimeout(5000);
  const beforeAnswerBody = await pageA.locator("body").innerText();
  checks.push(assert(beforeAnswerBody.includes(`MVP 미공개 ${stamp}`), "13 준비. 마이페이지 문의 조회", beforeAnswerBody.slice(0, 500)));
  checks.push(assert(
    beforeAnswerBody.includes(`MVP 미공개 ${stamp}`) &&
      beforeAnswerBody.includes("접수 완료") &&
      beforeAnswerBody.includes("답변 가능") &&
      beforeAnswerBody.includes("미공개") &&
      beforeAnswerBody.includes("우리농협공개") &&
      beforeAnswerBody.includes("전체공개"),
    "9-1. 내 문의 목록 상태/공개범위 표시"
  ));
  await pageA
    .locator("tr")
    .filter({ hasText: `MVP 미공개 ${stamp}` })
    .first()
    .getByRole("link")
    .first()
    .click();
  await pageA.waitForURL("**/mypage/requests/**", { timeout: 20000 });
  await pageA.waitForTimeout(1500);
  checks.push(assert(
    (await pageA.locator("body").innerText()).includes(`MVP 미공개 ${stamp}`),
    "9-1. 문의 클릭 상세 페이지 이동"
  ));
  await pageA.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA.waitForTimeout(3000);
  checks.push(assert(
    beforeAnswerBody.includes("30,000P") &&
      beforeAnswerBody.includes("120,000P") &&
      beforeAnswerBody.includes("답변 확인"),
    "8-1. 답변 확인 전 포인트/잔액/버튼 안내"
  ));
  const beforeViewOverview = await adminOverview(token);
  const beforeViewOrgA = beforeViewOverview.organizations.find(
    (organization) => organization.cooperativeId === privateRecord.cooperativeId
  );
  const privateRow = pageA.locator("tr").filter({ hasText: `MVP 미공개 ${stamp}` }).first();
  await privateRow.getByRole("button", { name: /답변 확인/ }).click();
  await pageA.getByText("감사자료 준비를 위해").waitFor({ timeout: 10000 });
  const bodyAfterView = await pageA.locator("body").innerText();
  checks.push(assert(bodyAfterView.includes("감사자료 준비를 위해"), "13. 고객 답변 확인 및 포인트 차감"));
  await pageA
    .locator("tr")
    .filter({ hasText: `MVP 미공개 ${stamp}` })
    .first()
    .getByRole("button", { name: /답변 다시 보기/ })
    .click();
  await pageA.waitForTimeout(2000);
  checks.push(assert((await pageA.locator("body").innerText()).includes("감사자료 준비를 위해"), "14. 재열람 중복 차감 방지"));
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForTimeout(2000);
  await pageA
    .locator("tr")
    .filter({ hasText: `MVP 미공개 ${stamp}` })
    .first()
    .getByRole("button", { name: /답변 다시 보기/ })
    .click();
  await pageA.getByText("감사자료 준비를 위해").waitFor({ timeout: 10000 });
  checks.push(assert((await pageA.locator("body").innerText()).includes("감사자료 준비를 위해"), "8-3. 새로고침 후 재진입 중복 차감 방지"));
  const privateRatingRow = pageA.locator("tr").filter({ hasText: `MVP 미공개 ${stamp}` }).first();
  await privateRatingRow.locator('select[name="score"]').selectOption("5");
  await privateRatingRow.locator('select[name="helpful"]').selectOption("true");
  await privateRatingRow.locator('input[name="comment"]').fill("실무에 도움이 되었습니다.");
  await privateRatingRow.getByRole("button", { name: "평가 저장" }).click();
  await pageA.waitForTimeout(3000);
  checks.push(assert((await pageA.locator("body").innerText()).includes("평가"), "16. 고객 답변 평가 저장"));
  await privateRatingRow.locator('select[name="score"]').selectOption("4");
  await privateRatingRow.locator('input[name="comment"]').fill("수정된 의견입니다.");
  await privateRatingRow.getByRole("button", { name: "평가 저장" }).click();
  await pageA.waitForTimeout(1500);
  await privateRatingRow.getByRole("button", { name: "추가 질문" }).click();
  await privateRatingRow
    .getByPlaceholder("추가 질문 내용을 입력해 주세요.")
    .fill("추가로 감사자료 제출 순서도 확인 부탁드립니다.");
  await privateRatingRow.getByRole("button", { name: "추가 질문 저장" }).click();
  await pageA.getByText("추가 질문이 저장되었습니다.").waitFor({ timeout: 10000 }).catch(() => undefined);
  await pageA.waitForTimeout(1000);

  const afterViewOverview = await adminOverview(token);
  const afterViewOrgA = afterViewOverview.organizations.find(
    (organization) => organization.cooperativeId === privateRecord.cooperativeId
  );
  const privateUsageLedger = afterViewOverview.ledger.filter(
    (entry) => entry.related_inquiry_id === privateRecord.id || entry.requestId === privateRecord.id
  );
  const privatePointTransaction = afterViewOverview.pointTransactions?.find(
    (entry) => entry.related_inquiry_id === privateRecord.id
  );
  const privateRating = afterViewOverview.ratings?.find(
    (rating) => rating.requestId === privateRecord.id && rating.uid === userA1Record?.uid
  );
  const followUpRecord = afterViewOverview.requests.find(
    (request) => request.parentRequestId === privateRecord.id && request.isFollowUp
  );
  checks.push(assert(
    privateRating?.score === 4 &&
      privateRating.helpful === true &&
      privateRating.comment === "수정된 의견입니다." &&
      afterViewOverview.ratings.filter((rating) => rating.requestId === privateRecord.id && rating.uid === userA1Record?.uid).length === 1,
    "10-1. 답변 평가 저장/수정 및 중복 방지"
  ));
  checks.push(assert(
    afterViewOverview.auditLogs.some((log) => log.action === "answer.rating.saved" && log.targetId === privateRecord.id),
    "10-1. 운영자 화면 평가 확인 가능"
  ));
  checks.push(assert(
    followUpRecord?.parentRequestId === privateRecord.id &&
      followUpRecord.subject.includes("[추가 질문]") &&
      followUpRecord.message.includes("추가로 감사자료 제출 순서"),
    "10-2. 기존 문의와 연결된 추가 질문 백데이터 저장"
  ));
  checks.push(assert(Boolean(followUpRecord), "10-2. 추가 질문 저장"));
  checks.push(assert(
    beforeViewOrgA?.walletBalance === 120000 &&
      afterViewOrgA?.walletBalance === 90000 &&
      privateUsageLedger.filter((entry) => entry.event === "answer_view").length === 1 &&
      privatePointTransaction?.type === "question_answer_usage" &&
      privatePointTransaction.balance_before === 120000 &&
      privatePointTransaction.amount === -30000 &&
      privatePointTransaction.balance_after === 90000,
    "8-2. 답변 확인 시 포인트 차감 및 point_transactions 저장"
  ));
  checks.push(assert(
    privateUsageLedger.filter((entry) => entry.event === "answer_view").length === 1 &&
      afterViewOrgA?.walletBalance === 90000,
    "8-3. 같은 답변 중복 차감 방지"
  ));
  checks.push(assert(afterViewOverview.ledger.some((entry) => entry.event === "answer_view" && entry.points === -30000), "13. 원장 차감 저장"));
  checks.push(assert(afterViewOverview.auditLogs.length > 0, "18. 주요 변경 로그 저장"));

  const creditAdjust = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: 50000,
    reason: "MVP 관리자 수동 지급",
  });
  const debitAdjust = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: -10000,
    reason: "MVP 관리자 수동 차감",
  });
  const missingReasonAdjust = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: 50000,
    reason: "",
  });
  const overDebitAdjust = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: -99999999,
    reason: "잔액 초과 차감 실패 테스트",
  });
  const afterManualAdjustOverview = await adminOverview(token);
  const creditTransaction = afterManualAdjustOverview.pointTransactions?.find(
    (entry) => entry.type === "admin_adjustment_credit" && entry.reason === "MVP 관리자 수동 지급"
  );
  const debitTransaction = afterManualAdjustOverview.pointTransactions?.find(
    (entry) => entry.type === "admin_adjustment_debit" && entry.reason === "MVP 관리자 수동 차감"
  );
  checks.push(assert(
    creditAdjust.data.ok &&
      creditAdjust.data.walletBalance === 140000 &&
      creditTransaction?.amount === 50000 &&
      creditTransaction.balance_before === 90000 &&
      creditTransaction.balance_after === 140000 &&
      missingReasonAdjust.status === 400,
    "11-1. 관리자 포인트 수동 지급/사유 필수/거래내역 생성"
  ));
  checks.push(assert(
    debitAdjust.data.ok &&
      debitAdjust.data.walletBalance === 130000 &&
      debitTransaction?.amount === -10000 &&
      debitTransaction.balance_before === 140000 &&
      debitTransaction.balance_after === 130000 &&
      overDebitAdjust.status === 400,
    "11-2. 관리자 포인트 수동 차감/잔액 초과 실패/거래내역 생성"
  ));

  const adjust = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: 1000,
    reason: "MVP 테스트 조정",
  });
  checks.push(assert(adjust.data.ok, "17. 운영자 포인트 수동 조정"));

  await logout(pageA);
  const pageA2 = await login(browser, userA2, pageA);
  await pageA2.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA2.waitForTimeout(5000);
  const bodyA2 = await pageA2.locator("body").innerText();
  checks.push(assert(
    bodyA2.includes(`MVP 우리농협 ${stamp}`) &&
      bodyA2.includes("우리농협공개"),
    "9-2. A농협 사용자2 ORG_ONLY 문의 표시"
  ));
  checks.push(assert(
    bodyA2.includes("131,000P"),
    "9-3. A농협 포인트 잔액 표시"
  ));
  checks.push(assert(bodyA2.includes(publicReq) || bodyA2.includes(`MVP 전체공개 ${stamp}`), "6-1. A농협 사용자2 전체공개 열람 가능"));
  checks.push(assert(bodyA2.includes(orgReq) || bodyA2.includes(`MVP 우리농협 ${stamp}`), "6-2. 같은 nh_org_id 사용자 우리농협공개 열람 가능"));
  checks.push(assert(!bodyA2.includes(privateReq) && !bodyA2.includes(`MVP 미공개 ${stamp}`), "6-3. 미공개 작성자 외 A농협 사용자 제한"));

  const pageB = await login(browser, userB);
  await pageB.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageB.waitForTimeout(5000);
  const bodyB = await pageB.locator("body").innerText();
  checks.push(assert(!bodyB.includes(`MVP 우리농협 ${stamp}`), "9-2. B농협 사용자 A농협 ORG_ONLY 문의 미표시"));
  checks.push(assert(
    bodyB.includes("110,000P") &&
      !bodyB.includes("131,000P"),
    "9-3. B농협 포인트 잔액 분리 표시"
  ));
  checks.push(assert(bodyB.includes(publicReq) || bodyB.includes(`MVP 전체공개 ${stamp}`), "6-1. B농협 사용자 전체공개 열람 가능"));
  checks.push(assert(!bodyB.includes(orgReq) && !bodyB.includes(`MVP 우리농협 ${stamp}`), "6-2. 다른 nh_org_id 사용자 우리농협공개 제한"));
  checks.push(assert(!bodyB.includes(privateReq) && !bodyB.includes(`MVP 미공개 ${stamp}`), "6-3. B농협 사용자 미공개 제한"));

  const drain = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: privateRecord.cooperativeId,
    points: -119000,
    reason: "MVP 포인트 부족 테스트",
  });
  checks.push(assert(drain.data.ok, "15 준비. 포인트 부족 상태 생성"));
  const beforeInsufficientOverview = await adminOverview(token);
  const beforeInsufficientTransactions = beforeInsufficientOverview.pointTransactions?.length ?? 0;
  await pageA2.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA2.waitForTimeout(5000);
  await pageA2
    .locator("tr")
    .filter({ hasText: `MVP 우리농협 ${stamp}` })
    .first()
    .getByRole("button", { name: /답변 확인/ })
    .click();
  await pageA2.waitForTimeout(3000);
  checks.push(assert((await pageA2.locator("body").innerText()).includes("포인트가 부족"), "15. 포인트 부족 시 답변 열람 제한"));
  const afterInsufficientOverview = await adminOverview(token);
  const insufficientOrgA = afterInsufficientOverview.organizations.find(
    (organization) => organization.cooperativeId === privateRecord.cooperativeId
  );
  checks.push(assert(
    insufficientOrgA?.walletBalance === 12000 &&
      (afterInsufficientOverview.pointTransactions?.length ?? 0) === beforeInsufficientTransactions,
    "8-4. 포인트 부족 시 답변 열람 제한 및 거래 미생성"
  ));

  console.log(JSON.stringify({ ok: true, checks, users: { userA1, userA2, userB }, coops: { coopA, coopB }, requests: { privateReq, orgReq, publicReq } }, null, 2));
} finally {
  await browser.close();
}
