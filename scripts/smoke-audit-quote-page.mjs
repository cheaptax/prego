/**
 * Happy-path UI smoke for /events/audit-quote.
 * Requires a running local server (default http://localhost:3000).
 *
 *   npm run smoke:audit-quote-page
 */
import { chromium } from "playwright";

const baseUrl = (process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  page.on("pageerror", (error) => {
    errors.push(String(error));
  });

  await page.goto(`${baseUrl}/events/audit-quote`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });

  await page.getByRole("heading", {
    name: /회계법인 견적/,
  }).waitFor({ timeout: 15_000 });

  const submit = page.getByRole("button", { name: "견적 요청하기" });
  if (await submit.count()) {
    await page.getByLabel("농협 이메일").fill("smoke-audit@nonghyup.com");
    await page.getByLabel("담당자 이름").fill("김농협");
    await page.getByLabel("휴대폰 번호").fill("01012345678");
    await page.getByRole("checkbox", { name: /개인정보 수집·이용 동의/ }).check();
    await submit.click();
    // Success depends on local Firebase env; assert the form handled the response.
    await page.waitForTimeout(1500);
    const bodyText = await page.locator("main").innerText();
    if (
      !bodyText.includes("신청이 완료됐어요") &&
      !bodyText.includes("문제가 발생") &&
      !bodyText.includes("동의해") &&
      !bodyText.includes("접수 기간")
    ) {
      throw new Error(`Unexpected form state: ${bodyText.slice(0, 200)}`);
    }
  } else {
    await page.getByText(/접수 기간이 아니에요|현재 FY27/).first().waitFor();
  }

  if (errors.length) {
    throw new Error(`Page errors: ${errors.join(" | ")}`);
  }

  await browser.close();
  console.log("smoke-audit-quote-page: ok");
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
