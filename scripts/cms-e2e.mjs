import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CMS_FEATURE_REGISTRY } from "@/lib/cms/feature-registry";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForServer(baseUrl, logs) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // The local Next.js process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `로컬 E2E 서버가 준비되지 않았습니다.\n${logs.slice(-20).join("")}`,
  );
}

function concreteRoute(route) {
  if (route === "/_not-found") return "/cms-e2e-missing-route";
  return route
    .replace(/\[\.\.\.[^\]]+\]/g, "e2e/path")
    .replace(/\[\[\.\.\.[^\]]+\]\]/g, "e2e")
    .replace(/\[[^\]]+\]/g, "e2e-request");
}

function hasAccessibleName(element) {
  const text = element.textContent?.trim();
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  const title = element.getAttribute("title")?.trim();
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledText = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(" ")
    : "";
  const imageAlt = element.querySelector("img[alt]")?.getAttribute("alt")?.trim();
  return Boolean(text || ariaLabel || title || labelledText || imageAlt);
}

function hasInputLabel(element) {
  if (
    element.getAttribute("aria-label")?.trim() ||
    element.getAttribute("aria-labelledby")?.trim() ||
    element.closest("label")
  ) {
    return true;
  }
  const id = element.getAttribute("id");
  return Boolean(id && document.querySelector(`label[for="${CSS.escape(id)}"]`));
}

