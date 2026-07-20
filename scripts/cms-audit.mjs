import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runCmsAudit } from "@/lib/cms/audit";
import { CMS_FEATURE_REGISTRY } from "@/lib/cms/feature-registry";

const scriptRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootArgumentIndex = process.argv.indexOf("--root");
const projectRoot =
  rootArgumentIndex >= 0
    ? path.resolve(process.argv[rootArgumentIndex + 1] ?? "")
    : scriptRoot;
const json = process.argv.includes("--json");
const selfTest = process.argv.includes("--self-test");

const definitions = Object.values(CMS_FEATURE_REGISTRY);

if (selfTest) {
  const omitted = definitions.slice(1);
  const result = runCmsAudit(projectRoot, omitted);
  const detected = result.issues.some(
    (issue) =>
      issue.code === "unregistered_route" &&
      issue.target === definitions[0].route,
  );
  if (!detected) {
    console.error("cms:audit self-test 실패: 의도적으로 제거한 route를 감지하지 못했습니다.");
    process.exit(1);
  }
  console.log(
    `cms:audit self-test 통과: ${definitions[0].route} 등록 누락을 감지했습니다.`,
  );
  process.exit(0);
}

const result = runCmsAudit(projectRoot, definitions);
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.issues.length === 0) {
  console.log(
    `CMS 검사 통과: 사용자 route ${result.discoveredRoutes.length}개 = 등록 ${result.registeredRoutes.length}개 + 문서화된 예외 ${result.exceptionRoutes.length}개`,
  );
} else {
  console.error(`CMS 검사 실패: ${result.issues.length}개 문제`);
  for (const auditIssue of result.issues) {
    console.error(
      `- [${auditIssue.code}] ${auditIssue.target}: ${auditIssue.message}`,
    );
  }
}

process.exit(result.issues.length === 0 ? 0 : 1);
