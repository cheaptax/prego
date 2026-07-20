import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ACCESS_VALUES = new Set(["guest", "member", "admin", "partner"]);
const PREVIEW_RENDERERS = new Set([
  "generic",
  "login",
  "signup",
  "consult",
  "inquiryBoard",
  "faqBoard",
  "simple",
  "memberDashboard",
  "requestDetail",
  "adminConsole",
  "adminOperations",
]);

function option(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function pascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function assertInputs({ key, name, route, access, previewRenderer }) {
  if (!/^[a-z][a-zA-Z0-9.-]{2,79}$/.test(key)) {
    throw new Error("--key는 영문 소문자로 시작하는 안정 식별자여야 합니다.");
  }
  if (!name || name.trim().length < 2) {
    throw new Error("--name에는 사용자가 이해할 화면 이름이 필요합니다.");
  }
  if (
    !route.startsWith("/") ||
    route.includes("?") ||
    route.includes("#") ||
    route.includes("//")
  ) {
    throw new Error("--route는 query/hash가 없는 App Router 경로여야 합니다.");
  }
  if (!access.length || access.some((role) => !ACCESS_VALUES.has(role))) {
    throw new Error(
      "--access는 guest,member,admin,partner 중 하나 이상이어야 합니다.",
    );
  }
  if (!PREVIEW_RENDERERS.has(previewRenderer)) {
    throw new Error("--renderer가 중앙 등록부의 preview renderer와 일치하지 않습니다.");
  }
}

function writeExclusive(filePath, content) {
  writeFileSync(filePath, `${content.trim()}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function createCmsFeature({
  projectRoot,
  key,
  name,
  route,
  access,
  previewRenderer = "generic",
}) {
  assertInputs({ key, name, route, access, previewRenderer });
  const slug = key.replaceAll(".", "-");
  const symbol = pascalCase(key);
  const featureDirectory = path.join(projectRoot, "lib", "cms", "features", slug);
  const testFile = path.join(
    projectRoot,
    "lib",
    "cms",
    "testing",
    `${slug}-fallback.test.ts`,
  );
  if (existsSync(featureDirectory) || existsSync(testFile)) {
    throw new Error(`이미 존재하는 CMS 기능입니다: ${key}`);
  }
  mkdirSync(featureDirectory, { recursive: true });
  mkdirSync(path.dirname(testFile), { recursive: true });

  writeExclusive(
    path.join(featureDirectory, "schema.ts"),
    `
import { cmsPageContentSchema } from "@/lib/cms/schemas";

export const ${symbol}ContentSchema = cmsPageContentSchema;
`,
  );
  writeExclusive(
    path.join(featureDirectory, "default-content.ts"),
    `
import { ${symbol}ContentSchema } from "@/lib/cms/features/${slug}/schema";

export const ${symbol}DefaultContent = ${symbol}ContentSchema.parse({
  seo: {
    title: ${JSON.stringify(name)},
    description: ${JSON.stringify(`${name} 화면 안내`)},
    indexable: true,
  },
  sections: [
    {
      id: "hero",
      visible: true,
      locked: true,
      headingLevel: 2,
      title: ${JSON.stringify(name)},
      description: "관리자에서 변경할 기본 안내를 입력해 주세요.",
      text: {},
      items: [],
      actions: [],
      groups: [],
    },
  ],
  messages: {
    loading: "잠시만 기다려 주세요.",
    error: "정보를 불러오지 못했습니다. 다시 시도해 주세요.",
  },
});
`,
  );
  writeExclusive(
    path.join(featureDirectory, "editor.ts"),
    `
import type { CmsEditorSchema } from "@/lib/cms/feature-registry";

export const ${symbol}EditorSchema = {
  sections: {
    hero: {
      name: "첫 안내",
      titleLabel: "큰 제목",
      descriptionLabel: "설명",
    },
  },
  messages: {
    loading: {
      label: "불러오는 중 안내",
      help: "화면 데이터를 준비하는 동안 표시합니다.",
    },
    error: {
      label: "오류 안내",
      help: "화면 데이터를 불러오지 못했을 때 표시합니다.",
    },
  },
} satisfies CmsEditorSchema;
`,
  );

  const audience = access.includes("admin")
    ? "admin"
    : access.includes("partner")
      ? "partner"
      : access.includes("member") && !access.includes("guest")
        ? "member"
        : "public";
  const category =
    audience === "admin"
      ? "admin"
      : audience === "member"
        ? "member"
        : "public";
  writeExclusive(
    path.join(featureDirectory, "definition.ts"),
    `
import { CMS_SCHEMA_VERSION } from "@/lib/cms/constants";
import { defineCmsFeature } from "@/lib/cms/feature-registry";
import { ${symbol}DefaultContent } from "@/lib/cms/features/${slug}/default-content";
import { ${symbol}EditorSchema } from "@/lib/cms/features/${slug}/editor";
import { ${symbol}ContentSchema } from "@/lib/cms/features/${slug}/schema";

export const ${symbol}Feature = defineCmsFeature({
  pageKey: ${JSON.stringify(key)},
  userFacingName: ${JSON.stringify(name)},
  route: ${JSON.stringify(route)},
  access: ${JSON.stringify(access)},
  contentSchema: ${symbol}ContentSchema,
  editorSchema: ${symbol}EditorSchema,
  defaultContent: ${symbol}DefaultContent,
  protectedTargets: [
    {
      id: "replace-with-protected-contract",
      description: "인증, 권한, 저장 키, API와 계산 로직 중 보호할 항목을 구체적으로 작성하세요.",
    },
  ],
  previewRenderer: ${JSON.stringify(previewRenderer)},
  adminMenu: {
    registered: true,
    presentation: {
      name: ${JSON.stringify(name)},
      description: ${JSON.stringify(`${name} 콘텐츠와 안전한 디자인을 관리합니다.`)},
      audience: ${JSON.stringify(audience)},
      audienceLabel: "접근 권한을 확인하세요",
      category: ${JSON.stringify(category)},
      categoryLabel: "신규 화면",
      previewUrl: ${route.includes("[") ? "null" : JSON.stringify(route)},
    },
  },
  fallbackTest: ${JSON.stringify(`lib/cms/testing/${slug}-fallback.test.ts`)},
  schemaVersion: CMS_SCHEMA_VERSION,
});
`,
  );
  writeExclusive(
    testFile,
    `
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ${symbol}DefaultContent } from "@/lib/cms/features/${slug}/default-content";
import { ${symbol}ContentSchema } from "@/lib/cms/features/${slug}/schema";

describe(${JSON.stringify(`${name} CMS fallback`)}, () => {
  it("keeps a valid code default when CMS data is unavailable", () => {
    const parsed = ${symbol}ContentSchema.parse(${symbol}DefaultContent);
    assert.notEqual(parsed, ${symbol}DefaultContent);
    assert.equal(parsed.sections[0]?.locked, true);
  });
});
`,
  );
  writeExclusive(
    path.join(featureDirectory, "REGISTER.md"),
    `
# ${name} CMS 등록 완료 작업

- \`${key}\`를 중앙 page key와 route 정의에 추가
- \`${symbol}Feature\`를 \`CMS_FEATURE_REGISTRY\`에 연결
- 실제 App Router page와 \`${route}\` 연결
- 실제 미리보기 renderer를 \`${previewRenderer}\` dispatch에 연결
- 보호 대상 placeholder를 실제 인증·저장·API 계약으로 교체
- \`npm run cms:audit\`, typecheck, lint, test, build 실행

route를 먼저 추가하고 중앙 등록을 누락하면 \`cms:audit\`가 실패해야 합니다.
`,
  );

  return {
    featureDirectory,
    testFile,
    filesCreated: 6,
  };
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    const argumentsList = process.argv.slice(2);
    const projectRoot = path.resolve(option(argumentsList, "--root") ?? process.cwd());
    const key = option(argumentsList, "--key") ?? "";
    const name = option(argumentsList, "--name") ?? "";
    const route = option(argumentsList, "--route") ?? "";
    const access = (option(argumentsList, "--access") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const previewRenderer =
      option(argumentsList, "--renderer") ?? "generic";
    const result = createCmsFeature({
      projectRoot,
      key,
      name,
      route,
      access,
      previewRenderer,
    });
    console.log(
      `CMS 기능 뼈대 ${result.filesCreated}개를 생성했습니다: ${result.featureDirectory}`,
    );
    console.log("REGISTER.md의 중앙 등록 절차를 완료한 뒤 cms:audit를 실행하세요.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
