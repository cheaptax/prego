import {
  CMS_PAGE_DEFAULTS,
  CMS_PROTECTED_PAGE_ACTION_IDS,
  CMS_PROTECTED_PAGE_ITEM_IDS,
  CMS_REMOVED_PAGE_ACTION_IDS,
} from "@/lib/cms/defaults";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

/** Replace known stale CMS copy so published docs pick up product wording fixes. */
const STALE_SECTION_TEXT: ReadonlyArray<{
  from: string;
  to: string;
}> = [
  {
    from: "예: 과장, 팀장",
    to: "사원, 대리, 과장, 팀장, 차장 ...",
  },
  {
    from: "제휴사 및 운영자 로그인",
    to: "고객 · 제휴사 · 운영자 로그인",
  },
  {
    from: "무료 신청 · 비교 후에도 계약 의무 없음",
    to: "무료 신청, 비교보고서로 한눈에 회계법인 비교평가",
  },
  {
    from: "무료 신청, 계약 의무 없음",
    to: "무료 신청, 비교보고서로 한눈에 회계법인 비교평가",
  },
  {
    from: "무료로 견적을 받아보신 후 내부에서 충분히 검토하셔도 됩니다. 비교 후에도 계약 의무는 없습니다.",
    to: "손쉽게 견적만 미리 받아두시면 필요할 때 언제든 바로 꺼내보실 수 있습니다.",
  },
  {
    from: "무료 신청 후 여러 견적을 비교해도 계약 의무는 없습니다.",
    to: "손쉽게 견적만 미리 받아두시면 필요할 때 언제든 바로 꺼내보실 수 있습니다.",
  },
];

function refreshStalePlainText(value?: string) {
  if (!value) return value;
  return STALE_SECTION_TEXT.find((entry) => entry.from === value)?.to ?? value;
}

function refreshStaleSectionText(
  text: CmsSection["text"],
  fallbackText: CmsSection["text"],
) {
  const next = { ...text };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== "string") continue;
    const replacement = STALE_SECTION_TEXT.find((entry) => entry.from === value);
    if (!replacement) continue;
    next[key] =
      typeof fallbackText[key] === "string"
        ? fallbackText[key]
        : replacement.to;
  }
  return next;
}

export function normalizeCmsPageContent(
  pageKey: CmsPageKey,
  input: CmsPageContent,
): CmsPageContent {
  const defaults = CMS_PAGE_DEFAULTS[pageKey];
  const defaultById = new Map(
    defaults.sections.map((section) => [section.id, section]),
  );
  const seenIds = new Set<string>();

  const sections = input.sections.map((current): CmsSection => {
    seenIds.add(current.id);
    const fallback = defaultById.get(current.id);
    if (!fallback) return current;
    const protectedItemIds =
      CMS_PROTECTED_PAGE_ITEM_IDS[pageKey]?.[current.id] ?? [];
    const protectedActionIds =
      CMS_PROTECTED_PAGE_ACTION_IDS[pageKey]?.[current.id] ?? [];
    const removedActionIds = new Set(
      CMS_REMOVED_PAGE_ACTION_IDS[pageKey]?.[current.id] ?? [],
    );
    const currentItems = new Map(current.items.map((item) => [item.id, item]));
    const currentActions = new Map(
      current.actions.map((action) => [action.id, action]),
    );
    const items: CmsSection["items"] = current.items.map((item) => {
      const nextItem = {
        ...item,
        title: refreshStalePlainText(item.title) ?? item.title,
        description: refreshStalePlainText(item.description) ?? item.description,
      };
      if (!protectedItemIds.includes(item.id)) return nextItem;
      return { ...nextItem, visible: true, deleted: false };
    });
    const actions = current.actions
      .filter((action) => !removedActionIds.has(action.id))
      .map((action) => {
        if (!protectedActionIds.includes(action.id)) return action;
        const protectedAction = fallback.actions.find(
          (candidate) => candidate.id === action.id,
        );
        return protectedAction
          ? {
              ...action,
              id: protectedAction.id,
              href: protectedAction.href,
              linkType: protectedAction.linkType,
            }
          : action;
      });
    for (const protectedId of protectedItemIds) {
      if (currentItems.has(protectedId)) continue;
      const protectedItem = fallback.items.find(
        (item) => item.id === protectedId,
      );
      if (protectedItem) items.push(structuredClone(protectedItem));
    }
    if (protectedItemIds.length > 0 && fallback.items.length > 0) {
      const fallbackOrder = fallback.items.map((item) => item.id);
      items.sort((left, right) => {
        const leftIndex = fallbackOrder.indexOf(left.id);
        const rightIndex = fallbackOrder.indexOf(right.id);
        const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const rightRank =
          rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
        return leftRank - rightRank;
      });
    }
    for (const protectedId of protectedActionIds) {
      if (currentActions.has(protectedId) && !removedActionIds.has(protectedId)) {
        continue;
      }
      if (actions.some((action) => action.id === protectedId)) continue;
      const protectedAction = fallback.actions.find(
        (action) => action.id === protectedId,
      );
      if (protectedAction) actions.push(structuredClone(protectedAction));
    }
    return {
      ...fallback,
      ...current,
      visible: fallback.locked ? true : current.visible,
      locked: fallback.locked ? true : current.locked,
      deleted: fallback.locked ? false : Boolean(current.deleted),
      title: refreshStalePlainText(current.title) ?? current.title,
      description: refreshStalePlainText(current.description),
      text: refreshStaleSectionText(
        { ...fallback.text, ...current.text },
        fallback.text,
      ),
      items,
      actions,
      style: {
        ...fallback.style,
        ...current.style,
        title: { ...fallback.style.title, ...current.style.title },
        body: { ...fallback.style.body, ...current.style.body },
        container: {
          ...fallback.style.container,
          ...current.style.container,
        },
      },
    };
  });

  for (const fallback of defaults.sections) {
    if (!seenIds.has(fallback.id)) sections.push(structuredClone(fallback));
  }

  return {
    ...input,
    seo: { ...defaults.seo, ...input.seo },
    sections,
    messages: { ...defaults.messages, ...input.messages },
  };
}
