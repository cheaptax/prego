"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import {
  CMS_COLOR_TOKENS,
  CMS_PAGE_ROUTES,
  type CmsPageKey,
} from "@/lib/cms/constants";
import { CMS_PAGE_PRESENTATION } from "@/lib/cms/admin-console-presentation";
import {
  CMS_PROTECTED_PAGE_ACTION_IDS,
  CMS_PROTECTED_PAGE_ITEM_IDS,
} from "@/lib/cms/defaults";
import { createDefaultSectionStyle } from "@/lib/cms/editor-validation";
import { getCmsFeatureDefinition } from "@/lib/cms/feature-registry";
import type { CmsHomeSectionPresentation } from "@/lib/cms/home-presentation";
import type {
  CmsContentItem,
  CmsLink,
  CmsPageContent,
  CmsSection,
  CmsTypographyStyle,
} from "@/lib/cms/schemas";
import type { CmsPreviewDevice } from "@/components/cms-editor/CmsPageRenderer";
import { CmsEditorDialog } from "@/components/cms-editor/CmsEditorDialog";

type EditorSelection = "page" | "messages" | string;

function sectionPresentation(pageKey: CmsPageKey, sectionId: string) {
  return getCmsFeatureDefinition(pageKey).editorSchema.sections[sectionId];
}

const COLOR_LABELS = {
  text: "진한 글자",
  muted: "차분한 글자",
  primary: "대표 파랑",
  white: "흰색",
  surface: "흰 배경",
  softBlue: "연한 파랑",
  softGray: "연한 회색",
  softGreen: "연한 초록",
  softYellow: "연한 노랑",
} as const;

