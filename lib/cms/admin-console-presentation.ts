import type { CmsGlobalKey, CmsPageKey } from "@/lib/cms/constants";
import type {
  CmsDraftGlobal,
  CmsDraftPage,
  CmsPublishedGlobal,
  CmsPublishedPage,
} from "@/lib/cms/schemas";

export type CmsPagePresentation = {
  name: string;
  description: string;
  audience: "public" | "member" | "partner" | "admin";
  audienceLabel: string;
  category: "public" | "auth" | "member" | "event" | "admin" | "other";
  categoryLabel: string;
  previewUrl: string | null;
};

export const CMS_PAGE_PRESENTATION: Record<CmsPageKey, CmsPagePresentation> = {
  home: {
    name: "홈",
    description: "센터 소개, 지원 분야, 상담 절차와 주요 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "public",
    categoryLabel: "공개 화면",
    previewUrl: "/",
  },
  "auth.login": {
    name: "고객 로그인",
    description: "고객 로그인, 회원가입과 계정 찾기 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/login",
  },
  "auth.partnerLogin": {
    name: "제휴사 로그인",
    description: "제휴사 운영자 로그인과 계정 지원 안내",
    audience: "partner",
    audienceLabel: "제휴사 운영자",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/partner/login",
  },
  "auth.adminLogin": {
    name: "운영자 로그인",
    description: "농협지원센터 내부 운영자 로그인 안내",
    audience: "admin",
    audienceLabel: "내부 운영자",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/admin/login",
  },
  "auth.signup": {
    name: "회원가입",
    description: "가입 정보, 인증과 동의 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/signup",
  },
  "auth.pendingApproval": {
    name: "가입 승인 대기",
    description: "가입 신청 후 승인 대기 안내",
    audience: "member",
    audienceLabel: "가입 신청자",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/pending-approval",
  },
  "auth.portalAccessDenied": {
    name: "포털 접근 제한",
    description: "계정 유형과 다른 포털 접근 시 표시하는 안전한 안내",
    audience: "public",
    audienceLabel: "인증 사용자",
    category: "auth",
    categoryLabel: "로그인·가입",
    previewUrl: "/portal-access-denied",
  },
  "legal.terms": {
    name: "이용약관",
    description: "서비스 이용 조건과 책임 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "auth",
    categoryLabel: "약관·개인정보",
    previewUrl: "/terms",
  },
  "legal.privacy": {
    name: "개인정보처리방침",
    description: "개인정보 수집·이용·보관과 권리 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "auth",
    categoryLabel: "약관·개인정보",
    previewUrl: "/privacy",
  },
  "public.consult": {
    name: "상담 신청",
    description: "상담 분야와 문의 작성 안내",
    audience: "member",
    audienceLabel: "로그인 회원",
    category: "public",
    categoryLabel: "상담 서비스",
    previewUrl: "/consult",
  },
  "public.inquiries": {
    name: "상담 게시판",
    description: "공개 상담 검색과 답변 목록",
    audience: "public",
    audienceLabel: "공개·회원",
    category: "public",
    categoryLabel: "상담 서비스",
    previewUrl: "/inquiries",
  },
  "public.faq": {
    name: "자주 묻는 질문",
    description: "서비스 이용 질문과 답변",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "public",
    categoryLabel: "공개 화면",
    previewUrl: "/faq",
  },
  "public.support": {
    name: "고객지원",
    description: "문의 방법과 지원 채널 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "public",
    categoryLabel: "공개 화면",
    previewUrl: "/support",
  },
  "event.auditQuote": {
    name: "회계감사 견적 행사",
    description: "견적 지원 신청, 혜택과 이용 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "event",
    categoryLabel: "행사 화면",
    previewUrl: "/events/audit-quote",
  },
  "event.auditQuoteEvaluate": {
    name: "감사인 견적 평가 접속",
    description: "이메일 링크와 고객 로그인으로 평가 화면에 접속",
    audience: "public",
    audienceLabel: "견적 요청 고객",
    category: "event",
    categoryLabel: "행사 화면",
    previewUrl: "/events/audit-quote/evaluate",
  },
  "event.auditQuoteEvaluation": {
    name: "감사인 견적 평가 진행",
    description: "견적 등록 현황, 절차와 문서 처리 안내",
    audience: "member",
    audienceLabel: "해당 견적 요청 고객",
    category: "event",
    categoryLabel: "행사 화면",
    previewUrl: null,
  },
  "event.auditQuoteEvaluationReview": {
    name: "감사인 견적정보 확인·정정",
    description: "추출 견적 비교, 고객 정정, 최종 확인과 보고서 생성 요청",
    audience: "member",
    audienceLabel: "해당 견적 요청 고객",
    category: "event",
    categoryLabel: "행사 화면",
    previewUrl: null,
  },
  "event.auditQuoteEvaluationReport": {
    name: "감사인 견적 평가보고서",
    description: "평가보고서 상태와 의사결정 안내",
    audience: "member",
    audienceLabel: "해당 견적 요청 고객",
    category: "event",
    categoryLabel: "행사 화면",
    previewUrl: null,
  },
  "member.mypage": {
    name: "마이페이지",
    description: "내 상담, 포인트와 회원 정보",
    audience: "member",
    audienceLabel: "승인 회원",
    category: "member",
    categoryLabel: "회원 화면",
    previewUrl: "/mypage",
  },
  "member.quotes": {
    name: "내 견적서",
    description: "제휴사가 발행한 견적서 목록과 다운로드 안내",
    audience: "member",
    audienceLabel: "승인 회원",
    category: "member",
    categoryLabel: "회원 화면",
    previewUrl: "/mypage/quotes",
  },
  "member.quoteDetail": {
    name: "견적서 상세",
    description: "견적서 상세와 PDF 다운로드 안내",
    audience: "member",
    audienceLabel: "해당 회원",
    category: "member",
    categoryLabel: "회원 화면",
    previewUrl: null,
  },
  "member.requestDetail": {
    name: "상담 상세",
    description: "문의, 답변, 평가와 완료 안내",
    audience: "member",
    audienceLabel: "해당 회원",
    category: "member",
    categoryLabel: "회원 화면",
    previewUrl: null,
  },
  "partner.apply": {
    name: "제휴사 가입 신청",
    description: "제휴사 신청 폼과 심사 안내",
    audience: "public",
    audienceLabel: "제휴 희망자",
    category: "other",
    categoryLabel: "협력 화면",
    previewUrl: "/partner/apply",
  },
  "partner.portal": {
    name: "협력 전문가 화면",
    description: "협력 전문가 전용 업무 안내",
    audience: "partner",
    audienceLabel: "협력 전문가",
    category: "other",
    categoryLabel: "협력 화면",
    previewUrl: "/partner",
  },
  "admin.operations": {
    name: "회원·상담 운영",
    description: "회원 승인, 상담, 포인트와 운영 업무의 표시 안내",
    audience: "admin",
    audienceLabel: "관리자",
    category: "admin",
    categoryLabel: "관리자 화면",
    previewUrl: "/admin/operations",
  },
  "admin.console": {
    name: "콘텐츠 관리자",
    description: "화면, 공통 영역과 게시 상태를 관리하는 관리자 화면",
    audience: "admin",
    audienceLabel: "관리자",
    category: "admin",
    categoryLabel: "관리자 화면",
    previewUrl: "/admin",
  },
  "framework.notFound": {
    name: "페이지 없음 안내",
    description: "잘못된 주소로 방문했을 때 표시하는 안내",
    audience: "public",
    audienceLabel: "전체 공개",
    category: "other",
    categoryLabel: "시스템 안내",
    previewUrl: null,
  },
};

