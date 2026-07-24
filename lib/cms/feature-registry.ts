import { CMS_AUDIT_QUOTE_MESSAGE_PRESENTATION, CMS_AUDIT_QUOTE_SECTION_PRESENTATION } from "@/lib/cms/audit-quote-presentation";
import {
  CMS_PAGE_PRESENTATION,
  type CmsPagePresentation,
} from "@/lib/cms/admin-console-presentation";
import {
  CMS_PAGE_KEYS,
  CMS_PAGE_ROUTES,
  CMS_SCHEMA_VERSION,
  type CmsPageKey,
} from "@/lib/cms/constants";
import { CMS_PAGE_DEFAULTS } from "@/lib/cms/defaults";
import {
  CMS_HOME_SECTION_PRESENTATION,
  type CmsHomeSectionPresentation,
} from "@/lib/cms/home-presentation";
import {
  CMS_ROUTE_MESSAGE_PRESENTATION,
  CMS_ROUTE_SECTION_PRESENTATION,
} from "@/lib/cms/route-presentation";
import {
  cmsPageContentSchema,
  type CmsPageContent,
} from "@/lib/cms/schemas";

export type CmsAccessRole =
  | "guest"
  | "member"
  | "admin"
  | "partner"
  | "system";

export type CmsPreviewRenderer =
  | "generic"
  | "login"
  | "signup"
  | "consult"
  | "inquiryBoard"
  | "faqBoard"
  | "simple"
  | "memberDashboard"
  | "requestDetail"
  | "auditEvaluation"
  | "adminConsole"
  | "adminOperations";

export type CmsProtectedTarget = {
  id: string;
  description: string;
};

export type CmsEditorFieldPresentation = {
  label: string;
  help: string;
};

export type CmsEditorSchema = {
  sections: Record<string, CmsHomeSectionPresentation>;
  messages: Record<string, CmsEditorFieldPresentation>;
};

export type CmsFeatureDefinition = {
  pageKey: CmsPageKey;
  userFacingName: string;
  route: string;
  access: readonly CmsAccessRole[];
  contentSchema: typeof cmsPageContentSchema;
  editorSchema: CmsEditorSchema;
  defaultContent: CmsPageContent;
  protectedTargets: readonly CmsProtectedTarget[];
  previewRenderer: CmsPreviewRenderer;
  adminMenu: {
    registered: true;
    presentation: CmsPagePresentation;
  };
  fallbackTest: string;
  schemaVersion: typeof CMS_SCHEMA_VERSION;
};

type CmsFeatureMetadata = Pick<
  CmsFeatureDefinition,
  "access" | "protectedTargets" | "previewRenderer"
>;

const protectedTarget = (
  id: string,
  description: string,
): CmsProtectedTarget => ({ id, description });

