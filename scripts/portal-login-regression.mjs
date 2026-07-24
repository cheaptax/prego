import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.PORTAL_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const loginPages = [
  {
    path: "/login",
    title: "농협지원센터 로그인",
    description: "견적 요청 내역과 평가보고서를 확인하세요.",
  },
  {
    path: "/partner/login",
    title: "제휴사 로그인",
    description: "등록된 제휴사 운영자 계정으로 로그인하세요.",
  },
  {
    path: "/admin/login",
    title: "운영자 로그인",
    description: "농협지원센터 내부 운영자 전용입니다.",
  },
];

const browser = await chromium.launch({ headless: true });

try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    for (const loginPage of loginPages) {
      const page = await context.newPage();
      const runtimeErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push(message.text());
      });
      page.on("pageerror", (error) => runtimeErrors.push(error.message));

      const response = await page.goto(`${baseUrl}${loginPage.path}`, {
        waitUntil: "networkidle",
      });
      assert.equal(response?.status(), 200, loginPage.path);
      assert.match(
        (await page.locator("h1").textContent()) ?? "",
        new RegExp(loginPage.title),
      );
      assert.match(
        (await page.locator(".login-head__lede").textContent()) ?? "",
        new RegExp(loginPage.description),
      );
      assert.equal(
        await page.locator('.login-form input[type="email"]').first().getAttribute("autocomplete"),
        "email",
      );
      assert.equal(
        await page.locator('.login-form input[type="password"]').getAttribute("autocomplete"),
        "current-password",
      );
      assert.equal(
        await page.getByRole("button", { name: "비밀번호 찾기" }).count(),
        1,
      );
      const robots =
        (await page.locator('meta[name="robots"]').getAttribute("content")) ?? "";
      assert.match(robots, /noindex/);
      assert.match(robots, /nofollow/);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      assert.deepEqual(runtimeErrors, [], `${loginPage.path} console`);
      await page.close();
    }
    await context.close();
  }

  const interactionContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const failurePage = await interactionContext.newPage();
  let signInRequests = 0;
  await failurePage.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    if (route.request().url().includes("signInWithPassword")) {
      signInRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: 400,
            message: "INVALID_LOGIN_CREDENTIALS",
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await failurePage.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await failurePage
    .locator('.login-form input[type="email"]')
    .first()
    .fill("regression@example.invalid");
  await failurePage
    .locator('.login-form input[type="password"]')
    .fill("invalid-password");
  const submit = failurePage.locator(".login-form__submit");
  await submit.click();
  await failurePage.evaluate(() => {
    document.querySelector(".login-form__submit")?.click();
  });
  const alert = failurePage.locator('.login-form__error[role="alert"]');
  await alert.waitFor();
  assert.equal(signInRequests, 1);
  assert.doesNotMatch((await alert.textContent()) ?? "", /Firebase|INVALID_LOGIN/);
  assert.equal(
    await failurePage
      .locator('.login-form input[type="email"]')
      .first()
      .inputValue(),
    "regression@example.invalid",
  );
  assert.equal(
    await failurePage
      .locator('.login-form input[type="password"]')
      .inputValue(),
    "invalid-password",
  );

  const resetPage = await interactionContext.newPage();
  let resetRequests = 0;
  await resetPage.route("**/identitytoolkit.googleapis.com/**", async (route) => {
    if (route.request().url().includes("sendOobCode")) {
      resetRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ email: "operator@example.invalid" }),
      });
      return;
    }
    await route.continue();
  });
  await resetPage.goto(`${baseUrl}/admin/login`, {
    waitUntil: "networkidle",
  });
  await resetPage.getByRole("button", { name: "비밀번호 찾기" }).click();
  await resetPage
    .locator('.login-recovery__panel input[type="email"]')
    .fill("operator@example.invalid");
  await resetPage.locator(".login-recovery__panel button").click();
  await resetPage.locator('[role="status"]').waitFor();
  assert.equal(resetRequests, 1);

  for (const [protectedPath, loginPath] of [
    ["/mypage", "/login"],
    ["/partner", "/partner/login"],
    ["/admin", "/admin/login"],
  ]) {
    const page = await interactionContext.newPage();
    await page.goto(`${baseUrl}${protectedPath}`, {
      waitUntil: "networkidle",
    });
    assert.equal(new URL(page.url()).pathname, loginPath);
    await page.close();
  }

  const backPage = await interactionContext.newPage();
  await backPage.goto(baseUrl, { waitUntil: "networkidle" });
  await backPage.goto(`${baseUrl}/admin`, { waitUntil: "networkidle" });
  assert.equal(new URL(backPage.url()).pathname, "/admin/login");
  await backPage.goBack({ waitUntil: "networkidle" });
  assert.equal(new URL(backPage.url()).pathname, "/");

  for (const apiPath of [
    "/api/admin/session",
    "/api/partner/session",
    "/api/me/overview",
  ]) {
    const response = await interactionContext.request.get(`${baseUrl}${apiPath}`);
    assert.equal(response.status(), 401, apiPath);
  }

  const footerPage = await interactionContext.newPage();
  await footerPage.goto(baseUrl, { waitUntil: "networkidle" });
  assert.equal(
    await footerPage
      .locator('.foot__portal-links a[href="/partner/login"]')
      .count(),
    1,
  );
  assert.equal(
    await footerPage
      .locator('.foot__portal-links a[href="/admin/login"]')
      .count(),
    1,
  );
  await footerPage
    .locator('.foot__portal-links a[href="/partner/login"]')
    .focus();
  assert.equal(
    await footerPage
      .locator('.foot__portal-links a[href="/partner/login"]')
      .evaluate((element) => getComputedStyle(element).outlineWidth),
    "2px",
  );

  await footerPage.goto(`${baseUrl}/events/audit-quote`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await footerPage
      .locator('.foot__portal-links a[href="/partner/login"]')
      .count(),
    1,
  );
  assert.equal(
    await footerPage
      .locator('.foot__portal-links a[href="/admin/login"]')
      .count(),
    1,
  );

  for (const href of ["/partner/login", "/admin/login"]) {
    await footerPage.goto(baseUrl, { waitUntil: "networkidle" });
    await footerPage.locator(`.foot__portal-links a[href="${href}"]`).click();
    await footerPage.waitForURL(`${baseUrl}${href}`);
    assert.equal(new URL(footerPage.url()).pathname, href);
  }

  await interactionContext.close();
  console.log("Portal login browser regression passed.");
} finally {
  await browser.close();
}
