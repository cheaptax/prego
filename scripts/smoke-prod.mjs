import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL ?? "https://project-eta-one-64.vercel.app";
const adminEmail = process.env.SMOKE_ADMIN_EMAIL;
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD;
const stamp = Date.now();

async function collect(page) {
  const body = await page.locator("body").innerText().catch(() => "");
  return body.replace(/\s+/g, " ").slice(0, 1400);
}

async function selectFirstNonEmpty(select) {
  const options = await select.locator("option").evaluateAll((opts) =>
    opts
      .map((option, index) => ({
        index,
        value: option.value,
      }))
      .filter((option) => option.value || option.index > 0)
  );
  if (options[0]) await select.selectOption({ index: options[0].index });
}

async function newPage(browser) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) {
      consoleErrors.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  return { page, consoleErrors };
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  if (adminEmail && adminPassword) {
    const { page, consoleErrors } = await newPage(browser);
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("example@email.com").fill(adminEmail);
    await page.getByPlaceholder("비밀번호를 입력하세요").fill(adminPassword);
    await page.getByRole("button", { name: /^로그인$/ }).click();
    await page.waitForTimeout(2500);
    results.push({
      test: "admin login",
      url: page.url(),
      body: await collect(page),
      consoleErrors,
    });
    await page.close();
  } else {
    results.push({
      test: "admin login",
      skipped: true,
      reason: "SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD are required",
    });
  }

  {
    const { page, consoleErrors } = await newPage(browser);
    await page.goto(`${base}/signup`, { waitUntil: "domcontentloaded" });
    await page.getByPlaceholder("이름을 입력하세요").fill("테스트사용자");
    await page.getByPlaceholder("010-0000-0000").fill("010-1234-5678");
    await page
      .getByPlaceholder("예: name@nonghyup.com")
      .fill(`test-e2e-${stamp}@example.com`);
    await page.locator('input[autocomplete="new-password"]').nth(0).fill("testpass123");
    await page.locator('input[autocomplete="new-password"]').nth(1).fill("testpass123");
    await selectFirstNonEmpty(page.locator("select").nth(0));
    await page.waitForTimeout(200);
    await selectFirstNonEmpty(page.locator("select").nth(1));
    await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill("농협");
    await page.waitForTimeout(500);
    const firstCoop = page.locator(".signup-coop-results button").first();
    if (await firstCoop.count()) await firstCoop.click();
    await page.getByPlaceholder("사원, 대리, 과장, 팀장, 차장 ...").fill("과장");
    await selectFirstNonEmpty(page.locator("select").nth(2));
    await page.locator(".auth-check--all input").check();
    await page.getByRole("button", { name: "가입 신청 완료" }).click();
    await page.waitForTimeout(3000);
    results.push({
      test: "signup submit",
      url: page.url(),
      visibleError: await page.locator(".form__error").innerText().catch(() => ""),
      completion: await page.locator(".auth-complete").innerText().catch(() => ""),
      body: await collect(page),
      consoleErrors,
    });
    await page.close();
  }

  {
    const { page, consoleErrors } = await newPage(browser);
    await page.goto(`${base}/consult`, { waitUntil: "domcontentloaded" });
    await selectFirstNonEmpty(page.locator("select").nth(0));
    await page.waitForTimeout(200);
    await selectFirstNonEmpty(page.locator("select").nth(1));
    await page.getByPlaceholder("예: 상주농협, 서울중앙농협").fill("농협");
    await page.waitForTimeout(500);
    const firstResult = page.locator(".coop-result").first();
    if (await firstResult.count()) await firstResult.click();
    await page
      .getByPlaceholder("예: 감사인 선임 기준 문의, 조합원 세무상담 문의")
      .fill("테스트 문의 제목");
    await page
      .getByPlaceholder("문의 분야를 몰라도 괜찮습니다. 상황을 편하게 적어주세요.")
      .fill("테스트 문의 내용입니다.");
    await page.locator(".consent input").first().check();
    await page.getByRole("button", { name: /문의 등록하기/ }).click();
    await page.waitForTimeout(2500);
    results.push({
      test: "consult submit",
      url: page.url(),
      visibleError: await page.locator(".form__error").innerText().catch(() => ""),
      success: await page.locator(".form-success").innerText().catch(() => ""),
      body: await collect(page),
      consoleErrors,
    });
    await page.close();
  }

  {
    const { page, consoleErrors } = await newPage(browser);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    results.push({
      test: "admin page",
      url: page.url(),
      body: await collect(page),
      consoleErrors,
    });
    await page.close();
  }

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