export const CMS_GLOBAL_PRESENTATION: Record<
  CmsGlobalKey,
  { name: string; description: string; affectedArea: string }
> = {
  siteIdentity: {
    name: "서비스 이름과 로고",
    description: "센터 이름과 로고 대체 문구를 관리합니다.",
    affectedArea: "전체 화면",
  },
  header: {
    name: "상단 메뉴",
    description: "주요 메뉴와 로그인·상담 버튼을 관리합니다.",
    affectedArea: "공개 화면 상단",
  },
  footer: {
    name: "하단 정보",
    description:
      "운영 주체, 정책과 제휴사·운영자 보조 로그인 링크를 관리합니다.",
    affectedArea: "공개 화면 하단",
  },
  support: {
    name: "고객지원 정보",
    description: "고객지원 안내와 상담 연결 버튼을 관리합니다.",
    affectedArea: "고객지원 화면과 공통 버튼",
  },
  defaultSeo: {
    name: "검색 노출 기본값",
    description: "개별 화면에 값이 없을 때 사용할 검색 제목과 설명입니다.",
    affectedArea: "검색 결과와 공유 정보",
  },
  theme: {
    name: "기본 디자인",
    description: "전체 화면의 색상, 글자 크기와 간격 기본값입니다.",
    affectedArea: "전체 공개 화면",
  },
  statusMessages: {
    name: "공통 상태 안내",
    description: "불러오는 중, 내용 없음과 오류 안내 문구입니다.",
    affectedArea: "여러 화면의 상태 안내",
  },
  adminPresentation: {
    name: "관리자 화면 안내",
    description: "관리자 화면의 공통 제목과 복구 안내입니다.",
    affectedArea: "관리자 콘솔",
  },
};

export function hasPageChanges(
  draft: CmsDraftPage | null,
  published: CmsPublishedPage | null,
) {
  if (!draft) return false;
  if (!published) return true;
  return (
    JSON.stringify({
      content: draft.content,
      theme: draft.theme ?? null,
    }) !==
    JSON.stringify({
      content: published.content,
      theme: published.theme ?? null,
    })
  );
}

export function hasGlobalChanges(
  draft: CmsDraftGlobal | null,
  published: CmsPublishedGlobal | null,
) {
  if (!draft) return false;
  if (!published) return true;
  return JSON.stringify(draft.content) !== JSON.stringify(published.content);
}

export const CMS_AUDIT_ACTION_LABELS: Record<string, string> = {
  "draft.created": "초안을 만들었습니다.",
  "draft.updated": "초안을 수정했습니다.",
  published: "게시했습니다.",
  "revision.restored": "이전 내용을 초안으로 복원했습니다.",
  "asset.created": "이미지·파일을 추가했습니다.",
  "asset.updated": "이미지·파일 정보를 수정했습니다.",
  "asset.archived": "이미지·파일을 보관 처리했습니다.",
};

export const CMS_DESIGN_LABELS = {
  palette: {
    default: "기본 파랑",
    calmBlue: "차분한 파랑",
    forest: "농협 초록",
    highContrast: "고대비",
  },
  textScale: {
    small: "작게",
    default: "기본",
    large: "크게",
  },
  spacing: {
    compact: "촘촘하게",
    default: "기본",
    relaxed: "여유롭게",
  },
  radius: {
    square: "각지게",
    default: "기본",
    rounded: "둥글게",
  },
  alignment: {
    left: "왼쪽 정렬",
    center: "가운데 정렬",
  },
} as const;
