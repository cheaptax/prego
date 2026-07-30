import type {
  FocusEvent,
  HTMLAttributes,
  KeyboardEvent,
  MouseEvent,
} from "react";
import type { CmsSection } from "@/lib/cms/schemas";
import { cmsSectionRootProps } from "@/lib/cms/style-runtime";

export type CmsSectionEditingOptions = {
  editing?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
};

export type CmsEditableSectionAttributes = HTMLAttributes<HTMLElement> & {
  "data-cms-section-id": string;
  "data-cms-editable-section"?: "true";
};

function selectOnClick(
  event: MouseEvent<HTMLElement>,
  sectionId: string,
  onSelectSection?: (sectionId: string) => void,
) {
  event.stopPropagation();
  onSelectSection?.(sectionId);
}

function selectOnFocus(
  event: FocusEvent<HTMLElement>,
  sectionId: string,
  onSelectSection?: (sectionId: string) => void,
) {
  event.stopPropagation();
  onSelectSection?.(sectionId);
}

function selectOnKeyboard(
  event: KeyboardEvent<HTMLElement>,
  sectionId: string,
  onSelectSection?: (sectionId: string) => void,
) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  onSelectSection?.(sectionId);
}

export function cmsEditableSectionProps(
  section: CmsSection,
  className: string,
  options: CmsSectionEditingOptions = {},
): CmsEditableSectionAttributes {
  const root = cmsSectionRootProps(section, className);
  return {
    ...root,
    ...cmsSectionSelectionProps(section, root.className, options),
  };
}

export function cmsSectionSelectionProps(
  section: CmsSection,
  className: string,
  options: CmsSectionEditingOptions = {},
): CmsEditableSectionAttributes {
  const editing = options.editing === true;
  return {
    className: [
      className,
      editing ? "cms-home-edit-section" : "",
      editing && options.selectedSectionId === section.id ? "is-selected" : "",
      editing && (!section.visible || section.deleted) ? "is-hidden" : "",
    ]
      .filter(Boolean)
      .join(" "),
    "data-cms-section-id": section.id,
    "data-cms-editable-section": editing ? "true" : undefined,
    tabIndex: editing ? 0 : undefined,
    role: editing ? "group" : undefined,
    "aria-label": editing
      ? `${section.title || "제목 없는"} 영역 편집 설정 열기`
      : undefined,
    onClick: editing
      ? (event) =>
          selectOnClick(event, section.id, options.onSelectSection)
      : undefined,
    onFocus: editing
      ? (event) =>
          selectOnFocus(event, section.id, options.onSelectSection)
      : undefined,
    onKeyDown: editing
      ? (event) =>
          selectOnKeyboard(event, section.id, options.onSelectSection)
      : undefined,
  };
}
