import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import {
  CMS_FEATURE_REGISTRY,
  type CmsFeatureDefinition,
} from "@/lib/cms/feature-registry";

const PAGE_FILE_PATTERN = /^page\.(?:js|jsx|mjs|ts|tsx)$/;
const NOT_FOUND_FILE_PATTERN = /^not-found\.(?:js|jsx|mjs|ts|tsx)$/;

export type CmsRouteException = {
  route: string;
  kind: "cms-editor" | "framework" | "external";
  reason: string;
  owner: string;
  reviewBy: string;
};

export type CmsAuditIssueCode =
  | "unregistered_route"
  | "registered_route_missing"
  | "duplicate_registered_route"
  | "invalid_exception"
  | "unused_exception"
  | "missing_user_name"
  | "missing_access"
  | "missing_default_content"
  | "invalid_default_content"
  | "missing_content_schema"
  | "missing_editor_schema"
  | "missing_editor_section"
  | "missing_editor_field"
  | "missing_protected_targets"
  | "missing_preview_renderer"
  | "missing_admin_menu"
  | "missing_fallback_test"
  | "invalid_schema_version";

export type CmsAuditIssue = {
  code: CmsAuditIssueCode;
  target: string;
  message: string;
};

export type CmsAuditResult = {
  discoveredRoutes: string[];
  registeredRoutes: string[];
  exceptionRoutes: string[];
  issues: CmsAuditIssue[];
};

type AuditableDefinition = Pick<
  CmsFeatureDefinition,
  | "pageKey"
  | "route"
  | "userFacingName"
  | "access"
  | "contentSchema"
  | "editorSchema"
  | "defaultContent"
  | "protectedTargets"
  | "previewRenderer"
  | "adminMenu"
  | "fallbackTest"
  | "schemaVersion"
>;

function normalizeRoute(route: string) {
  if (route === "/") return route;
  const normalized = `/${route.replaceAll("\\", "/")}`
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
  return normalized || "/";
}

function routeSegment(segment: string): string | null {
  if (!segment || segment.startsWith("_") || segment.startsWith("@")) {
    return null;
  }
  if (segment.startsWith("(") && segment.endsWith(")")) {
    return null;
  }
  const intercepting = segment.match(/^\((?:\.)+\)(.+)$/);
  return intercepting?.[1] ?? segment;
}

function routeFromPageFile(appDirectory: string, filePath: string) {
  const relativeDirectory = path.relative(appDirectory, path.dirname(filePath));
  const rawSegments =
    relativeDirectory === ""
      ? []
      : relativeDirectory.split(path.sep);
  if (rawSegments[0] === "api") return null;
  if (rawSegments.some((segment) => segment.startsWith("_"))) return null;
  const segments = rawSegments.flatMap((segment) => {
    const normalized = routeSegment(segment);
    return normalized ? [normalized] : [];
  });
  return normalizeRoute(segments.join("/"));
}

function walkPageFiles(directory: string, files: string[]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walkPageFiles(target, files);
      continue;
    }
    if (PAGE_FILE_PATTERN.test(entry.name)) files.push(target);
  }
}

export function discoverAppPageRoutes(projectRoot: string) {
  const appDirectory = path.join(projectRoot, "app");
  if (!existsSync(appDirectory) || !statSync(appDirectory).isDirectory()) {
    throw new Error(`App Router 디렉터리를 찾을 수 없습니다: ${appDirectory}`);
  }

  const files: string[] = [];
  walkPageFiles(appDirectory, files);
  const routes = new Set(
    files.flatMap((filePath) => {
      const route = routeFromPageFile(appDirectory, filePath);
      return route ? [route] : [];
    }),
  );

  if (
    readdirSync(appDirectory).some((fileName) =>
      NOT_FOUND_FILE_PATTERN.test(fileName),
    )
  ) {
    routes.add("/_not-found");
  }

  return [...routes].sort();
}

