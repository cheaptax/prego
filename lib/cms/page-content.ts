import {
  CMS_PAGE_DEFAULTS,
  CMS_PROTECTED_PAGE_ACTION_IDS,
  CMS_PROTECTED_PAGE_ITEM_IDS,
  CMS_REMOVED_PAGE_ACTION_IDS,
} from "@/lib/cms/defaults";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";

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
    const items = current.items.map((item) => {
      if (!protectedItemIds.includes(item.id)) return item;
      return { ...item, visible: true, deleted: false };
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
      text: { ...fallback.text, ...current.text },
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
