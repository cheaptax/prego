"use client";

import { useState, type DragEvent } from "react";
import type { CmsPageContent } from "@/lib/cms/schemas";
import type { CmsPageKey } from "@/lib/cms/constants";
import { CMS_AUDIT_QUOTE_SECTION_PRESENTATION } from "@/lib/cms/audit-quote-presentation";
import { CMS_HOME_SECTION_PRESENTATION } from "@/lib/cms/home-presentation";
import { CMS_ROUTE_SECTION_PRESENTATION } from "@/lib/cms/route-presentation";

export function CmsEditorSidebar({
  pageName,
  pageKey,
  content,
  selection,
  onSelect,
  onReorderSections,
}: {
  pageName: string;
  pageKey: CmsPageKey;
  content: CmsPageContent;
  selection: string;
  onSelect: (selection: string) => void;
  onReorderSections: (from: number, to: number) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dropSection = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (draggedIndex !== null) onReorderSections(draggedIndex, index);
    setDraggedIndex(null);
  };
  return (
    <aside className="cms-editor-sidebar" aria-label="페이지 영역 목록">
      <header>
        <span>편집 중인 화면</span>
        <h2>{pageName}</h2>
      </header>
      <nav aria-label="화면 전체 설정">
        <button
          className={selection === "page" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelect("page")}
          aria-current={selection === "page" ? "page" : undefined}
        >
          <i aria-hidden="true">◎</i>
          <span>
            <strong>화면 전체 설정</strong>
            <small>검색과 공유 정보</small>
          </span>
        </button>
        <button
          className={selection === "messages" ? "is-selected" : ""}
          type="button"
          onClick={() => onSelect("messages")}
          aria-current={selection === "messages" ? "page" : undefined}
        >
          <i aria-hidden="true">i</i>
          <span>
            <strong>화면 안내 문구</strong>
            <small>상태와 도움말</small>
          </span>
        </button>
      </nav>
      <div className="cms-editor-sidebar__heading">
        <div>
          <strong>화면 영역</strong>
          <small>끌어서 순서 변경</small>
        </div>
        <span>{content.sections.length}개</span>
      </div>
      <ol className="cms-editor-section-tree">
        {content.sections.map((section, index) => (
          <li
            className={[
              selection === section.id ? "is-selected" : "",
              !section.visible ? "is-hidden" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={section.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropSection(event, index)}
          >
            <button
              className="cms-editor-section-tree__drag"
              type="button"
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragEnd={() => setDraggedIndex(null)}
              aria-label={`${section.title} 영역 순서 끌어서 바꾸기`}
              title="끌어서 순서를 바꿉니다."
            >
              ⠿
            </button>
            <button
              className="cms-editor-section-tree__select"
              type="button"
              onClick={() => onSelect(section.id)}
            >
              <span>{index + 1}</span>
              <div>
                <strong>
                  {pageKey === "home"
                    ? CMS_HOME_SECTION_PRESENTATION[section.id]?.name ??
                      section.title
                    : pageKey === "event.auditQuote"
                      ? CMS_AUDIT_QUOTE_SECTION_PRESENTATION[section.id]?.name ??
                        section.title
                    : (CMS_ROUTE_SECTION_PRESENTATION[pageKey]?.[section.id]
                        ?.name ?? section.title) || "제목 없는 영역"}
                </strong>
                <small>
                  {section.visible ? "화면에 표시" : "현재 숨김"}
                  {section.items.length > 0
                    ? ` · 목록 ${section.items.length}개`
                    : ""}
                </small>
              </div>
            </button>
            <span className="cms-editor-section-tree__move">
              <button
                type="button"
                onClick={() => onReorderSections(index, index - 1)}
                disabled={index === 0}
                aria-label={`${section.title} 영역 위로 이동`}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => onReorderSections(index, index + 1)}
                disabled={index === content.sections.length - 1}
                aria-label={`${section.title} 영역 아래로 이동`}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="cms-editor-sidebar__help">
        필수 영역은 숨길 수 없습니다. 영역을 선택하면 오른쪽에서 문구와 디자인을
        바꿀 수 있습니다.
      </p>
    </aside>
  );
}
