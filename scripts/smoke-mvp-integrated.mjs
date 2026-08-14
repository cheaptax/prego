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

function assert(ok, label, details = "") {
  if (!ok) throw new Error(`${label} failed ${details}`);
  return { label, ok: true };
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

async function login(browser, email, page = null) {
  page ??= await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("example@email.com").fill(email);
  await page.getByPlaceholder("비밀번호를 입력하세요").fill(password);
  await page.getByRole("button", { name: /^로그인$/ }).click();
  await page.waitForTimeout(4000);
  return page;
}

async function logout(page) {
  await page
    .evaluate(async () => {
      const { getAuth } = await import("https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js");
      await getAuth().signOut();
    })
    .catch(() => undefined);
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

function pickUnusedCoops(overview) {
  const usedCoops = new Set((overview.organizations ?? []).map((organization) => organization.cooperativeName));
  const candidates = [
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
  const unused = candidates.filter((name) => !usedCoops.has(name));
  if (unused.length < 2) {
    throw new Error("통합 스모크에 사용할 미사용 농협 후보가 부족합니다.");
  }
  return { coopA: unused[0], coopB: unused[1] };
}

async function openAnswerAndWait(page, title) {
  const row = page.locator("tr").filter({ hasText: title }).first();
  await row.getByRole("button", { name: /답변 확인|답변 다시 보기/ }).click();
  await page.getByText("통합 시나리오 답변입니다.").waitFor({ timeout: 10000 });
}

const browser = await chromium.launch({ headless: true });
const checks = [];

try {
  const token = await getAdminToken();
  const beforeOverview = await adminOverview(token);
  const { coopA, coopB } = pickUnusedCoops(beforeOverview);
  const userA1 = `integrated-a1-${stamp}@example.com`;
  const userA2 = `integrated-a2-${stamp}@example.com`;
  const userB = `integrated-b-${stamp}@example.com`;

  const firstCompletion = await signup(browser, "통합 A농협 사용자 1", userA1, coopA);
  checks.push(assert(firstCompletion.includes("110,000P"), "통합 1-1. 신규 농협 첫 사용자 가입 110,000P 지급"));

  let overview = await adminOverview(token);
  const userA1Record = overview.users.find((user) => user.email === userA1);
  const orgA = overview.organizations.find((organization) => organization.cooperativeId === userA1Record?.nh_org_id);
  checks.push(assert(orgA?.walletBalance === 110000, "통합 1-2. A농협 지갑 110,000P 확인"));

  const pageA1 = await login(browser, userA1);
  const privateTitle = `통합 A농협 미공개 ${stamp}`;
  const orgOnlyTitle = `통합 A농협 우리농협 ${stamp}`;
  const privateReq = await submitConsult(pageA1, privateTitle, "미공개", coopA);
  const orgOnlyReq = await submitConsult(pageA1, orgOnlyTitle, "우리농협공개", coopA);
  checks.push(assert(Boolean(privateReq && orgOnlyReq), "통합 1-3. A농협 사용자 문의 등록"));

  overview = await adminOverview(token);
  const privateRecord = overview.requests.find((request) => request.requestNumber === privateReq);
  const orgOnlyRecord = overview.requests.find((request) => request.requestNumber === orgOnlyReq);
  checks.push(assert(privateRecord && orgOnlyRecord, "통합 1-4. 운영자 문의 확인"));

  const answer = await postAdmin(token, `/api/admin/requests/${privateRecord.id}/answer`, {
    internalCategory: "감사",
    adminTags: "통합시나리오",
    pointCost: 30000,
    answerBody: "통합 시나리오 답변입니다.",
  });
  checks.push(assert(answer.data?.ok, "통합 1-5. 운영자 내부 분류 및 30,000P 답변 등록"));

  await pageA1.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA1.waitForTimeout(3000);
  await openAnswerAndWait(pageA1, privateTitle);
  await pageA1.locator("tr").filter({ hasText: privateTitle }).first().locator('select[name="score"]').selectOption("5");
  await pageA1.locator("tr").filter({ hasText: privateTitle }).first().locator('input[name="comment"]').fill("통합 평가입니다.");
  await pageA1.locator("tr").filter({ hasText: privateTitle }).first().getByRole("button", { name: "평가 저장" }).click();
  await pageA1.waitForTimeout(1500);

  overview = await adminOverview(token);
  const orgAAfterView = overview.organizations.find((organization) => organization.cooperativeId === orgA.cooperativeId);
  checks.push(assert(orgAAfterView?.walletBalance === 80000, "통합 1-6. 답변 확인 후 A농협 포인트 110,000P -> 80,000P"));
  checks.push(assert(
    overview.ledger.some((entry) => entry.requestId === privateRecord.id && entry.points === -30000) &&
      overview.auditLogs.some((log) => log.targetId === privateRecord.id),
    "통합 1-7. 거래내역과 로그 정상 저장"
  ));
  checks.push(assert(
    overview.ratings?.some((rating) => rating.requestId === privateRecord.id && rating.score === 5),
    "통합 1-8. 고객 평가 등록"
  ));

  const secondCompletion = await signup(browser, "통합 A농협 사용자 2", userA2, coopA);
  checks.push(assert(secondCompletion.includes("10,000P") && !secondCompletion.includes("110,000P"), "통합 2-1. 같은 농협 두 번째 사용자 10,000P만 지급"));
  overview = await adminOverview(token);
  const userA2Record = overview.users.find((user) => user.email === userA2);
  const orgAAfterSecondUser = overview.organizations.find((organization) => organization.cooperativeId === orgA.cooperativeId);
  checks.push(assert(
    userA2Record?.nh_org_id === userA1Record?.nh_org_id &&
      orgAAfterSecondUser?.walletBalance === 90000,
    "통합 2-2. 최초 100,000P 중복 지급 없음 및 A농협 잔액 증가"
  ));

  await logout(pageA1);
  const pageA2 = await login(browser, userA2, pageA1);
  await pageA2.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA2.waitForTimeout(3000);
  const bodyA2 = await pageA2.locator("body").innerText();
  checks.push(assert(bodyA2.includes(orgOnlyTitle), "통합 2-3. 같은 농협 사용자 ORG_ONLY 문의 열람 가능"));

  const bCompletion = await signup(browser, "통합 B농협 사용자 1", userB, coopB);
  checks.push(assert(bCompletion.includes("110,000P"), "통합 3-1. B농협 사용자 가입"));
  const pageB = await login(browser, userB);
  await pageB.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageB.waitForTimeout(3000);
  const bodyB = await pageB.locator("body").innerText();
  checks.push(assert(!bodyB.includes(orgOnlyTitle), "통합 3-2. 다른 농협 ORG_ONLY 문의 접근 차단"));

  const targetBalance = 20000;
  const currentOrgA = (await adminOverview(token)).organizations.find(
    (organization) => organization.cooperativeId === orgA.cooperativeId
  );
  const adjustToShortage = await postAdmin(token, "/api/admin/points/adjust", {
    cooperativeId: orgA.cooperativeId,
    points: targetBalance - currentOrgA.walletBalance,
    reason: "통합 포인트 부족 테스트",
  });
  checks.push(assert(adjustToShortage.data?.ok && adjustToShortage.data.walletBalance === 20000, "통합 4-1. 운영자가 A농협 잔액 20,000P로 조정"));

  await logout(pageA2);
  const pageA1Shortage = await login(browser, userA1, pageA2);
  const shortageTitle = `통합 A농협 포인트 부족 ${stamp}`;
  const shortageReq = await submitConsult(pageA1Shortage, shortageTitle, "우리농협공개", coopA);
  const afterShortageRequestOverview = await adminOverview(token);
  const shortageRecord = afterShortageRequestOverview.requests.find((request) => request.requestNumber === shortageReq);
  const shortageAnswer = await postAdmin(token, `/api/admin/requests/${shortageRecord.id}/answer`, {
    internalCategory: "회계",
    adminTags: "통합부족",
    pointCost: 30000,
    answerBody: "통합 시나리오 답변입니다.",
  });
  checks.push(assert(shortageAnswer.data?.ok, "통합 4-2. 운영자 30,000P 답변 등록"));

  const beforeShortageOverview = await adminOverview(token);
  const beforeTxCount = beforeShortageOverview.pointTransactions?.length ?? 0;
  await logout(pageA1Shortage);
  const pageA2Shortage = await login(browser, userA2, pageA1Shortage);
  await pageA2Shortage.goto(`${base}/mypage`, { waitUntil: "networkidle" });
  await pageA2Shortage.waitForTimeout(3000);
  await pageA2Shortage.locator("tr").filter({ hasText: shortageTitle }).first().getByRole("button", { name: /답변 확인/ }).click();
  await pageA2Shortage.waitForTimeout(2000);
  const shortageBody = await pageA2Shortage.locator("body").innerText();
  const afterShortageOverview = await adminOverview(token);
  const orgAAfterShortage = afterShortageOverview.organizations.find(
    (organization) => organization.cooperativeId === orgA.cooperativeId
  );
  checks.push(assert(
    shortageBody.includes("포인트가 부족") &&
      orgAAfterShortage?.walletBalance === 20000 &&
      (afterShortageOverview.pointTransactions?.length ?? 0) === beforeTxCount,
    "통합 4-3. 포인트 부족으로 열람 제한 및 차감 없음"
  ));

  console.log(JSON.stringify({
    ok: true,
    checks,
    users: { userA1, userA2, userB },
    coops: { coopA, coopB },
    requests: { privateReq, orgOnlyReq, shortageReq },
  }, null, 2));
} finally {
  await browser.close();
}