export function loadCmsRouteExceptions(projectRoot: string) {
  const exceptionPath = path.join(
    projectRoot,
    "docs",
    "CMS_ROUTE_EXCEPTIONS.json",
  );
  if (!existsSync(exceptionPath)) return [];
  const parsed = JSON.parse(readFileSync(exceptionPath, "utf8")) as {
    schemaVersion?: unknown;
    exceptions?: unknown;
  };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.exceptions)) {
    throw new Error("CMS_ROUTE_EXCEPTIONS.json 형식 또는 schemaVersion이 올바르지 않습니다.");
  }
  return parsed.exceptions as CmsRouteException[];
}

function issue(
  code: CmsAuditIssueCode,
  target: string,
  message: string,
): CmsAuditIssue {
  return { code, target, message };
}

export function auditCmsRouteCoverage(
  discoveredRoutes: readonly string[],
  definitions: readonly AuditableDefinition[],
  exceptions: readonly CmsRouteException[],
) {
  const issues: CmsAuditIssue[] = [];
  const normalizedDiscovered = new Set(discoveredRoutes.map(normalizeRoute));
  const definitionByRoute = new Map<string, AuditableDefinition>();

  for (const definition of definitions) {
    const route = normalizeRoute(definition.route);
    const duplicate = definitionByRoute.get(route);
    if (duplicate) {
      issues.push(
        issue(
          "duplicate_registered_route",
          route,
          `${duplicate.pageKey}와 ${definition.pageKey}가 같은 route를 등록했습니다.`,
        ),
      );
    } else {
      definitionByRoute.set(route, definition);
    }
  }

  const exceptionByRoute = new Map<string, CmsRouteException>();
  for (const exception of exceptions) {
    const route =
      typeof exception.route === "string"
        ? normalizeRoute(exception.route)
        : "";
    const valid =
      route.startsWith("/") &&
      ["cms-editor", "framework", "external"].includes(exception.kind) &&
      typeof exception.reason === "string" &&
      exception.reason.trim().length >= 20 &&
      typeof exception.owner === "string" &&
      exception.owner.trim().length >= 2 &&
      typeof exception.reviewBy === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(exception.reviewBy);
    if (!valid) {
      issues.push(
        issue(
          "invalid_exception",
          route || "unknown",
          "예외에는 route, 종류, 충분한 사유, 담당자와 YYYY-MM-DD 검토일이 필요합니다.",
        ),
      );
      continue;
    }
    exceptionByRoute.set(route, exception);
  }

  for (const route of normalizedDiscovered) {
    if (definitionByRoute.has(route) || exceptionByRoute.has(route)) continue;
    issues.push(
      issue(
        "unregistered_route",
        route,
        "사용자 route가 CMS 등록부에 없고 명시적인 예외 문서도 없습니다.",
      ),
    );
  }

  for (const [route, definition] of definitionByRoute) {
    if (!normalizedDiscovered.has(route)) {
      issues.push(
        issue(
          "registered_route_missing",
          definition.pageKey,
          `등록된 route ${route}에 대응하는 App Router page가 없습니다.`,
        ),
      );
    }
  }

  for (const route of exceptionByRoute.keys()) {
    if (!normalizedDiscovered.has(route)) {
      issues.push(
        issue(
          "unused_exception",
          route,
          "현재 App Router에 없는 route 예외입니다. 삭제하거나 route를 확인해 주세요.",
        ),
      );
    }
  }

  return issues;
}