async function auditPage(page, baseUrl, route, device) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/inquiries", (requestRoute) =>
    requestRoute.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, items: [], auth: "public" }),
    }),
  );
  await page.addInitScript(() => {
    window.__cmsE2eLayoutShift = 0;
    window.__cmsE2eLayoutShiftSources = [];
    new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        if (!entry.hadRecentInput) {
          window.__cmsE2eLayoutShift += entry.value;
          window.__cmsE2eLayoutShiftSources.push({
            value: entry.value,
            sources: (entry.sources ?? []).map((source) =>
              ({
                node: source.node?.outerHTML?.slice(0, 180),
                previousRect: source.previousRect,
                currentRect: source.currentRect,
              }),
            ),
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  const response = await page.goto(`${baseUrl}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(700);
  const status = response?.status() ?? 0;
  const diagnostics = await page.evaluate(
    ({ hasAccessibleNameSource, hasInputLabelSource }) => {
      const accessibleName = new Function(
        "element",
        `return (${hasAccessibleNameSource})(element)`,
      );
      const inputLabel = new Function(
        "element",
        `return (${hasInputLabelSource})(element)`,
      );
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const unnamedInteractive = [...document.querySelectorAll("a,button")]
        .filter(visible)
        .filter((element) => !accessibleName(element))
        .map((element) => element.outerHTML.slice(0, 160));
      const unlabeledInputs = [
        ...document.querySelectorAll("input:not([type=hidden]),select,textarea"),
      ]
        .filter(visible)
        .filter((element) => !inputLabel(element))
        .map((element) => element.outerHTML.slice(0, 160));
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        title: document.title,
        bodyTextLength: document.body.innerText.trim().length,
        horizontalOverflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        overflowElements: [...document.querySelectorAll("body *")]
          .filter(visible)
          .filter(
            (element) =>
              element.getBoundingClientRect().right >
              document.documentElement.clientWidth + 2,
          )
          .slice(0, 8)
          .map((element) => element.outerHTML.slice(0, 180)),
        overflowContainers: [document.documentElement, document.body]
          .concat([...document.querySelectorAll("body *")])
          .filter(
            (element) =>
              element.scrollWidth > element.clientWidth + 2 &&
              getComputedStyle(element).overflowX === "visible",
          )
          .slice(0, 12)
          .map(
            (element) =>
              `${element.tagName}.${element.className}: ${element.clientWidth}/${element.scrollWidth}`,
          ),
        unnamedInteractive,
        unlabeledInputs,
        hydrationMarkers: document.querySelectorAll(
          "[data-nextjs-dialog-overlay]",
        ).length,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
        layoutShift: window.__cmsE2eLayoutShift ?? 0,
        layoutShiftSources: window.__cmsE2eLayoutShiftSources ?? [],
      };
    },
    {
      hasAccessibleNameSource: hasAccessibleName.toString(),
      hasInputLabelSource: hasInputLabel.toString(),
    },
  );

  const issues = [];
  if (
    status >= 500 ||
    (route === "/cms-e2e-missing-route" ? status !== 404 : status >= 400)
  ) {
    issues.push(`HTTP ${status}`);
  }
  if (diagnostics.bodyTextLength === 0) issues.push("빈 화면");
  if (diagnostics.horizontalOverflow > 2) {
    issues.push(`가로 넘침 ${diagnostics.horizontalOverflow}px`);
  }
  if (diagnostics.unnamedInteractive.length > 0) {
    issues.push(
      `이름 없는 버튼/링크 ${diagnostics.unnamedInteractive.length}개`,
    );
  }
  if (diagnostics.unlabeledInputs.length > 0) {
    issues.push(`라벨 없는 입력 ${diagnostics.unlabeledInputs.length}개`);
  }
  if (diagnostics.hydrationMarkers > 0) {
    issues.push("Next.js 오류 오버레이 표시");
  }
  if (diagnostics.layoutShift > 0.1) {
    issues.push(`누적 레이아웃 이동 ${diagnostics.layoutShift.toFixed(4)}`);
  }
  const actionableConsoleErrors = consoleErrors.filter(
    (message) =>
      !(
        route === "/cms-e2e-missing-route" &&
        /status of 404|404 \(Not Found\)/i.test(message)
      ),
  );
  if (actionableConsoleErrors.length > 0) {
    issues.push(`브라우저 콘솔 오류 ${consoleErrors.join(" | ")}`);
  }
  if (pageErrors.length > 0) {
    issues.push(`페이지 오류 ${pageErrors.join(" | ")}`);
  }

  return {
    route,
    device,
    status,
    title: diagnostics.title,
    domContentLoadedMs: Math.round(diagnostics.domContentLoadedMs),
    layoutShift: Number(diagnostics.layoutShift.toFixed(4)),
    consoleErrorCount: actionableConsoleErrors.length,
    ignoredExpectedConsoleErrorCount:
      consoleErrors.length - actionableConsoleErrors.length,
    unlabeledInputSamples: diagnostics.unlabeledInputs,
    overflowElementSamples: diagnostics.overflowElements,
    overflowContainerSamples: diagnostics.overflowContainers,
    layoutShiftSources: diagnostics.layoutShiftSources,
    issues,
  };
}

async function run() {
  let serverProcess = null;
  const serverLogs = [];
  const e2eDistDir = path.join(projectRoot, ".next-e2e");
  let baseUrl = process.env.CMS_E2E_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    rmSync(e2eDistDir, { recursive: true, force: true });
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const nextBin = path.join(
      projectRoot,
      "node_modules",
      "next",
      "dist",
      "bin",
      "next",
    );
    serverProcess = spawn(
      process.execPath,
      [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          CI: "1",
          NEXT_DIST_DIR: ".next-e2e",
          CMS_E2E_OFFLINE: "1",
          GCLOUD_PROJECT: "demo-cms-e2e",
          FIREBASE_PROJECT_ID: "demo-cms-e2e",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:9",
          FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9",
          NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
          NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "127.0.0.1",
          NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-cms-e2e",
          NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-cms-e2e.appspot.com",
          NEXT_PUBLIC_FIREBASE_APP_ID: "demo-app-id",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    for (const stream of [serverProcess.stdout, serverProcess.stderr]) {
      stream?.on("data", (chunk) => {
        serverLogs.push(String(chunk));
        if (serverLogs.length > 200) serverLogs.shift();
      });
    }
    await waitForServer(baseUrl, serverLogs);
  }

  const browser = await chromium.launch();
  const results = [];
  const requestedDevices = process.env.CMS_E2E_DEVICES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const devices = [
    { name: "PC", viewport: { width: 1440, height: 900 } },
    { name: "태블릿", viewport: { width: 834, height: 1112 } },
    { name: "모바일", viewport: { width: 390, height: 844 } },
  ].filter(
    (device) =>
      !requestedDevices?.length || requestedDevices.includes(device.name),
  );
  const requestedRoutes = process.env.CMS_E2E_ROUTES?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const routes = (requestedRoutes?.length ? requestedRoutes : [
    ...new Set(
      Object.values(CMS_FEATURE_REGISTRY).map(({ route }) =>
        concreteRoute(route),
      ),
    ),
  ]);

  try {
    for (const device of devices) {
      const context = await browser.newContext({
        viewport: device.viewport,
        locale: "ko-KR",
      });
      for (const route of routes) {
        const page = await context.newPage();
        results.push(
          await auditPage(page, baseUrl, route, device.name),
        );
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (serverProcess) {
      serverProcess.kill();
      await new Promise((resolve) => {
        serverProcess.once("exit", resolve);
        setTimeout(resolve, 5_000);
      });
      rmSync(e2eDistDir, { recursive: true, force: true });
    }
  }

  const failures = results.filter((result) => result.issues.length > 0);
  const maxDomContentLoadedMs = Math.max(
    ...results.map((result) => result.domContentLoadedMs),
  );
  const maxLayoutShift = Math.max(
    ...results.map((result) => result.layoutShift),
  );
  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        routeCount: routes.length,
        scenarioCount: results.length,
        maxDomContentLoadedMs,
        maxLayoutShift,
        consoleErrorCount: results.reduce(
          (total, result) => total + result.consoleErrorCount,
          0,
        ),
        failures,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
}

await run();