const CMS_FEATURE_METADATA: Record<CmsPageKey, CmsFeatureMetadata> = {
  home: {
    access: ["guest", "member", "admin"],
    previewRenderer: "generic",
    protectedTargets: [
      protectedTarget("auth-routing", "로그인 상태에 따른 상담·마이페이지 이동"),
      protectedTarget("stable-service-ids", "지원 분야와 FAQ의 안정 식별자"),
    ],
  },
  "auth.login": {
    access: ["guest"],
    previewRenderer: "login",
    protectedTargets: [
      protectedTarget("firebase-auth", "Firebase 로그인과 세션 유지"),
      protectedTarget("auth-endpoints", "계정 찾기와 회원 상태 API 연결"),
    ],
  },
  "auth.partnerLogin": {
    access: ["guest"],
    previewRenderer: "login",
    protectedTargets: [
      protectedTarget("firebase-auth", "Firebase 로그인과 세션 유지"),
      protectedTarget("partner-portal-routing", "제휴사 계정 판정과 포털 이동"),
    ],
  },
  "auth.adminLogin": {
    access: ["guest"],
    previewRenderer: "login",
    protectedTargets: [
      protectedTarget("firebase-auth", "Firebase 로그인과 세션 유지"),
      protectedTarget("admin-portal-routing", "운영자 계정 판정과 관리자 포털 이동"),
    ],
  },
  "auth.signup": {
    access: ["guest"],
    previewRenderer: "signup",
    protectedTargets: [
      protectedTarget("identity-verification", "이메일·휴대폰 인증과 농협 소속 검증"),
      protectedTarget("signup-payload", "가입 payload, 저장 키와 필수 동의 여부"),
      protectedTarget("upload-limits", "명함 파일 형식과 용량 제한"),
    ],
  },
  "auth.pendingApproval": {
    access: ["member"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("approval-status", "회원 승인 상태와 로그인 이동 정책"),
    ],
  },
  "auth.portalAccessDenied": {
    access: ["guest", "member", "partner", "admin"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget(
        "portal-routing",
        "인증된 계정의 canonical 포털과 로그아웃 이동 정책",
      ),
    ],
  },
  "legal.terms": {
    access: ["guest", "member", "admin"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("required-legal-sections", "법적 필수 영역의 표시·잠금과 이력"),
    ],
  },
  "legal.privacy": {
    access: ["guest", "member", "admin"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("required-privacy-sections", "개인정보 필수 영역의 표시·잠금과 이력"),
    ],
  },
  "public.consult": {
    access: ["guest", "member"],
    previewRenderer: "consult",
    protectedTargets: [
      protectedTarget("consult-acl", "회원·소속 농협 확인과 문의 공개범위 권한"),
      protectedTarget("consult-payload", "문의·첨부 저장 키, API와 업로드 제한"),
    ],
  },
  "public.inquiries": {
    access: ["guest", "member"],
    previewRenderer: "inquiryBoard",
    protectedTargets: [
      protectedTarget("inquiry-projection", "공개범위별 문의·답변 마스킹과 조회 권한"),
      protectedTarget("inquiry-api", "문의 조회 API와 Firestore 저장 구조"),
    ],
  },
  "public.faq": {
    access: ["guest", "member", "admin"],
    previewRenderer: "faqBoard",
    protectedTargets: [
      protectedTarget("faq-publication", "공개 게시 상태, 안정 ID와 fallback 검증"),
    ],
  },
  "public.support": {
    access: ["guest", "member", "admin"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("safe-support-links", "고객지원 링크 프로토콜과 목적지 검증"),
    ],
  },
  "event.auditQuote": {
    access: ["guest", "member", "admin"],
    previewRenderer: "generic",
    protectedTargets: [
      protectedTarget("audit-quote-payload", "견적 신청 payload, input name과 API"),
      protectedTarget("audit-quote-security", "동의 필수 여부, honeypot, rate limit과 중복 방지"),
    ],
  },
  "event.auditQuoteEvaluate": {
    access: ["guest", "member"],
    previewRenderer: "auditEvaluation",
    protectedTargets: [
      protectedTarget("evaluation-feature-gate", "고객 진입 기능 플래그의 서버 검증"),
      protectedTarget("evaluation-access-link", "1회성 링크 hash, 만료, 재발급과 철회"),
      protectedTarget("evaluation-enumeration", "이메일 존재 여부를 숨기는 동일 응답"),
    ],
  },
  "event.auditQuoteEvaluation": {
    access: ["guest", "member"],
    previewRenderer: "auditEvaluation",
    protectedTargets: [
      protectedTarget("evaluation-case-acl", "HttpOnly 세션과 caseId 일치 검증"),
      protectedTarget("evaluation-case-idempotency", "견적요청별 평가 건 단일 생성"),
      protectedTarget("evaluation-upload-boundary", "업로드 intent, 서버 파일 검증, 격리 경로와 개수 제한"),
    ],
  },
  "event.auditQuoteEvaluationReview": {
    access: ["guest", "member"],
    previewRenderer: "auditEvaluation",
    protectedTargets: [
      protectedTarget("evaluation-review-acl", "평가 건 세션과 caseId 일치 검증"),
      protectedTarget("evaluation-correction-lock", "고객 정정 이력과 낙관적 잠금"),
      protectedTarget("evaluation-final-confirmation", "필수값·무결성·설정 적용기간 서버 재검증"),
      protectedTarget("evaluation-confirmed-snapshot", "고객 확정 데이터 전용 불변 보고서 입력"),
    ],
  },
  "event.auditQuoteEvaluationReport": {
    access: ["guest", "member"],
    previewRenderer: "auditEvaluation",
    protectedTargets: [
      protectedTarget("evaluation-report-acl", "평가 건 세션과 보고서 기능 플래그 검증"),
      protectedTarget("evaluation-report-immutability", "보고서 스냅샷과 과거 버전 보호"),
    ],
  },
  "member.mypage": {
    access: ["member"],
    previewRenderer: "memberDashboard",
    protectedTargets: [
      protectedTarget("member-session", "회원 상태·bearer 인증과 개인정보 projection"),
      protectedTarget("member-ledger", "포인트 집계와 동의 변경 payload"),
    ],
  },
  "member.quotes": {
    access: ["member"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("quote-download-acl", "견적서 본인 이메일·회원 UID 검증"),
      protectedTarget("quote-signed-url", "짧은 유효기간 PDF 다운로드 URL 발급"),
    ],
  },
  "member.quoteDetail": {
    access: ["member"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("quote-detail-acl", "견적서 상세 접근 권한 검증"),
    ],
  },
  "member.requestDetail": {
    access: ["member"],
    previewRenderer: "requestDetail",
    protectedTargets: [
      protectedTarget("request-acl", "문의 식별자와 본인·소속 권한"),
      protectedTarget("answer-transaction", "답변 열람 포인트 차감, 평가와 완료 순서"),
    ],
  },
  "partner.apply": {
    access: ["guest", "member", "admin"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("partner-application-payload", "제휴 신청 저장 키와 필수 동의"),
      protectedTarget("partner-application-security", "honeypot, 중복 접수와 서버 검증"),
    ],
  },
  "partner.portal": {
    access: ["partner"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("partner-access", "파트너 인증·배정 ACL"),
      protectedTarget("quote-evaluation-schema", "평가 입력 내부 저장 키와 런타임 검증"),
      protectedTarget("quote-evaluation-scoring", "견적 정량점수 계산식과 평가기준 버전 고정"),
      protectedTarget("quote-document-signing", "감사평가용 표준 견적 전자서명과 문서 식별자"),
    ],
  },
  "admin.console": {
    access: ["admin"],
    previewRenderer: "adminConsole",
    protectedTargets: [
      protectedTarget("admin-claim", "Firebase admin custom claim 검증"),
      protectedTarget("cms-lifecycle", "초안·게시·이력 분리와 충돌 검증"),
    ],
  },
  "admin.operations": {
    access: ["admin"],
    previewRenderer: "adminOperations",
    protectedTargets: [
      protectedTarget("admin-operations", "회원·문의·포인트 상태 전이와 관리자 API"),
      protectedTarget("admin-pii", "개인정보와 Firestore 저장 키"),
    ],
  },
  "framework.notFound": {
    access: ["system"],
    previewRenderer: "simple",
    protectedTargets: [
      protectedTarget("http-status", "Next.js 404 응답 상태 처리"),
    ],
  },
};

