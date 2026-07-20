import { isSafeCmsHref, cmsPageContentSchema, type CmsPageContent, type CmsSectionStyle } from "@/lib/cms/schemas";
import type { CmsPageKey } from "@/lib/cms/constants";
import {
  CMS_PAGE_DEFAULTS,
  CMS_PROTECTED_PAGE_ACTION_IDS,
  CMS_PROTECTED_PAGE_ITEM_IDS,
  CMS_REQUIRED_PAGE_SECTIONS,
} from "@/lib/cms/defaults";
import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_PAGE_FILTER_IDS,
} from "@/lib/cms/admin-console-content";

export type CmsEditorValidationIssue = {
  id: string;
  severity: "error" | "warning";
  code:
    | "required_text"
    | "invalid_link"
    | "missing_alt"
    | "heading_order"
    | "low_contrast"
    | "design_range"
    | "required_section"
    | "legal_copy_changed";
  message: string;
  sectionId?: string;
};

const COLOR_HEX = {
  text: "#172033",
  muted: "#667085",
  primary: "#2f6fed",
  white: "#ffffff",
  surface: "#ffffff",
  softBlue: "#edf4ff",
  softGray: "#f5f7fa",
  softGreen: "#eaf8f1",
  softYellow: "#fff4df",
} as const;

const COMPLETION_PAGE_KEYS = new Set<CmsPageKey>([
  "auth.login",
  "auth.signup",
  "auth.pendingApproval",
  "legal.terms",
  "legal.privacy",
  "public.consult",
  "public.inquiries",
  "public.faq",
  "public.support",
  "partner.portal",
  "framework.notFound",
]);