const COLOR_VALUES = {
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

const DEVICE_LABELS = {
  desktop: "PC",
  tablet: "태블릿",
  mobile: "모바일",
} as const;

const INTERNAL_PAGES = (Object.keys(CMS_PAGE_ROUTES) as CmsPageKey[]).filter(
  (pageKey) => !CMS_PAGE_ROUTES[pageKey].includes("["),
);
const HOME_ANCHOR_OPTIONS = [
  { href: "#about", label: "현재 화면의 센터 소개" },
  { href: "#expertise", label: "현재 화면의 전문성" },
  { href: "#services", label: "현재 화면의 지원 분야" },
  { href: "#process", label: "현재 화면의 상담 흐름" },
  { href: "#faq", label: "현재 화면의 자주 묻는 질문" },
] as const;

function createStableId(prefix: "item" | "link") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <label className="cms-editor-field">
      <span>{label}</span>
      <small>{help}</small>
      {children}
    </label>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: (typeof CMS_COLOR_TOKENS)[number];
  onChange: (value: (typeof CMS_COLOR_TOKENS)[number]) => void;
}) {
  return (
    <fieldset className="cms-editor-color-picker">
      <legend>{label}</legend>
      <div>
        {CMS_COLOR_TOKENS.map((color) => (
          <button
            type="button"
            className={value === color ? "is-selected" : ""}
            key={color}
            onClick={() => onChange(color)}
            aria-pressed={value === color}
            title={COLOR_LABELS[color]}
          >
            <i style={{ background: COLOR_VALUES[color] }} aria-hidden="true" />
            <span>{COLOR_LABELS[color]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function responsiveValue(
  value: { desktop: number; tablet?: number; mobile?: number } | undefined,
  device: CmsPreviewDevice,
  fallback: number,
) {
  if (!value) return fallback;
  if (device === "mobile") return value.mobile ?? value.tablet ?? value.desktop;
  if (device === "tablet") return value.tablet ?? value.desktop;
  return value.desktop;
}

function setResponsiveValue(
  current: { desktop: number; tablet?: number; mobile?: number } | undefined,
  device: CmsPreviewDevice,
  value: number,
  fallback: number,
) {
  const next = current ?? { desktop: fallback };
  return { ...next, [device]: value };
}

function TypographySettings({
  label,
  value,
  device,
  onChange,
}: {
  label: string;
  value: CmsTypographyStyle;
  device: CmsPreviewDevice;
  onChange: (value: CmsTypographyStyle) => void;
}) {
  return (
    <section className="cms-editor-settings-group">
      <h3>{label}</h3>
      <Field
        label="글자 크기"
        help={`${DEVICE_LABELS[device]} 화면에서 보이는 크기입니다.`}
      >
        <select
          value={value.sizePreset}
          onChange={(event) =>
            onChange({
              ...value,
              sizePreset: event.target.value as CmsTypographyStyle["sizePreset"],
            })
          }
        >
          <option value="small">작게</option>
          <option value="default">기본</option>
          <option value="large">크게</option>
        </select>
      </Field>
      <Field label="글꼴" help="승인된 글꼴 중에서 선택합니다.">
        <select
          value={value.fontFamily}
          onChange={(event) =>
            onChange({
              ...value,
              fontFamily: event.target.value as CmsTypographyStyle["fontFamily"],
            })
          }
        >
          <option value="pretendard">기본 고딕</option>
          <option value="system">시스템 고딕</option>
          <option value="serif">명조</option>
        </select>
      </Field>
      <Field label="글자 굵기" help="제목이나 본문을 얼마나 진하게 보일지 정합니다.">
        <select
          value={value.fontWeight}
          onChange={(event) =>
            onChange({
              ...value,
              fontWeight: event.target.value as CmsTypographyStyle["fontWeight"],
            })
          }
        >
          <option value="400">보통</option>
          <option value="500">조금 굵게</option>
          <option value="600">굵게</option>
          <option value="700">아주 굵게</option>
          <option value="800">가장 굵게</option>
        </select>
      </Field>
      <Field label="줄 간격" help="여러 줄 문구 사이의 간격입니다.">
        <select
          value={value.lineHeightPreset}
          onChange={(event) =>
            onChange({
              ...value,
              lineHeightPreset:
                event.target.value as CmsTypographyStyle["lineHeightPreset"],
            })
          }
        >
          <option value="compact">좁게</option>
          <option value="default">기본</option>
          <option value="relaxed">넓게</option>
        </select>
      </Field>
      <Field label="정렬" help="문구가 놓이는 방향입니다.">
        <select
          value={value.alignment}
          onChange={(event) =>
            onChange({
              ...value,
              alignment: event.target.value as CmsTypographyStyle["alignment"],
            })
          }
        >
          <option value="left">왼쪽</option>
          <option value="center">가운데</option>
          <option value="right">오른쪽</option>
        </select>
      </Field>
      <ColorPicker
        label="글자 색상"
        value={value.color}
        onChange={(color) => onChange({ ...value, color })}
      />
      <details className="cms-editor-advanced">
        <summary>고급 글자 설정</summary>
        <Field
          label={`${DEVICE_LABELS[device]} 상세 글자 크기`}
          help="12px부터 80px까지 입력할 수 있습니다."
        >
          <input
            type="number"
            min={12}
            max={80}
            value={responsiveValue(value.customSizePx, device, 34)}
            onChange={(event) =>
              onChange({
                ...value,
                customSizePx: setResponsiveValue(
                  value.customSizePx,
                  device,
                  Number(event.target.value),
                  34,
                ),
              })
            }
          />
        </Field>
        <button
          className="cms-editor-text-button"
          type="button"
          onClick={() => onChange({ ...value, customSizePx: undefined })}
        >
          글자 크기 프리셋으로 되돌리기
        </button>
        <Field
          label={`${DEVICE_LABELS[device]} 상세 줄 간격`}
          help="1.0부터 2.0까지 입력할 수 있습니다."
        >
          <input
            type="number"
            min={1}
            max={2}
            step={0.05}
            value={responsiveValue(value.customLineHeight, device, 1.55)}
            onChange={(event) =>
              onChange({
                ...value,
                customLineHeight: setResponsiveValue(
                  value.customLineHeight,
                  device,
                  Number(event.target.value),
                  1.55,
                ),
              })
            }
          />
        </Field>
        <button
          className="cms-editor-text-button"
          type="button"
          onClick={() => onChange({ ...value, customLineHeight: undefined })}
        >
          줄 간격 프리셋으로 되돌리기
        </button>
      </details>
    </section>
  );
}

function ItemsEditor({
  section,
  onChange,
  fields,
  protectedIds = [],
}: {
  section: CmsSection;
  onChange: (section: CmsSection) => void;
  fields?: CmsHomeSectionPresentation["itemFields"];
  protectedIds?: readonly string[];
}) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const updateItem = (index: number, next: CmsContentItem) => {
    const items = [...section.items];
    items[index] = next;
    onChange({ ...section, items });
  };
  const moveItem = (from: number, to: number) => {
    if (from === to || to < 0 || to >= section.items.length) return;
    const items = [...section.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    onChange({ ...section, items });
  };
  const dropItem = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (draggedIndex !== null) moveItem(draggedIndex, index);
    setDraggedIndex(null);
  };
  return (
    <section className="cms-editor-settings-group">
      <div className="cms-editor-settings-heading">
        <div>
          <h3>목록 항목</h3>
          <p>카드, 단계, 질문처럼 반복해서 보이는 내용입니다.</p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...section,
              items: [
                ...section.items,
                {
                  id: createStableId("item"),
                  title: "새 항목",
                  description: "",
                  visible: true,
                  deleted: false,
                },
              ],
            })
          }
        >
          항목 추가
        </button>
      </div>
      <div className="cms-editor-repeat-list">
        {section.items.map((item, index) => {
          const isProtected = protectedIds.includes(item.id);
          return (
          <article
            className={item.deleted ? "is-deleted" : ""}
            key={item.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropItem(event, index)}
          >
            <header>
              <button
                type="button"
                draggable={!item.deleted}
                onDragStart={() => setDraggedIndex(index)}
                onDragEnd={() => setDraggedIndex(null)}
                aria-label={`${item.title} 순서 끌어서 바꾸기`}
                title="끌어서 순서를 바꿉니다."
              >
                ↕
              </button>
              <strong>{item.deleted ? "삭제한 항목" : `항목 ${index + 1}`}</strong>
              <span>
                <button
                  type="button"
                  onClick={() => moveItem(index, index - 1)}
                  disabled={index === 0 || item.deleted}
                  aria-label="위로 이동"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(index, index + 1)}
                  disabled={index === section.items.length - 1 || item.deleted}
                  aria-label="아래로 이동"
                >
                  ↓
                </button>
              </span>
            </header>
            {item.deleted ? (
              <button
                className="cms-editor-restore"
                type="button"
                onClick={() => updateItem(index, { ...item, deleted: false })}
              >
                이 항목 복원
              </button>
            ) : (
              <>
                {fields?.label ? (
                  <Field
                    label={fields.label}
                    help="항목 위나 옆에 짧게 표시됩니다."
                  >
                    <input
                      value={item.label ?? ""}
                      onChange={(event) =>
                        updateItem(index, {
                          ...item,
                          label: event.target.value,
                        })
                      }
                    />
                  </Field>
                ) : null}
                <Field
                  label={fields?.title ?? "항목 제목"}
                  help="각 카드나 질문의 첫 줄에 표시됩니다."
                >
                  <input
                    value={item.title}
                    onChange={(event) =>
                      updateItem(index, { ...item, title: event.target.value })
                    }
                  />
                </Field>
                {fields?.description !== undefined || !fields ? (
                <Field
                  label={fields?.description ?? "항목 설명"}
                  help="항목 제목 아래에 표시됩니다."
                >
                  <textarea
                    rows={3}
                    value={item.description ?? ""}
                    onChange={(event) =>
                      updateItem(index, {
                        ...item,
                        description: event.target.value,
                      })
                    }
                  />
                </Field>
                ) : null}
                {fields?.value ? (
                  <Field
                    label={fields.value}
                    help="카드에서 강조해 보여 주는 짧은 문구입니다."
                  >
                    <input
                      value={item.value ?? ""}
                      onChange={(event) =>
                        updateItem(index, {
                          ...item,
                          value: event.target.value,
                        })
                      }
                    />
                  </Field>
                ) : null}
                <label className="cms-editor-check">
                  <input
                    type="checkbox"
                    checked={item.visible}
                    disabled={isProtected}
                    onChange={(event) =>
                      updateItem(index, {
                        ...item,
                        visible: event.target.checked,
                      })
                    }
                  />
                  이 항목 표시
                </label>
                {isProtected ? (
                  <p className="cms-editor-help">
                    기능과 연결된 필수 선택지입니다. 표시 이름만 변경할 수 있습니다.
                  </p>
                ) : null}
                <footer>
                  <button
                    type="button"
                    onClick={() => {
                      const items = [...section.items];
                      items.splice(index + 1, 0, {
                        ...item,
                        id: createStableId("item"),
                        title: `${item.title} 복사본`,
                      });
                      onChange({ ...section, items });
                    }}
                  >
                    복제
                  </button>
                  <button
                    type="button"
                    disabled={isProtected}
                    onClick={() => updateItem(index, { ...item, deleted: true })}
                  >
                    삭제
                  </button>
                </footer>
              </>
            )}
          </article>
          );
        })}
      </div>
    </section>
  );
}

function GroupsEditor({
  section,
  presentation,
  onChange,
}: {
  section: CmsSection;
  presentation?: CmsHomeSectionPresentation;
  onChange: (section: CmsSection) => void;
}) {
  const [draggedItem, setDraggedItem] = useState<{
    groupId: string;
    index: number;
  } | null>(null);
  const updateGroup = (
    groupIndex: number,
    next: CmsSection["groups"][number],
  ) => {
    const groups = [...section.groups];
    groups[groupIndex] = next;
    onChange({ ...section, groups });
  };
  return (
    <>
      {section.groups.map((group, groupIndex) => {
        const groupPresentation = presentation?.groups?.[group.id];
        const fields = groupPresentation?.itemFields;
        const updateGroupItem = (
          itemIndex: number,
          next: CmsContentItem,
        ) => {
          const items = [...group.items];
          items[itemIndex] = next;
          updateGroup(groupIndex, { ...group, items });
        };
        const moveGroupItem = (from: number, to: number) => {
          if (from === to || to < 0 || to >= group.items.length) return;
          const items = [...group.items];
          const [moved] = items.splice(from, 1);
          items.splice(to, 0, moved);
          updateGroup(groupIndex, { ...group, items });
        };
        return (
          <section className="cms-editor-settings-group" key={group.id}>
            <div className="cms-editor-settings-heading">
              <div>
                <h3>{groupPresentation?.name ?? "묶음 내용"}</h3>
                <p>이 영역 안에서 함께 표시되는 내용을 관리합니다.</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateGroup(groupIndex, {
                    ...group,
                    items: [
                      ...group.items,
                      {
                        id: createStableId("item"),
                        title: "새 항목",
                        description: "",
                        visible: true,
                        deleted: false,
                      },
                    ],
                  })
                }
              >
                항목 추가
              </button>
            </div>
            <label className="cms-editor-check">
              <input
                type="checkbox"
                checked={group.visible}
                onChange={(event) =>
                  updateGroup(groupIndex, {
                    ...group,
                    visible: event.target.checked,
                  })
                }
              />
              이 묶음 표시
            </label>
            {groupPresentation?.label ? (
              <Field
                label={groupPresentation.label}
                help="이 내용 묶음의 작은 안내에 표시됩니다."
              >
                <input
                  value={group.label ?? ""}
                  onChange={(event) =>
                    updateGroup(groupIndex, {
                      ...group,
                      label: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
            {groupPresentation?.title ? (
              <Field
                label={groupPresentation.title}
                help="이 내용 묶음의 큰 문구에 표시됩니다."
              >
                <input
                  value={group.title ?? ""}
                  onChange={(event) =>
                    updateGroup(groupIndex, {
                      ...group,
                      title: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
            {groupPresentation?.description ? (
              <Field
                label={groupPresentation.description}
                help="묶음 제목 아래에 표시됩니다."
              >
                <textarea
                  rows={3}
                  value={group.description ?? ""}
                  onChange={(event) =>
                    updateGroup(groupIndex, {
                      ...group,
                      description: event.target.value,
                    })
                  }
                />
              </Field>
            ) : null}
            <div className="cms-editor-repeat-list">
              {group.items.map((item, itemIndex) => (
                <article
                  className={item.deleted ? "is-deleted" : ""}
                  key={item.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedItem?.groupId === group.id) {
                      moveGroupItem(draggedItem.index, itemIndex);
                    }
                    setDraggedItem(null);
                  }}
                >
                  <header>
                    <button
                      type="button"
                      draggable={!item.deleted}
                      onDragStart={() =>
                        setDraggedItem({ groupId: group.id, index: itemIndex })
                      }
                      onDragEnd={() => setDraggedItem(null)}
                      aria-label={`${item.title} 순서 끌어서 바꾸기`}
                    >
                      ↕
                    </button>
                    <strong>
                      {item.deleted ? "삭제한 항목" : `항목 ${itemIndex + 1}`}
                    </strong>
                    <span>
                      <button
                        type="button"
                        onClick={() => moveGroupItem(itemIndex, itemIndex - 1)}
                        disabled={itemIndex === 0 || item.deleted}
                        aria-label="위로 이동"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveGroupItem(itemIndex, itemIndex + 1)}
                        disabled={
                          itemIndex === group.items.length - 1 || item.deleted
                        }
                        aria-label="아래로 이동"
                      >
                        ↓
                      </button>
                    </span>
                  </header>
                  {item.deleted ? (
                    <button
                      className="cms-editor-restore"
                      type="button"
                      onClick={() =>
                        updateGroupItem(itemIndex, {
                          ...item,
                          deleted: false,
                        })
                      }
                    >
                      이 항목 복원
                    </button>
                  ) : (
                    <>
                      {fields?.label ? (
                        <Field label={fields.label} help="항목의 작은 분류입니다.">
                          <input
                            value={item.label ?? ""}
                            onChange={(event) =>
                              updateGroupItem(itemIndex, {
                                ...item,
                                label: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      {fields?.value ? (
                        <Field label={fields.value} help="짧게 강조되는 값입니다.">
                          <input
                            value={item.value ?? ""}
                            onChange={(event) =>
                              updateGroupItem(itemIndex, {
                                ...item,
                                value: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <Field
                        label={fields?.title ?? "항목 제목"}
                        help="이 항목에서 가장 먼저 표시됩니다."
                      >
                        <input
                          value={item.title}
                          onChange={(event) =>
                            updateGroupItem(itemIndex, {
                              ...item,
                              title: event.target.value,
                            })
                          }
                        />
                      </Field>
                      {fields?.description !== undefined ? (
                        <Field
                          label={fields.description}
                          help="항목 제목 아래에 표시됩니다."
                        >
                          <textarea
                            rows={3}
                            value={item.description ?? ""}
                            onChange={(event) =>
                              updateGroupItem(itemIndex, {
                                ...item,
                                description: event.target.value,
                              })
                            }
                          />
                        </Field>
                      ) : null}
                      <footer>
                        <button
                          type="button"
                          onClick={() => {
                            const items = [...group.items];
                            items.splice(itemIndex + 1, 0, {
                              ...item,
                              id: createStableId("item"),
                              title: `${item.title} 복사본`,
                            });
                            updateGroup(groupIndex, { ...group, items });
                          }}
                        >
                          복제
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateGroupItem(itemIndex, {
                              ...item,
                              deleted: true,
                            })
                          }
                        >
                          삭제
                        </button>
                      </footer>
                    </>
                  )}
                </article>
              ))}
            </div>
            {group.actions.map((action, actionIndex) => (
              <div className="cms-editor-repeat-list" key={action.id}>
                <article>
                  <strong>연결 버튼</strong>
                  <Field
                    label="버튼 문구"
                    help="안내 영역의 버튼 안에 표시됩니다."
                  >
                    <input
                      value={action.label}
                      onChange={(event) => {
                        const actions = [...group.actions];
                        actions[actionIndex] = {
                          ...action,
                          label: event.target.value,
                        };
                        updateGroup(groupIndex, { ...group, actions });
                      }}
                    />
                  </Field>
                  <Field
                    label="이동할 화면"
                    help="버튼을 누르면 이동할 사이트 안 화면입니다."
                  >
                    <select
                      value={action.href}
                      onChange={(event) => {
                        const actions = [...group.actions];
                        actions[actionIndex] = {
                          ...action,
                          href: event.target.value,
                        };
                        updateGroup(groupIndex, { ...group, actions });
                      }}
                    >
                      {HOME_ANCHOR_OPTIONS.map((option) => (
                        <option key={option.href} value={option.href}>
                          {option.label}
                        </option>
                      ))}
                      {INTERNAL_PAGES.map((pageKey) => (
                        <option
                          key={pageKey}
                          value={CMS_PAGE_ROUTES[pageKey]}
                        >
                          {CMS_PAGE_PRESENTATION[pageKey].name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </article>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

function ActionsEditor({
  section,
  onChange,
  protectedIds = [],
}: {
  section: CmsSection;
  onChange: (section: CmsSection) => void;
  protectedIds?: readonly string[];
}) {
  const updateAction = (index: number, next: CmsLink) => {
    const actions = [...section.actions];
    actions[index] = next;
    onChange({ ...section, actions });
  };
  return (
    <section className="cms-editor-settings-group">
      <div className="cms-editor-settings-heading">
        <div>
          <h3>버튼과 링크</h3>
          <p>누르면 이동하는 버튼의 문구와 목적지를 정합니다.</p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...section,
              actions: [
                ...section.actions,
                {
                  id: createStableId("link"),
                  label: "새 버튼",
                  linkType: "internal",
                  href: "/",
                  appearance: "primary",
                  openInNewWindow: false,
                },
              ],
            })
          }
        >
          버튼 추가
        </button>
      </div>
      <div className="cms-editor-repeat-list">
        {section.actions.map((action, index) => {
          const isProtected = protectedIds.includes(action.id);
          return (
          <article key={action.id}>
            <strong>버튼 {index + 1}</strong>
            <Field label="버튼 문구" help="고객이 누르는 버튼 안에 표시됩니다.">
              <input
                value={action.label}
                onChange={(event) =>
                  updateAction(index, { ...action, label: event.target.value })
                }
              />
            </Field>
            <Field label="연결 방식" help="사이트 안의 화면인지 외부 주소인지 선택합니다.">
              <select
                value={action.linkType}
                disabled={isProtected}
                onChange={(event) => {
                  const linkType = event.target.value as CmsLink["linkType"];
                  updateAction(index, {
                    ...action,
                    linkType,
                    href: linkType === "internal" ? "/" : "https://",
                    openInNewWindow:
                      linkType === "external" ? action.openInNewWindow : false,
                  });
                }}
              >
                <option value="internal">사이트 안의 화면</option>
                <option value="external">외부 주소·이메일·전화</option>
              </select>
            </Field>
            {action.linkType === "internal" ? (
              <Field label="이동할 화면" help="버튼을 누르면 이동할 사이트 안 화면입니다.">
                <select
                  value={action.href}
                  disabled={isProtected}
                  onChange={(event) =>
                    updateAction(index, { ...action, href: event.target.value })
                  }
                >
                  {HOME_ANCHOR_OPTIONS.map((option) => (
                    <option key={option.href} value={option.href}>
                      {option.label}
                    </option>
                  ))}
                  {INTERNAL_PAGES.map((pageKey) => (
                    <option key={pageKey} value={CMS_PAGE_ROUTES[pageKey]}>
                      {CMS_PAGE_PRESENTATION[pageKey].name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field
                label="외부 연결 주소"
                help="https:// 주소, 이메일(mailto:) 또는 전화(tel:)만 허용됩니다."
              >
                <input
                  type="url"
                  value={action.href}
                  disabled={isProtected}
                  onChange={(event) =>
                    updateAction(index, { ...action, href: event.target.value })
                  }
                  placeholder="https://example.com"
                />
              </Field>
            )}
            <Field label="버튼 모양" help="화면에서 버튼이 강조되는 정도입니다.">
              <select
                value={action.appearance}
                onChange={(event) =>
                  updateAction(index, {
                    ...action,
                    appearance: event.target.value as CmsLink["appearance"],
                  })
                }
              >
                <option value="primary">대표 버튼</option>
                <option value="secondary">보조 버튼</option>
                <option value="text">문자 링크</option>
              </select>
            </Field>
            {action.linkType === "external" ? (
              <label className="cms-editor-check">
                <input
                  type="checkbox"
                  checked={action.openInNewWindow}
                  onChange={(event) =>
                    updateAction(index, {
                      ...action,
                      openInNewWindow: event.target.checked,
                    })
                  }
                />
                새 창에서 열기
              </label>
            ) : null}
            {isProtected ? (
              <p className="cms-editor-help">
                필수 동의 안내 링크입니다. 버튼 문구와 모양만 변경할 수 있습니다.
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                onClick={() => {
                  const actions = [...section.actions];
                  actions.splice(index + 1, 0, {
                    ...action,
                    id: createStableId("link"),
                    label: `${action.label} 복사본`,
                  });
                  onChange({ ...section, actions });
                }}
              >
                복제
              </button>
              <button
                type="button"
                disabled={isProtected}
                onClick={() =>
                  onChange({
                    ...section,
                    actions: section.actions.filter(
                      (_, actionIndex) => actionIndex !== index,
                    ),
                  })
                }
              >
                삭제
              </button>
            </footer>
          </article>
          );
        })}
      </div>
    </section>
  );
}

function SectionSettings({
  section,
  pageKey,
  device,
  uploading,
  onChange,
  onUploadImage,
}: {
  section: CmsSection;
  pageKey: CmsPageKey;
  device: CmsPreviewDevice;
  uploading: boolean;
  onChange: (section: CmsSection) => void;
  onUploadImage: (file: File, alt: string) => Promise<void>;
}) {
  const [newImageAlt, setNewImageAlt] = useState("");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const presentation = sectionPresentation(pageKey, section.id);
  const eventCardStyle: NonNullable<CmsSection["style"]["card"]> =
    section.style.card ?? {
      background: section.id === "intakeForm" ? "surface" : "softGray",
      border:
        section.id === "intakeForm" || section.id === "faq"
          ? "subtle"
          : "none",
      radius: section.id === "intakeForm" ? "rounded" : "default",
      shadow: section.id === "intakeForm" ? "soft" : "none",
    };
  const eventButtonStyle: NonNullable<CmsSection["style"]["button"]> =
    section.style.button ?? {
      tone: "primary",
      size: "default",
      radius: "default",
    };
  const unifiedAlignment =
    section.style.title.alignment === section.style.body.alignment
      ? section.style.title.alignment
      : "mixed";
  if (section.deleted) {
    return (
      <div className="cms-editor-settings">
        <header className="cms-editor-settings__title">
          <span>삭제한 화면 영역</span>
          <h2>
            {presentation?.name ?? (section.title || "제목 없는 영역")}
          </h2>
          <p>이 영역은 초안에 보관되어 있습니다. 복원한 뒤 다시 편집할 수 있습니다.</p>
        </header>
        <section className="cms-editor-settings-group">
          <div className="cms-editor-deleted-item">
            <div>
              <strong>화면에서 삭제한 영역</strong>
              <p>
                게시 전에는 고객 화면이 바뀌지 않습니다. 복원하면 미리보기와
                편집 설정이 다시 열립니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({ ...section, deleted: false, visible: true })
              }
            >
              영역 복원
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="cms-editor-settings">
      <header className="cms-editor-settings__title">
        <span>선택한 화면 영역</span>
        <h2>
          {presentation?.name ?? (section.title || "제목 없는 영역")}
        </h2>
        <p>입력한 내용은 가운데 미리보기에 바로 표시됩니다.</p>
      </header>
      <section className="cms-editor-settings-group">
        <h3>기본 내용</h3>
        <label className="cms-editor-check">
          <input
            type="checkbox"
            checked={section.visible}
            disabled={section.locked}
            onChange={(event) =>
              onChange({ ...section, visible: event.target.checked })
            }
          />
          이 영역 표시
        </label>
        {section.locked ? (
          <p className="cms-editor-help">서비스 운영에 필요한 필수 영역은 숨기거나 삭제할 수 없습니다.</p>
        ) : null}
        {presentation?.legalWarning ? (
          <div className="cms-editor-legal-warning" role="note">
            <strong>필수 안내 변경 주의</strong>
            <p>{presentation.legalWarning}</p>
          </div>
        ) : null}
        <Field
          label={presentation?.eyebrowLabel ?? "작은 안내 제목"}
          help="큰 제목 바로 위에 짧게 표시됩니다."
        >
          <input
            value={section.eyebrow ?? ""}
            onChange={(event) =>
              onChange({ ...section, eyebrow: event.target.value })
            }
          />
        </Field>
        <Field
          label={presentation?.titleLabel ?? "큰 제목"}
          help="이 화면 영역에서 가장 먼저 보이는 문구입니다."
        >
          <input
            required
            value={section.title}
            onChange={(event) =>
              onChange({ ...section, title: event.target.value })
            }
          />
        </Field>
        {!presentation || presentation.descriptionLabel ? (
          <Field
            label={presentation?.descriptionLabel ?? "본문 안내"}
            help="큰 제목 아래에서 내용을 자세히 설명합니다."
          >
            <textarea
              rows={5}
              value={section.description ?? ""}
              onChange={(event) =>
                onChange({ ...section, description: event.target.value })
              }
            />
          </Field>
        ) : null}
        {presentation?.textFields
          ? Object.entries(presentation.textFields).map(([key, field]) => (
              <Field key={key} label={field.label} help={field.help}>
                <textarea
                  rows={key.toLowerCase().includes("description") ? 4 : 2}
                  value={section.text[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...section,
                      text: {
                        ...section.text,
                        [key]: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            ))
          : null}
      </section>
      <section className="cms-editor-settings-group">
        <h3>이미지</h3>
        <p className="cms-editor-help">
          권장 크기 1600×900px, 16:9 비율입니다. JPG, PNG, WebP, GIF 파일을
          10MB 이하로 올려 주세요.
        </p>
        {section.media?.deleted ? (
          <div className="cms-editor-deleted-item">
            <div>
              <strong>화면에서 삭제한 이미지</strong>
              <p>
                초안에 보관되어 있습니다. 게시 전이나 이후에도 다시 복원할 수
                있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...section,
                  media: section.media
                    ? { ...section.media, deleted: false }
                    : undefined,
                })
              }
            >
              이미지 복원
            </button>
          </div>
        ) : section.media ? (
          <>
            <Field
              label="이미지 설명"
              help="이미지를 볼 수 없는 사용자를 위해 무엇이 보이는지 설명합니다."
            >
              <input
                required
                value={section.media.alt}
                onChange={(event) =>
                  onChange({
                    ...section,
                    media: section.media
                      ? { ...section.media, alt: event.target.value }
                      : undefined,
                  })
                }
              />
            </Field>
            <Field label="이미지 비율" help="화면에서 이미지가 차지하는 모양입니다.">
              <select
                value={section.media.aspectRatio}
                onChange={(event) =>
                  onChange({
                    ...section,
                    media: section.media
                      ? {
                          ...section.media,
                          aspectRatio: event.target
                            .value as NonNullable<
                            CmsSection["media"]
                          >["aspectRatio"],
                        }
                      : undefined,
                  })
                }
              >
                <option value="auto">원본 비율</option>
                <option value="16:9">16:9 넓은 화면</option>
                <option value="4:3">4:3 기본</option>
                <option value="3:2">3:2 사진</option>
                <option value="1:1">1:1 정사각형</option>
              </select>
            </Field>
            <div className="cms-editor-inline-actions">
              <label className="cms-editor-upload-button">
                {uploading ? "교체 중…" : "이미지 교체"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onUploadImage(file, section.media?.alt ?? "");
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...section,
                    media: section.media
                      ? { ...section.media, deleted: true }
                      : undefined,
                  })
                }
              >
                화면에서 삭제하고 보관
              </button>
            </div>
          </>
        ) : (
          <>
            <Field
              label="이미지 설명"
              help="파일을 선택하기 전에 이미지 내용을 짧게 설명해 주세요."
            >
              <input
                value={newImageAlt}
                onChange={(event) => setNewImageAlt(event.target.value)}
                placeholder="예: 상담 중인 농협 직원"
              />
            </Field>
            <label
              className={`cms-editor-upload-button${!newImageAlt.trim() ? " is-disabled" : ""}`}
            >
              {uploading ? "업로드 중…" : "이미지 추가"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={uploading || !newImageAlt.trim()}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onUploadImage(file, newImageAlt.trim());
                  event.target.value = "";
                }}
              />
            </label>
          </>
        )}
      </section>
      <ActionsEditor
        section={section}
        protectedIds={
          CMS_PROTECTED_PAGE_ACTION_IDS[pageKey]?.[section.id] ?? []
        }
        onChange={onChange}
      />
      <ItemsEditor
        section={section}
        fields={presentation?.itemFields}
        protectedIds={
          CMS_PROTECTED_PAGE_ITEM_IDS[pageKey]?.[section.id] ?? []
        }
        onChange={onChange}
      />
      <GroupsEditor
        section={section}
        presentation={presentation}
        onChange={onChange}
      />
      <section className="cms-editor-settings-group">
        <h3>콘텐츠 배치</h3>
        <Field
          label="콘텐츠 전체 정렬"
          help="이 영역의 큰 제목과 본문을 한 번에 왼쪽, 가운데 또는 오른쪽으로 맞춥니다."
        >
          <select
            value={unifiedAlignment}
            onChange={(event) => {
              const alignment = event.target
                .value as CmsTypographyStyle["alignment"];
              onChange({
                ...section,
                style: {
                  ...section.style,
                  title: { ...section.style.title, alignment },
                  body: { ...section.style.body, alignment },
                },
              });
            }}
          >
            {unifiedAlignment === "mixed" ? (
              <option value="mixed" disabled>
                제목·본문 정렬이 다름
              </option>
            ) : null}
            <option value="left">왼쪽 정렬</option>
            <option value="center">가운데 정렬</option>
            <option value="right">오른쪽 정렬</option>
          </select>
        </Field>
        <p className="cms-editor-help">
          제목과 본문을 서로 다르게 배치하려면 아래의 개별 디자인 설정을
          사용하세요.
        </p>
      </section>
      <TypographySettings
        label="큰 제목 디자인"
        value={section.style.title}
        device={device}
        onChange={(title) =>
          onChange({
            ...section,
            style: { ...section.style, title },
          })
        }
      />
      <TypographySettings
        label="본문 디자인"
        value={section.style.body}
        device={device}
        onChange={(body) =>
          onChange({
            ...section,
            style: { ...section.style, body },
          })
        }
      />
      <section className="cms-editor-settings-group">
        <h3>영역 배경과 테두리</h3>
        <ColorPicker
          label="배경 색상"
          value={section.style.container.background}
          onChange={(background) =>
            onChange({
              ...section,
              style: {
                ...section.style,
                container: { ...section.style.container, background },
              },
            })
          }
        />
        <Field label="기본 여백" help="영역 안쪽 위아래 공간입니다.">
          <select
            value={section.style.container.spacing}
            onChange={(event) =>
              onChange({
                ...section,
                style: {
                  ...section.style,
                  container: {
                    ...section.style.container,
                    spacing: event.target
                      .value as CmsSection["style"]["container"]["spacing"],
                  },
                },
              })
            }
          >
            <option value="compact">좁게</option>
            <option value="default">기본</option>
            <option value="relaxed">넓게</option>
          </select>
        </Field>
        <Field label="테두리" help="영역의 바깥선을 표시할지 정합니다.">
          <select
            value={section.style.container.border}
            onChange={(event) =>
              onChange({
                ...section,
                style: {
                  ...section.style,
                  container: {
                    ...section.style.container,
                    border: event.target
                      .value as CmsSection["style"]["container"]["border"],
                  },
                },
              })
            }
          >
            <option value="none">없음</option>
            <option value="subtle">얇게</option>
            <option value="strong">진하게</option>
          </select>
        </Field>
        <Field label="모서리" help="영역 모서리의 둥근 정도입니다.">
          <select
            value={section.style.container.radius}
            onChange={(event) =>
              onChange({
                ...section,
                style: {
                  ...section.style,
                  container: {
                    ...section.style.container,
                    radius: event.target
                      .value as CmsSection["style"]["container"]["radius"],
                  },
                },
              })
            }
          >
            <option value="square">각지게</option>
            <option value="default">기본</option>
            <option value="rounded">많이 둥글게</option>
          </select>
        </Field>
        <Field label="그림자" help="영역이 배경에서 떠 보이는 정도입니다.">
          <select
            value={section.style.container.shadow}
            onChange={(event) =>
              onChange({
                ...section,
                style: {
                  ...section.style,
                  container: {
                    ...section.style.container,
                    shadow: event.target
                      .value as CmsSection["style"]["container"]["shadow"],
                  },
                },
              })
            }
          >
            <option value="none">없음</option>
            <option value="soft">은은하게</option>
            <option value="medium">뚜렷하게</option>
          </select>
        </Field>
        <details className="cms-editor-advanced">
          <summary>고급 영역 설정</summary>
          <Field
            label={`${DEVICE_LABELS[device]} 상세 위아래 여백`}
            help="0px부터 160px까지 입력할 수 있습니다."
          >
            <input
              type="number"
              min={0}
              max={160}
              value={responsiveValue(
                section.style.container.customPaddingY,
                device,
                48,
              )}
              onChange={(event) =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    container: {
                      ...section.style.container,
                      customPaddingY: setResponsiveValue(
                        section.style.container.customPaddingY,
                        device,
                        Number(event.target.value),
                        48,
                      ),
                    },
                  },
                })
              }
            />
          </Field>
          <button
            className="cms-editor-text-button"
            type="button"
            onClick={() =>
              onChange({
                ...section,
                style: {
                  ...section.style,
                  container: {
                    ...section.style.container,
                    customPaddingY: undefined,
                  },
                },
              })
            }
          >
            여백 프리셋으로 되돌리기
          </button>
          <Field label="제목 단계" help="화면을 읽는 순서에 맞춰 큰 제목부터 사용합니다.">
            <select
              value={section.headingLevel}
              onChange={(event) =>
                onChange({
                  ...section,
                  headingLevel: Number(event.target.value) as 2 | 3,
                })
              }
            >
              <option value={2}>큰 제목</option>
              <option value={3}>하위 제목</option>
            </select>
          </Field>
        </details>
        <button
          className="cms-editor-reset"
          type="button"
          onClick={() => setShowResetConfirm(true)}
        >
          기본 디자인으로 초기화
        </button>
      </section>
      {pageKey === "event.auditQuote" &&
      ["intakeForm", "benefits", "steps", "faq"].includes(section.id) ? (
        <section className="cms-editor-settings-group">
          <h3>카드 디자인</h3>
          <p className="cms-editor-help">
            입력 카드와 이 영역 안의 혜택·단계·질문 카드에만 적용됩니다.
          </p>
          <Field label="카드 배경" help="승인된 페이지 색상 중에서 선택합니다.">
            <select
              value={eventCardStyle.background}
              onChange={(event) =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    card: {
                      ...eventCardStyle,
                      background: event.target
                        .value as NonNullable<CmsSection["style"]["card"]>["background"],
                    },
                  },
                })
              }
            >
              {CMS_COLOR_TOKENS.map((token) => (
                <option key={token} value={token}>
                  {COLOR_LABELS[token]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="카드 테두리" help="카드의 바깥선 강도입니다.">
            <select
              value={eventCardStyle.border}
              onChange={(event) =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    card: {
                      ...eventCardStyle,
                      border: event.target
                        .value as NonNullable<CmsSection["style"]["card"]>["border"],
                    },
                  },
                })
              }
            >
              <option value="none">없음</option>
              <option value="subtle">얇게</option>
              <option value="strong">진하게</option>
            </select>
          </Field>
          <Field label="카드 모서리" help="카드 모서리의 둥근 정도입니다.">
            <select
              value={eventCardStyle.radius}
              onChange={(event) =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    card: {
                      ...eventCardStyle,
                      radius: event.target
                        .value as NonNullable<CmsSection["style"]["card"]>["radius"],
                    },
                  },
                })
              }
            >
              <option value="square">각지게</option>
              <option value="default">기본</option>
              <option value="rounded">많이 둥글게</option>
            </select>
          </Field>
          <Field label="카드 그림자" help="카드가 배경에서 떠 보이는 정도입니다.">
            <select
              value={eventCardStyle.shadow}
              onChange={(event) =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    card: {
                      ...eventCardStyle,
                      shadow: event.target
                        .value as NonNullable<CmsSection["style"]["card"]>["shadow"],
                    },
                  },
                })
              }
            >
              <option value="none">없음</option>
              <option value="soft">은은하게</option>
              <option value="medium">뚜렷하게</option>
            </select>
          </Field>
          {section.id === "intakeForm" ? (
            <>
              <h3>신청 버튼 디자인</h3>
              <Field label="버튼 색상" help="승인된 버튼 모양 중에서 선택합니다.">
                <select
                  value={eventButtonStyle.tone}
                  onChange={(event) =>
                    onChange({
                      ...section,
                      style: {
                        ...section.style,
                        button: {
                          ...eventButtonStyle,
                          tone: event.target
                            .value as NonNullable<CmsSection["style"]["button"]>["tone"],
                        },
                      },
                    })
                  }
                >
                  <option value="primary">대표 파랑</option>
                  <option value="ink">진한 글자색</option>
                  <option value="outline">테두리형</option>
                </select>
              </Field>
              <Field label="버튼 크기" help="버튼의 높이와 글자 크기입니다.">
                <select
                  value={eventButtonStyle.size}
                  onChange={(event) =>
                    onChange({
                      ...section,
                      style: {
                        ...section.style,
                        button: {
                          ...eventButtonStyle,
                          size: event.target
                            .value as NonNullable<CmsSection["style"]["button"]>["size"],
                        },
                      },
                    })
                  }
                >
                  <option value="compact">작게</option>
                  <option value="default">기본</option>
                  <option value="large">크게</option>
                </select>
              </Field>
              <Field label="버튼 모서리" help="버튼 모서리의 둥근 정도입니다.">
                <select
                  value={eventButtonStyle.radius}
                  onChange={(event) =>
                    onChange({
                      ...section,
                      style: {
                        ...section.style,
                        button: {
                          ...eventButtonStyle,
                          radius: event.target
                            .value as NonNullable<CmsSection["style"]["button"]>["radius"],
                        },
                      },
                    })
                  }
                >
                  <option value="square">각지게</option>
                  <option value="default">기본</option>
                  <option value="rounded">많이 둥글게</option>
                </select>
              </Field>
            </>
          ) : null}
          {section.style.card || section.style.button ? (
            <button
              className="cms-editor-reset"
              type="button"
              onClick={() =>
                onChange({
                  ...section,
                  style: {
                    ...section.style,
                    card: undefined,
                    button: undefined,
                  },
                })
              }
            >
              현재 페이지 디자인으로 되돌리기
            </button>
          ) : null}
        </section>
      ) : null}
      {showResetConfirm ? (
        <CmsEditorDialog
          className="cms-editor-dialog--small"
          labelledBy="cms-style-reset-title"
          onClose={() => setShowResetConfirm(false)}
        >
            <header>
              <div>
                <span>디자인 초기화</span>
                <h2 id="cms-style-reset-title">기본 디자인으로 되돌릴까요?</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                aria-label="디자인 초기화 닫기"
              >
                ×
              </button>
            </header>
            <div className="cms-editor-dialog-copy">
              <p>
                이 영역의 글자, 색상, 여백, 테두리와 그림자만 초기화합니다.
                문구와 이미지는 유지됩니다.
              </p>
            </div>
            <footer>
              <button type="button" onClick={() => setShowResetConfirm(false)}>
                취소
              </button>
              <button
                className="is-primary"
                type="button"
                onClick={() => {
                  onChange({ ...section, style: createDefaultSectionStyle() });
                  setShowResetConfirm(false);
                }}
              >
                기본 디자인으로 초기화
              </button>
            </footer>
        </CmsEditorDialog>
      ) : null}
    </div>
  );
}

function PageSettings({
  content,
  pageKey,
  onChange,
}: {
  content: CmsPageContent;
  pageKey: CmsPageKey;
  onChange: (content: CmsPageContent) => void;
}) {
  return (
    <div className="cms-editor-settings">
      <header className="cms-editor-settings__title">
        <span>화면 전체 설정</span>
        <h2>검색과 공유 정보</h2>
        <p>검색 결과와 화면을 공유할 때 보이는 문구입니다.</p>
      </header>
      <section className="cms-editor-settings-group">
        <Field label="검색 결과 제목" help="검색 결과와 브라우저 탭에 표시됩니다.">
          <input
            required
            maxLength={70}
            value={content.seo.title}
            onChange={(event) =>
              onChange({
                ...content,
                seo: { ...content.seo, title: event.target.value },
              })
            }
          />
        </Field>
        <Field label="검색 결과 설명" help="검색 결과 제목 아래에 표시됩니다.">
          <textarea
            required
            maxLength={180}
            rows={4}
            value={content.seo.description}
            onChange={(event) =>
              onChange({
                ...content,
                seo: { ...content.seo, description: event.target.value },
              })
            }
          />
        </Field>
        <label className="cms-editor-check">
          <input
            type="checkbox"
            checked={content.seo.indexable}
            onChange={(event) =>
              onChange({
                ...content,
                seo: { ...content.seo, indexable: event.target.checked },
              })
            }
          />
          검색 결과에 이 화면 표시
        </label>
      </section>
      {pageKey === "home" ? (
        <section className="cms-editor-settings-group">
          <h3>공통 영역 페이지별 덮어쓰기</h3>
          <p className="cms-editor-help">
            기본적으로 공통 상단과 하단을 그대로 사용합니다. 이 화면에서만
            다르게 보여야 할 때에만 사용해 주세요.
          </p>
          <label className="cms-editor-check">
            <input
              type="checkbox"
              checked={content.commonOverrides?.header?.hidden ?? false}
              onChange={(event) =>
                onChange({
                  ...content,
                  commonOverrides: {
                    ...content.commonOverrides,
                    header: {
                      ...content.commonOverrides?.header,
                      hidden: event.target.checked,
                    },
                  },
                })
              }
            />
            이 화면에서만 상단 메뉴 숨기기
          </label>
          <label className="cms-editor-check">
            <input
              type="checkbox"
              checked={content.commonOverrides?.footer?.hidden ?? false}
              onChange={(event) =>
                onChange({
                  ...content,
                  commonOverrides: {
                    ...content.commonOverrides,
                    footer: {
                      ...content.commonOverrides?.footer,
                      hidden: event.target.checked,
                    },
                  },
                })
              }
            />
            이 화면에서만 하단 정보 숨기기
          </label>
          {content.commonOverrides ? (
            <button
              className="cms-editor-reset"
              type="button"
              onClick={() =>
                onChange({ ...content, commonOverrides: undefined })
              }
            >
              공통 기본값으로 되돌리기
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function MessagesSettings({
  content,
  pageKey,
  onChange,
}: {
  content: CmsPageContent;
  pageKey: CmsPageKey;
  onChange: (content: CmsPageContent) => void;
}) {
  const entries = Object.entries(content.messages);
  return (
    <div className="cms-editor-settings">
      <header className="cms-editor-settings__title">
        <span>화면 안내 문구</span>
        <h2>상태와 도움말</h2>
        <p>처리 중, 완료 또는 오류 상황에서 고객에게 보여 주는 안내입니다.</p>
      </header>
      <section className="cms-editor-settings-group">
        {entries.length === 0 ? (
          <p className="cms-editor-help">이 화면에는 별도 안내 문구가 없습니다.</p>
        ) : (
          entries.map(([key, value], index) => {
            const eventField =
              getCmsFeatureDefinition(pageKey).editorSchema.messages[key];
            return (
              <Field
                key={key}
                label={
                  eventField?.label ??
                  (pageKey === "home" && key === "loading"
                    ? "FAQ 불러오는 중 안내"
                    : pageKey === "home" && key === "error"
                      ? "FAQ를 불러오지 못했을 때 안내"
                      : `안내 문구 ${index + 1}`)
                }
                help={
                  eventField?.help ??
                  "해당 상태가 발생했을 때 화면에 표시됩니다."
                }
              >
                <textarea
                  rows={3}
                  value={value}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      messages: {
                        ...content.messages,
                        [key]: event.target.value,
                      },
                    })
                  }
                />
              </Field>
            );
          })
        )}
      </section>
    </div>
  );
}

export function CmsEditorSettings({
  content,
  pageKey,
  selection,
  device,
  uploading,
  onChangeContent,
  onChangeSection,
  onUploadImage,
}: {
  content: CmsPageContent;
  pageKey: CmsPageKey;
  selection: EditorSelection;
  device: CmsPreviewDevice;
  uploading: boolean;
  onChangeContent: (content: CmsPageContent) => void;
  onChangeSection: (section: CmsSection) => void;
  onUploadImage: (sectionId: string, file: File, alt: string) => Promise<void>;
}) {
  if (selection === "page") {
    return (
      <PageSettings
        content={content}
        pageKey={pageKey}
        onChange={onChangeContent}
      />
    );
  }
  if (selection === "messages") {
    return (
      <MessagesSettings
        content={content}
        pageKey={pageKey}
        onChange={onChangeContent}
      />
    );
  }
  const section = content.sections.find((candidate) => candidate.id === selection);
  if (!section) {
    return (
      <div className="cms-editor-settings cms-editor-settings--empty">
        <strong>편집할 화면 영역을 선택해 주세요.</strong>
      </div>
    );
  }
  return (
    <SectionSettings
      section={section}
      pageKey={pageKey}
      device={device}
      uploading={uploading}
      onChange={onChangeSection}
      onUploadImage={(file, alt) => onUploadImage(section.id, file, alt)}
    />
  );
}
