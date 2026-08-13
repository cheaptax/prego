"use client";

import { useState, type DragEvent } from "react";
import type { CmsPageContent } from "@/lib/cms/schemas";
import type { CmsPageKey } from "@/lib/cms/constants";
import { CMS_AUDIT_QUOTE_SECTION_PRESENTATION } from "@/lib/cms/audit-quote-presentation";
import { CMS_HOME_SECTION_PRESENTATION } from "@/lib/cms/home-presentation";
import { CMS_ROUTE_SECTION_PRESENTATION } from "@/lib/cms/route-presentation";
import { canSoftDeleteCmsSection } from "@/lib/cms/section-lifecycle";

function sectionDisplayName(pageKey: CmsPageKey, sectionId: string, title: string) {
  if (pageKey === "home") {
    return CMS_HOME_SECTION_PRESENTATION[sectionId]?.name ?? title;
  }
  if (pageKey === "event.auditQuote") {
    return CMS_AUDIT_QUOTE_SECTION_PRESENTATION[sectionId]?.name ?? title;
  }
  return (
    CMS_ROUTE_SECTION_PRESENTATION[pageKey]?.[sectionId]?.name ?? title
  ) || "제목 없는 영역";
}

export function CmsEditorSidebar({
  pageName,
  pageKey,
  content,
  selection,
  onSelect,
  onReorderSections,
  onAddSection,
  onDuplicateSection,
  onRequestDeleteSection,
  onRestoreSection,
}: {
  pageName: string;
  pageKey: CmsPageKey;
  content: CmsPageContent;
  selection: string;
  onSelect: (selection: string) => void;
  onReorderSections: (from: number, to: number) => void;
  onAddSection: () => void;
  onDuplicateSection: (sectionId: string) => void;
  onRequestDeleteSection: (sectionId: string) => void;
  onRestoreSection: (sectionId: string) => void;
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const activeCount = content.sections.filter((section) => !section.deleted).length;
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
          <small>추가·삭제·순서 변경</small>
        </div>
        <span>{activeCount}개</span>
      </div>
      <div className="cms-editor-sidebar__section-actions">
        <button type="button" onClick={onAddSection}>
          영역 추가
        </button>
      </div>
      <ol className="cms-editor-section-tree">
        {content.sections.map((section, index) => {
          const name = sectionDisplayName(pageKey, section.id, section.title);
          const canDelete = canSoftDeleteCmsSection(content, section.id);
          return (
            <li
              className={[
                selection === section.id ? "is-selected" : "",
                !section.visible ? "is-hidden" : "",
                section.deleted ? "is-deleted" : "",
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
                draggable={!section.deleted}
                onDragStart={() => setDraggedIndex(index)}
                onDragEnd={() => setDraggedIndex(null)}
                aria-label={`${name} 영역 순서 끌어서 바꾸기`}
                title="끌어서 순서를 바꿉니다."
                disabled={section.deleted}
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
                  <strong>{name}</strong>
                  <small>
                    {section.deleted
                      ? "삭제됨 · 복원 가능"
                      : section.visible
                        ? "화면에 표시"
                        : "현재 숨김"}
                    {section.locked ? " · 필수" : ""}
                    {!section.deleted && section.items.length > 0
                      ? ` · 목록 ${section.items.length}개`
                      : ""}
                  </small>
                </div>
              </button>
              <span
                className={[
                  "cms-editor-section-tree__move",
                  section.deleted ? "is-restore" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {section.deleted ? (
                  <button
                    type="button"
                    onClick={() => onRestoreSection(section.id)}
                    aria-label={`${name} 영역 복원`}
                    title="영역 복원"
                  >
                    ↩
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onReorderSections(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`${name} 영역 위로 이동`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => onReorderSections(index, index + 1)}
                      disabled={index === content.sections.length - 1}
                      aria-label={`${name} 영역 아래로 이동`}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateSection(section.id)}
                      aria-label={`${name} 영역 복제`}
                      title="영역 복제"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="is-delete"
                      onClick={() => onRequestDeleteSection(section.id)}
                      disabled={!canDelete}
                      aria-label={
                        section.locked
                          ? `${name} 필수 영역은 삭제할 수 없습니다`
                          : `${name} 영역 삭제`
                      }
                      title={
                        section.locked
                          ? "필수 영역은 삭제할 수 없습니다"
                          : "영역 삭제하고 보관"
                      }
                    >
                      ×
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="cms-editor-sidebar__help">
        필수 영역은 삭제하거나 숨길 수 없습니다. 삭제한 영역은 게시 전까지
        복원할 수 있으며, 영역을 선택하면 오른쪽에서 문구와 디자인을 바꿀 수
        있습니다.
      </p>
    </aside>
  );
}