export function createDefaultSectionStyle(): CmsSectionStyle {
  return {
    title: {
      fontFamily: "pretendard",
      sizePreset: "default",
      fontWeight: "700",
      lineHeightPreset: "default",
      alignment: "left",
      color: "text",
    },
    body: {
      fontFamily: "pretendard",
      sizePreset: "default",
      fontWeight: "400",
      lineHeightPreset: "default",
      alignment: "left",
      color: "muted",
    },
    container: {
      background: "surface",
      spacing: "default",
      border: "none",
      radius: "default",
      shadow: "none",
    },
  };
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(
  foreground: keyof typeof COLOR_HEX,
  background: keyof typeof COLOR_HEX,
) {
  const foregroundLuminance = luminance(COLOR_HEX[foreground]);
  const backgroundLuminance = luminance(COLOR_HEX[background]);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function issueId(prefix: string, sectionId?: string, index?: number) {
  return [prefix, sectionId, index].filter((value) => value !== undefined).join("-");
}

export function validatePageContentForPublish(
  input: CmsPageContent,
  pageKey?: CmsPageKey,
): CmsEditorValidationIssue[] {
  const issues: CmsEditorValidationIssue[] = [];
  const schemaResult = cmsPageContentSchema.safeParse(input);
  if (!schemaResult.success) {
    for (const [index, issue] of schemaResult.error.issues.entries()) {
      const sectionIndex =
        issue.path[0] === "sections" && typeof issue.path[1] === "number"
          ? issue.path[1]
          : null;
      const sectionId =
        sectionIndex === null ? undefined : input.sections[sectionIndex]?.id;
      const path = issue.path.join(".");
      const code =
        path.includes("href")
          ? "invalid_link"
          : path.includes("alt")
            ? "missing_alt"
            : path.includes("style") || path.includes("custom")
              ? "design_range"
              : "required_text";
      issues.push({
        id: issueId(`schema-${index}`, sectionId),
        severity: "error",
        code,
        sectionId,
        message:
          code === "invalid_link"
            ? "연결 주소가 올바르지 않습니다."
            : code === "missing_alt"
              ? "이미지를 설명하는 문구를 입력해 주세요."
              : code === "design_range"
                ? "고급 디자인 값이 허용 범위를 벗어났습니다."
                : "필수 문구를 입력해 주세요.",
      });
    }
  }

  if (pageKey) {
    const requiredSections = CMS_REQUIRED_PAGE_SECTIONS[pageKey];
    for (const sectionId of requiredSections) {
      const section = input.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      if (!section || !section.visible || !section.locked) {
        issues.push({
          id: issueId("required-page-section", sectionId),
          severity: "error",
          code: "required_section",
          sectionId,
          message: "필수 기능 또는 법적 안내 영역은 삭제하거나 숨길 수 없습니다.",
        });
      }
    }
  }

  let previousHeadingLevel = 1;
  for (const [sectionIndex, section] of input.sections.entries()) {
    if (section.locked && !section.visible) {
      issues.push({
        id: issueId("required-section", section.id),
        severity: "error",
        code: "required_section",
        sectionId: section.id,
        message: "필수 영역은 숨길 수 없습니다.",
      });
    }
    if (!section.visible) continue;
    if (!section.title.trim()) {
      issues.push({
        id: issueId("section-title", section.id),
        severity: "error",
        code: "required_text",
        sectionId: section.id,
        message: "화면 영역의 제목을 입력해 주세요.",
      });
    }
    if (section.headingLevel > previousHeadingLevel + 1) {
      issues.push({
        id: issueId("heading", section.id),
        severity: "warning",
        code: "heading_order",
        sectionId: section.id,
        message: "제목 순서가 건너뛰었습니다. 큰 제목 다음 단계부터 사용해 주세요.",
      });
    }
    previousHeadingLevel = section.headingLevel;

    if (section.media && !section.media.deleted && !section.media.alt.trim()) {
      issues.push({
        id: issueId("alt", section.id),
        severity: "error",
        code: "missing_alt",
        sectionId: section.id,
        message: "이미지를 설명하는 문구를 입력해 주세요.",
      });
    }

    section.actions.forEach((action, actionIndex) => {
      if (!isSafeCmsHref(action.href)) {
        issues.push({
          id: issueId("link", section.id, actionIndex),
          severity: "error",
          code: "invalid_link",
          sectionId: section.id,
          message: `"${action.label || "버튼"}"의 연결 주소를 확인해 주세요.`,
        });
      }
    });

    const background = section.style.container.background;
    const titleContrast = contrastRatio(section.style.title.color, background);
    const bodyContrast = contrastRatio(section.style.body.color, background);
    if (titleContrast < 3) {
      issues.push({
        id: issueId("title-contrast", section.id),
        severity: "warning",
        code: "low_contrast",
        sectionId: section.id,
        message: "제목 색상과 배경색의 차이가 작아 읽기 어려울 수 있습니다.",
      });
    }
    if (bodyContrast < 4.5) {
      issues.push({
        id: issueId("body-contrast", section.id),
        severity: "warning",
        code: "low_contrast",
        sectionId: section.id,
        message: "본문 색상과 배경색의 차이가 작아 읽기 어려울 수 있습니다.",
      });
    }

    section.items.forEach((item, itemIndex) => {
      if (!item.deleted && item.visible && !item.title.trim()) {
        issues.push({
          id: issueId("item-title", section.id, itemIndex),
          severity: "error",
          code: "required_text",
          sectionId: section.id,
          message: "목록 항목의 제목을 입력해 주세요.",
        });
      }
    });

    if (sectionIndex === 0 && section.headingLevel !== 2) {
      issues.push({
        id: issueId("first-heading", section.id),
        severity: "warning",
        code: "heading_order",
        sectionId: section.id,
        message: "첫 화면 영역은 큰 제목 단계로 시작하는 것이 좋습니다.",
      });
    }
  }

  if (pageKey === "event.auditQuote") {
    const defaults = CMS_PAGE_DEFAULTS[pageKey];
    const defaultById = new Map(
      defaults.sections.map((section) => [section.id, section]),
    );
    const currentById = new Map(
      input.sections.map((section) => [section.id, section]),
    );
    for (const requiredId of ["intakeForm", "legalNotice"]) {
      const section = currentById.get(requiredId);
      if (!section || !section.visible || !section.locked) {
        issues.push({
          id: issueId("audit-required-section", requiredId),
          severity: "error",
          code: "required_section",
          sectionId: requiredId,
          message:
            requiredId === "intakeForm"
              ? "개인정보 필수 동의가 포함된 신청 영역은 삭제하거나 숨길 수 없습니다."
              : "운영 주체와 면책문구는 삭제하거나 숨길 수 없습니다.",
        });
      }
    }

    const intake = currentById.get("intakeForm");
    const defaultIntake = defaultById.get("intakeForm");
    const requiredIntakeFields = [
      "emailLabel",
      "nameLabel",
      "phoneLabel",
      "privacyConsentLabel",
      "privacyConsentLinkLabel",
      "marketingConsentLabel",
      "submitLabel",
      "freeNotice",
    ] as const;
    if (intake) {
      for (const key of requiredIntakeFields) {
        if (!intake.text[key]?.trim()) {
          issues.push({
            id: issueId(`audit-required-${key}`, intake.id),
            severity: "error",
            code: "required_text",
            sectionId: intake.id,
            message: "신청과 동의에 필요한 표시 문구를 비워 둘 수 없습니다.",
          });
        }
      }
      for (const key of [
        "privacyConsentLabel",
        "privacyConsentLinkLabel",
        "freeNotice",
      ] as const) {
        if (intake.text[key] !== defaultIntake?.text[key]) {
          issues.push({
            id: issueId(`audit-legal-change-${key}`, intake.id),
            severity: "warning",
            code: "legal_copy_changed",
            sectionId: intake.id,
            message:
              "개인정보 동의 또는 계약 의무 안내가 기본 문구와 다릅니다. 게시 이력에 변경 내용이 남습니다.",
          });
        }
      }
    }

    const legal = currentById.get("legalNotice");
    const defaultLegal = defaultById.get("legalNotice");
    if (
      legal &&
      (!legal.text.operatorName?.trim() || !legal.description?.trim())
    ) {
      issues.push({
        id: issueId("audit-required-legal-copy", legal.id),
        severity: "error",
        code: "required_text",
        sectionId: legal.id,
        message: "운영 주체와 면책문구를 비워 둘 수 없습니다.",
      });
    }
    if (
      legal &&
      (legal.text.operatorName !== defaultLegal?.text.operatorName ||
        legal.description !== defaultLegal?.description)
    ) {
      issues.push({
        id: issueId("audit-legal-copy-changed", legal.id),
        severity: "warning",
        code: "legal_copy_changed",
        sectionId: legal.id,
        message:
          "운영 주체 또는 면책문구가 기본 문구와 다릅니다. 법적 검토 후 게시해 주세요.",
      });
    }

    for (const key of Object.keys(defaults.messages)) {
      if (!input.messages[key]?.trim()) {
        issues.push({
          id: issueId(`audit-required-message-${key}`),
          severity: "error",
          code: "required_text",
          message: "견적 신청의 상태·오류 안내 문구를 비워 둘 수 없습니다.",
        });
      }
    }
  }

  if (pageKey === "legal.terms" || pageKey === "legal.privacy") {
    const defaults = CMS_PAGE_DEFAULTS[pageKey];
    for (const fallback of defaults.sections) {
      const current = input.sections.find(
        (section) => section.id === fallback.id,
      );
      if (
        current &&
        (!current.title.trim() || !current.description?.trim())
      ) {
        issues.push({
          id: issueId("legal-required-copy", fallback.id),
          severity: "error",
          code: "required_text",
          sectionId: fallback.id,
          message: "법적 안내의 제목과 본문을 비워 둘 수 없습니다.",
        });
      }
      if (
        current &&
        (current.title !== fallback.title ||
          current.description !== fallback.description ||
          JSON.stringify(current.text) !== JSON.stringify(fallback.text))
      ) {
        issues.push({
          id: issueId("legal-copy-changed", fallback.id),
          severity: "warning",
          code: "legal_copy_changed",
          sectionId: fallback.id,
          message:
            "법적 안내가 기본 문구와 다릅니다. 운영·법률 검토 후 게시해 주세요.",
        });
      }
    }
  }

  if (pageKey && COMPLETION_PAGE_KEYS.has(pageKey)) {
    const defaults = CMS_PAGE_DEFAULTS[pageKey];
    for (const defaultSection of defaults.sections) {
      const currentSection = input.sections.find(
        (candidate) => candidate.id === defaultSection.id,
      );
      if (!currentSection) continue;
      for (const [key, defaultValue] of Object.entries(defaultSection.text)) {
        if (defaultValue.trim() && !currentSection.text[key]?.trim()) {
          issues.push({
            id: issueId(`route-required-${key}`, defaultSection.id),
            severity: "error",
            code: "required_text",
            sectionId: defaultSection.id,
            message:
              "고객에게 표시되는 입력 이름, 도움말 또는 접근성 문구를 비워 둘 수 없습니다.",
          });
        }
      }
      for (const key of ["eyebrow", "description"] as const) {
        if (
          defaultSection[key]?.trim() &&
          !currentSection[key]?.trim()
        ) {
          issues.push({
            id: issueId(`route-required-${key}`, defaultSection.id),
            severity: "error",
            code: "required_text",
            sectionId: defaultSection.id,
            message:
              "고객이 화면의 목적과 상태를 이해하는 데 필요한 안내 문구를 입력해 주세요.",
          });
        }
      }
    }
    for (const [key, defaultValue] of Object.entries(defaults.messages)) {
      if (defaultValue.trim() && !input.messages[key]?.trim()) {
        issues.push({
          id: issueId(`route-required-message-${key}`),
          severity: "error",
          code: "required_text",
          message:
            "고객에게 표시되는 로딩, 성공, 오류 또는 권한 안내를 비워 둘 수 없습니다.",
        });
      }
    }
  }

  if (pageKey) {
    const protectedItems = CMS_PROTECTED_PAGE_ITEM_IDS[pageKey] ?? {};
    for (const [sectionId, itemIds] of Object.entries(protectedItems)) {
      const section = input.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      for (const [itemIndex, itemId] of itemIds.entries()) {
        const item = section?.items.find((candidate) => candidate.id === itemId);
        if (!item || item.deleted || !item.visible || !item.title.trim()) {
          issues.push({
            id: issueId("protected-option", sectionId, itemIndex),
            severity: "error",
            code: "required_text",
            sectionId,
            message:
              "저장값과 연결된 필수 선택지는 숨기거나 삭제하거나 내부 ID를 바꿀 수 없습니다. 화면 표시 이름만 변경해 주세요.",
          });
        }
      }
    }

    const protectedActions = CMS_PROTECTED_PAGE_ACTION_IDS[pageKey] ?? {};
    const defaults = CMS_PAGE_DEFAULTS[pageKey];
    for (const [sectionId, actionIds] of Object.entries(protectedActions)) {
      const section = input.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      const defaultSection = defaults.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      for (const [actionIndex, actionId] of actionIds.entries()) {
        const current = section?.actions.find(
          (candidate) => candidate.id === actionId,
        );
        const fallback = defaultSection?.actions.find(
          (candidate) => candidate.id === actionId,
        );
        if (
          !current ||
          !fallback ||
          current.href !== fallback.href ||
          current.linkType !== fallback.linkType
        ) {
          issues.push({
            id: issueId("protected-consent-link", sectionId, actionIndex),
            severity: "error",
            code: "invalid_link",
            sectionId,
            message:
              "필수 약관·개인정보 동의 링크의 내부 연결값은 삭제하거나 변경할 수 없습니다. 화면 표시 문구만 변경해 주세요.",
          });
        }
      }
    }
  }

  if (pageKey === "member.mypage" || pageKey === "member.requestDetail") {
    const defaults = CMS_PAGE_DEFAULTS[pageKey];
    for (const defaultSection of defaults.sections) {
      const currentSection = input.sections.find(
        (candidate) => candidate.id === defaultSection.id,
      );
      if (!currentSection) continue;

      for (const [key, defaultValue] of Object.entries(defaultSection.text)) {
        if (
          defaultValue.trim() &&
          !currentSection.text[key]?.trim()
        ) {
          issues.push({
            id: issueId(`member-required-${key}`, defaultSection.id),
            severity: "error",
            code: "required_text",
            sectionId: defaultSection.id,
            message:
              "회원 화면의 제목, 버튼, 상태 또는 도움말 문구를 비워 둘 수 없습니다.",
          });
        }
      }

      for (const key of ["eyebrow", "description"] as const) {
        if (
          defaultSection[key]?.trim() &&
          !currentSection[key]?.trim()
        ) {
          issues.push({
            id: issueId(`member-required-${key}`, defaultSection.id),
            severity: "error",
            code: "required_text",
            sectionId: defaultSection.id,
            message:
              "회원이 화면의 목적과 상태를 이해하는 데 필요한 안내 문구를 입력해 주세요.",
          });
        }
      }
    }

    for (const [key, defaultValue] of Object.entries(defaults.messages)) {
      if (defaultValue.trim() && !input.messages[key]?.trim()) {
        issues.push({
          id: issueId(`member-required-message-${key}`),
          severity: "error",
          code: "required_text",
          message:
            "회원에게 표시되는 로딩, 빈 화면, 권한, 성공 또는 오류 안내를 비워 둘 수 없습니다.",
        });
      }
    }
  }

  if (pageKey === "member.mypage") {
    const navigation = input.sections.find(
      (candidate) => candidate.id === "navigation",
    );
    for (const [itemIndex, itemId] of [
      "overview",
      "inquiries",
      "points",
      "profile",
    ].entries()) {
      const protectedTab = navigation?.items.find(
        (candidate) => candidate.id === itemId,
      );
      if (
        !protectedTab ||
        protectedTab.deleted ||
        !protectedTab.visible ||
        !protectedTab.title.trim()
      ) {
        issues.push({
          id: issueId("member-protected-tab", "navigation", itemIndex),
          severity: "error",
          code: "required_text",
          sectionId: "navigation",
          message:
            "회원 기능과 연결된 필수 메뉴는 숨기거나 삭제할 수 없습니다. 화면 표시 이름과 설명만 변경해 주세요.",
        });
      }
    }
  }

  if (pageKey === "admin.operations") {
    const protectedItems: Record<string, readonly string[]> = {
      navigation: [
        "overview",
        "members",
        "inquiries",
        "auditQuotes",
        "points",
        "audit",
      ],
      members: ["members", "operators"],
      inquiries: [
        "requests",
        "faq",
        "visibility.all",
        "visibility.public",
        "visibility.organization",
        "visibility.private",
        "requestStatus.all",
        "requestStatus.submitted",
        "requestStatus.answered",
        "requestStatus.published",
        "requestStatus.followup",
        "requestStatus.completed",
        "faqPublic.all",
        "faqPublic.public",
        "faqPublic.private",
        "faqDisplay.all",
        "faqDisplay.published",
        "faqDisplay.draft",
        "faqCategory.general",
        "faqCategory.signup",
        "faqCategory.inquiry",
        "faqCategory.points",
        "faqCategory.settlement",
        "faqCategory.other",
      ],
      auditQuotes: [
        "status.all",
        "status.received",
        "status.contacting",
        "status.qualified",
        "status.infoComplete",
        "status.quotesRequested",
        "status.delivered",
        "status.reportDelivered",
        "status.closed",
        "status.invalid",
      ],
      points: [
        "ledger.firstOrgSignup",
        "ledger.userSignup",
        "ledger.answerView",
        "ledger.questionAnswerUsage",
        "ledger.manualAdjustment",
        "ledger.adminCredit",
        "ledger.adminDebit",
      ],
    };
    for (const [sectionId, itemIds] of Object.entries(protectedItems)) {
      const section = input.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      for (const [itemIndex, itemId] of itemIds.entries()) {
        const protectedItem = section?.items.find(
          (candidate) => candidate.id === itemId,
        );
        if (
          !protectedItem ||
          protectedItem.deleted ||
          !protectedItem.visible ||
          !protectedItem.title.trim()
        ) {
          issues.push({
            id: issueId("admin-protected-option", sectionId, itemIndex),
            severity: "error",
            code: "required_text",
            sectionId,
            message:
              "관리 기능과 연결된 필수 메뉴·선택지는 숨기거나 삭제할 수 없습니다. 화면 표시 이름만 변경해 주세요.",
          });
        }
      }
    }
  }

  if (pageKey === "admin.console") {
    const protectedItems: Record<string, readonly string[]> = {
      navigation: ADMIN_CONSOLE_MENU_IDS,
      pages: ADMIN_CONSOLE_PAGE_FILTER_IDS,
    };
    for (const [sectionId, itemIds] of Object.entries(protectedItems)) {
      const section = input.sections.find(
        (candidate) => candidate.id === sectionId,
      );
      for (const [itemIndex, itemId] of itemIds.entries()) {
        const protectedItem = section?.items.find(
          (candidate) => candidate.id === itemId,
        );
        if (
          !protectedItem ||
          protectedItem.deleted ||
          !protectedItem.visible ||
          !protectedItem.title.trim()
        ) {
          issues.push({
            id: issueId("admin-console-protected-option", sectionId, itemIndex),
            severity: "error",
            code: "required_text",
            sectionId,
            message:
              "관리 화면과 연결된 필수 메뉴·필터는 숨기거나 삭제할 수 없습니다. 화면 표시 이름만 변경해 주세요.",
          });
        }
      }
    }
  }

  return [...new Map(issues.map((issue) => [issue.id, issue])).values()];
}

export function normalizePageContentForPublish(
  input: CmsPageContent,
): CmsPageContent {
  const parsed = cmsPageContentSchema.parse(input);
  return {
    ...parsed,
    sections: parsed.sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.deleted),
      groups: section.groups.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.deleted),
      })),
    })),
  };
}
