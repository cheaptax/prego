import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000";
const email = process.argv[2] || "jason@nonghyup.com";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleLogs = [];
const pageErrors = [];
const requests = [];
const responses = [];

page.on("console", (msg) => {
  consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on("pageerror", (error) => {
  pageErrors.push(String(error));
});
page.on("request", (req) => {
  if (req.url().includes("audit-evaluations") || req.method() === "POST") {
    requests.push(`${req.method()} ${req.url()}`);
  }
});
page.on("response", async (res) => {
  if (
    res.url().includes("audit-evaluations") ||
    res.request().method() === "POST"
  ) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = "<unreadable>";
    }
    responses.push(
      `${res.status()} ${res.request().method()} ${res.url()} :: ${body}`,
    );
  }
});

await page.goto(`${base}/events/audit-quote/evaluate`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() => {
  const btn = document.querySelector("button.login-card__primary");
  return Boolean(btn && Object.keys(btn).some((key) => key.startsWith("__react")));
}, null, { timeout: 10_000 }).catch(() => undefined);

await page.locator('input[type="email"]').first().fill(email);
const navigation = page
  .waitForURL(/\/events\/audit-quote\/evaluations\//, { timeout: 10_000 })
  .then(() => "navigated")
  .catch(() => "stayed");
await page.locator("button.login-card__primary").first().click();
const navResult = await navigation;
await page.waitForTimeout(1_000);

const alert = await page.locator('[role="alert"]').allTextContents().catch(() => []);
console.log(
  JSON.stringify(
    {
      navResult,
      url: page.url(),
      alert,
      consoleLogs: consoleLogs.filter((line) => !line.includes("React DevTools")),
      pageErrors,
      requests,
      responses,
    },
    null,
    2,
  ),
);

await browser.close();
process.exit(
  navResult === "navigated" ||
    responses.some((line) => line.startsWith("200 "))
    ? 0
    : 1,
);