function editorSchemaFor(pageKey: CmsPageKey): CmsEditorSchema {
  if (pageKey === "home") {
    return {
      sections: CMS_HOME_SECTION_PRESENTATION,
      messages: {
        loading: {
          label: "홈 화면 불러오는 중 안내",
          help: "홈 화면의 게시 콘텐츠를 준비하는 동안 표시합니다.",
        },
        error: {
          label: "홈 화면 오류 안내",
          help: "홈 화면 콘텐츠를 불러오지 못했을 때 표시합니다.",
        },
      },
    };
  }
  if (pageKey === "event.auditQuote") {
    return {
      sections: CMS_AUDIT_QUOTE_SECTION_PRESENTATION,
      messages: CMS_AUDIT_QUOTE_MESSAGE_PRESENTATION,
    };
  }
  return {
    sections: CMS_ROUTE_SECTION_PRESENTATION[pageKey] ?? {},
    messages: CMS_ROUTE_MESSAGE_PRESENTATION[pageKey] ?? {},
  };
}

export const CMS_FEATURE_REGISTRY = Object.fromEntries(
  CMS_PAGE_KEYS.map((pageKey) => {
    const metadata = CMS_FEATURE_METADATA[pageKey];
    return [
      pageKey,
      {
        pageKey,
        userFacingName: CMS_PAGE_PRESENTATION[pageKey].name,
        route: CMS_PAGE_ROUTES[pageKey],
        access: metadata.access,
        contentSchema: cmsPageContentSchema,
        editorSchema: editorSchemaFor(pageKey),
        defaultContent: CMS_PAGE_DEFAULTS[pageKey],
        protectedTargets: metadata.protectedTargets,
        previewRenderer: metadata.previewRenderer,
        adminMenu: {
          registered: true,
          presentation: CMS_PAGE_PRESENTATION[pageKey],
        },
        fallbackTest: "lib/cms/testing/feature-registry.test.ts",
        schemaVersion: CMS_SCHEMA_VERSION,
      } satisfies CmsFeatureDefinition,
    ];
  }),
) as Record<CmsPageKey, CmsFeatureDefinition>;

export function getCmsFeatureDefinition(pageKey: CmsPageKey) {
  return CMS_FEATURE_REGISTRY[pageKey];
}

export function defineCmsFeature<const Definition extends CmsFeatureDefinition>(
  definition: Definition,
) {
  return definition;
}