export function auditCmsDefinitions(
  definitions: readonly AuditableDefinition[],
  projectRoot: string,
) {
  const issues: CmsAuditIssue[] = [];
  for (const definition of definitions) {
    const target = definition.pageKey;
    if (!definition.userFacingName?.trim()) {
      issues.push(
        issue(
          "missing_user_name",
          target,
          "관리자와 사용자가 이해할 화면 이름이 없습니다.",
        ),
      );
    }
    if (!definition.access?.length) {
      issues.push(
        issue("missing_access", target, "화면 접근 권한 정의가 없습니다."),
      );
    }
    if (!definition.defaultContent) {
      issues.push(
        issue("missing_default_content", target, "코드 기본 콘텐츠가 없습니다."),
      );
      continue;
    }
    if (!definition.contentSchema?.safeParse) {
      issues.push(
        issue("missing_content_schema", target, "런타임 contentSchema가 없습니다."),
      );
    } else {
      const result = definition.contentSchema.safeParse(definition.defaultContent);
      if (!result.success) {
        issues.push(
          issue(
            "invalid_default_content",
            target,
            `기본 콘텐츠가 runtime schema를 통과하지 못했습니다: ${result.error.issues[0]?.message ?? "unknown"}`,
          ),
        );
      }
    }

    if (!definition.editorSchema) {
      issues.push(
        issue("missing_editor_schema", target, "관리자 editorSchema가 없습니다."),
      );
    } else {
      for (const section of definition.defaultContent.sections) {
        const editorSection = definition.editorSchema.sections[section.id];
        if (!editorSection) {
          issues.push(
            issue(
              "missing_editor_section",
              `${target}.${section.id}`,
              "기본 콘텐츠 영역의 관리자 편집 정의가 없습니다.",
            ),
          );
          continue;
        }
        for (const fieldKey of Object.keys(section.text)) {
          if (!editorSection.textFields?.[fieldKey]) {
            issues.push(
              issue(
                "missing_editor_field",
                `${target}.${section.id}.${fieldKey}`,
                "사용자 노출 text 필드의 관리자 라벨과 도움말이 없습니다.",
              ),
            );
          }
        }
      }
      for (const messageKey of Object.keys(definition.defaultContent.messages)) {
        if (!definition.editorSchema.messages[messageKey]) {
          issues.push(
            issue(
              "missing_editor_field",
              `${target}.messages.${messageKey}`,
              "상태 메시지의 관리자 라벨과 도움말이 없습니다.",
            ),
          );
        }
      }
    }

    if (
      !definition.protectedTargets?.length ||
      definition.protectedTargets.some(
        (protectedItem) =>
          !protectedItem.id.trim() ||
          !protectedItem.description.trim() ||
          protectedItem.id.includes("replace-with") ||
          protectedItem.description.includes("작성하세요"),
      )
    ) {
      issues.push(
        issue(
          "missing_protected_targets",
          target,
          "인증, 저장 키, API 등 보호 대상을 정의해야 합니다.",
        ),
      );
    }
    if (!definition.previewRenderer) {
      issues.push(
        issue(
          "missing_preview_renderer",
          target,
          "관리자 미리보기 renderer가 없습니다.",
        ),
      );
    }
    if (!definition.adminMenu?.registered) {
      issues.push(
        issue(
          "missing_admin_menu",
          target,
          "관리자 페이지 목록 등록 정보가 없습니다.",
        ),
      );
    }
    if (definition.schemaVersion !== 1) {
      issues.push(
        issue(
          "invalid_schema_version",
          target,
          "현재 CMS schemaVersion과 기능 정의가 일치하지 않습니다.",
        ),
      );
    }
    if (
      !definition.fallbackTest ||
      !existsSync(path.join(projectRoot, definition.fallbackTest))
    ) {
      issues.push(
        issue(
          "missing_fallback_test",
          target,
          "등록된 fallback 테스트 파일을 찾을 수 없습니다.",
        ),
      );
    }
  }
  return issues;
}

export function runCmsAudit(
  projectRoot: string,
  definitions: readonly AuditableDefinition[] = Object.values(
    CMS_FEATURE_REGISTRY,
  ),
): CmsAuditResult {
  const discoveredRoutes = discoverAppPageRoutes(projectRoot);
  const exceptions = loadCmsRouteExceptions(projectRoot);
  const routeIssues = auditCmsRouteCoverage(
    discoveredRoutes,
    definitions,
    exceptions,
  );
  const definitionIssues = auditCmsDefinitions(definitions, projectRoot);
  return {
    discoveredRoutes,
    registeredRoutes: definitions.map(({ route }) => normalizeRoute(route)).sort(),
    exceptionRoutes: exceptions.map(({ route }) => normalizeRoute(route)).sort(),
    issues: [...routeIssues, ...definitionIssues],
  };
}
