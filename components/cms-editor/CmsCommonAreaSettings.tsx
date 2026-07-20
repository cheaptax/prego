"use client";

import { useState, type ReactNode } from "react";
import { CmsEditorDialog } from "@/components/cms-editor/CmsEditorDialog";
import type { CmsGlobalKey } from "@/lib/cms/constants";
import type {
  CmsGlobalContent,
  CmsLink,
  CmsNavigationItem,
} from "@/lib/cms/schemas";

const TEXT_FIELDS: Partial<
  Record<CmsGlobalKey, Record<string, { label: string; help: string }>>
> = {
  siteIdentity: {
    serviceName: {
      label: "서비스 이름",
      help: "상단 로고 옆의 큰 이름에 표시됩니다.",
    },
    poweredBy: {
      label: "운영 브랜드 안내",
      help: "서비스 이름 바로 아래에 표시됩니다.",
    },
    logoAlt: {
      label: "로고 이미지 설명",
      help: "로고를 볼 수 없는 사용자를 위한 설명입니다.",
    },
    homeAriaLabel: {
      label: "홈 이동 링크 설명",
      help: "화면 읽기 도구가 로고 링크를 설명할 때 사용합니다.",
    },
  },
  header: {
    mainNavigationLabel: {
      label: "상단 메뉴 설명",
      help: "화면 읽기 도구가 PC 메뉴를 설명할 때 사용합니다.",
    },
    mobileNavigationLabel: {
      label: "모바일 메뉴 설명",
      help: "화면 읽기 도구가 모바일 메뉴를 설명할 때 사용합니다.",
    },
    openMenuLabel: {
      label: "메뉴 열기 버튼 설명",
      help: "모바일 메뉴가 닫혀 있을 때 사용합니다.",
    },
    closeMenuLabel: {
      label: "메뉴 닫기 버튼 설명",
      help: "모바일 메뉴가 열려 있을 때 사용합니다.",
    },
  },
  footer: {
    brandName: {
      label: "하단 서비스 이름",
      help: "하단 로고 옆 첫 줄에 표시됩니다.",
    },
    brandTagline: {
      label: "하단 서비스 설명",
      help: "하단 서비스 이름과 맨 아래에 표시됩니다.",
    },
    operatorHeading: {
      label: "운영 주체 영역 제목",
      help: "운영 회사 정보 위에 표시됩니다.",
    },
    operatorName: {
      label: "운영 회사명",
      help: "운영 주체 영역의 회사명입니다.",
    },
    serviceLabel: {
      label: "서비스명 안내",
      help: "운영 회사명 아래에 표시됩니다.",
    },
    policyHeading: {
      label: "정책 영역 제목",
      help: "약관과 개인정보 링크 위에 표시됩니다.",
    },
    privacyOfficer: {
      label: "개인정보 보호책임자",
      help: "정책 링크 아래에 표시됩니다.",
    },
    contactHeading: {
      label: "문의 영역 제목",
      help: "고객문의와 주요 링크 위에 표시됩니다.",
    },
    copyright: {
      label: "저작권 문구",
      help: "하단 맨 아래 왼쪽에 표시됩니다.",
    },
  },
  support: {
    title: {
      label: "고객지원 이름",
      help: "플로팅 버튼에 마우스를 올렸을 때 표시됩니다.",
    },
    ariaLabel: {
      label: "고객지원 버튼 설명",
      help: "화면 읽기 도구가 플로팅 버튼을 설명할 때 사용합니다.",
    },
    description: {
      label: "고객지원 안내",
      help: "고객지원 영역을 확장할 때 사용할 공통 설명입니다.",
    },
  },
};

const LINK_NAMES: Record<string, string> = {
  consult: "상담·견적 버튼",
  login: "로그인 버튼",
  signup: "회원가입 버튼",
  mypage: "마이페이지 버튼",
  terms: "이용약관 링크",
  privacy: "개인정보처리방침 링크",
  inquiries: "문의게시판 링크",
  about: "센터 소개 링크",
  support: "고객지원 플로팅 버튼",
};

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

function createNavigationItem(): CmsNavigationItem {
  return {
    id: `nav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    label: "새 메뉴",
    linkType: "internal",
    href: "/",
    appearance: "text",
    openInNewWindow: false,
    children: [],
  };
}

function LinkFields({
  name,
  link,
  onChange,
}: {
  name: string;
  link: CmsLink;
  onChange: (link: CmsLink) => void;
}) {
  return (
    <article>
      <strong>{name}</strong>
      <Field label="표시 문구" help="버튼이나 링크 안에 표시됩니다.">
        <input
          value={link.label}
          onChange={(event) => onChange({ ...link, label: event.target.value })}
        />
      </Field>
      <Field label="연결 방식" help="사이트 안 화면인지 외부 주소인지 구분합니다.">
        <select
          value={link.linkType}
          onChange={(event) => {
            const linkType = event.target.value as CmsLink["linkType"];
            onChange({
              ...link,
              linkType,
              href: linkType === "internal" ? "/" : "https://",
            });
          }}
        >
          <option value="internal">사이트 안의 화면</option>
          <option value="external">외부 주소</option>
        </select>
      </Field>
      <Field
        label="이동 주소"
        help={
          link.linkType === "internal"
            ? "사이트 안 주소 또는 현재 화면의 #영역을 입력합니다."
            : "https://로 시작하는 안전한 주소를 입력합니다."
        }
      >
        <input
          value={link.href}
          onChange={(event) => onChange({ ...link, href: event.target.value })}
        />
      </Field>
    </article>
  );
}

export function CmsCommonAreaSettings({
  documentKey,
  content,
  uploading,
  onChange,
  onUploadLogo,
}: {
  documentKey: CmsGlobalKey;
  content: CmsGlobalContent;
  uploading: boolean;
  onChange: (content: CmsGlobalContent) => void;
  onUploadLogo: (file: File, alt: string) => Promise<void>;
}) {
  const [draggedNavigationIndex, setDraggedNavigationIndex] = useState<
    number | null
  >(null);
  const [pendingDeleteNavigationIndex, setPendingDeleteNavigationIndex] =
    useState<number | null>(null);
  const textFields = TEXT_FIELDS[documentKey] ?? {};
  const brandSection = content.sections.find(
    (section) => section.id === "brand",
  );
  const moveNavigation = (from: number, to: number) => {
    if (from === to || to < 0 || to >= content.navigation.length) return;
    const navigation = [...content.navigation];
    const [moved] = navigation.splice(from, 1);
    navigation.splice(to, 0, moved);
    onChange({ ...content, navigation });
  };
  return (
    <div className="cms-editor-settings">
      <header className="cms-editor-settings__title">
        <span>공통 영역 편집</span>
        <h2>
          {documentKey === "siteIdentity"
            ? "서비스 이름과 로고"
            : documentKey === "header"
              ? "상단 메뉴와 버튼"
              : documentKey === "footer"
                ? "하단 정보"
                : "고객지원 플로팅 버튼"}
        </h2>
        <p>여기서 바꾼 내용은 이 공통 영역을 사용하는 모든 화면에 적용됩니다.</p>
      </header>

      {Object.keys(textFields).length > 0 ? (
        <section className="cms-editor-settings-group">
          <h3>표시 문구</h3>
          {Object.entries(textFields).map(([key, field]) => (
            <Field key={key} label={field.label} help={field.help}>
              {key === "description" ? (
                <textarea
                  rows={4}
                  value={content.text[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      text: { ...content.text, [key]: event.target.value },
                    })
                  }
                />
              ) : (
                <input
                  value={content.text[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      text: { ...content.text, [key]: event.target.value },
                    })
                  }
                />
              )}
            </Field>
          ))}
        </section>
      ) : null}

      {documentKey === "siteIdentity" && brandSection ? (
        <section className="cms-editor-settings-group">
          <h3>로고 이미지</h3>
          <p className="cms-editor-help">
            투명 배경 SVG 대신 안전한 PNG 또는 WebP 이미지를 권장합니다. 가로형
            320×96px, 약 10:3 비율을 사용해 주세요.
          </p>
          <label className="cms-editor-upload-button">
            {uploading
              ? "로고 업로드 중…"
              : brandSection.media && !brandSection.media.deleted
                ? "로고 이미지 교체"
                : "로고 이미지 추가"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void onUploadLogo(
                    file,
                    content.text.logoAlt || "서비스 로고",
                  );
                }
                event.target.value = "";
              }}
            />
          </label>
          {brandSection.media ? (
            brandSection.media.deleted ? (
              <button
                className="cms-editor-reset"
                type="button"
                onClick={() =>
                  onChange({
                    ...content,
                    sections: content.sections.map((section) =>
                      section.id === "brand" && section.media
                        ? {
                            ...section,
                            media: { ...section.media, deleted: false },
                          }
                        : section,
                    ),
                  })
                }
              >
                이전 로고 이미지 복원
              </button>
            ) : (
              <button
                className="cms-editor-reset"
                type="button"
                onClick={() =>
                  onChange({
                    ...content,
                    sections: content.sections.map((section) =>
                      section.id === "brand" && section.media
                        ? {
                            ...section,
                            media: { ...section.media, deleted: true },
                          }
                        : section,
                    ),
                  })
                }
              >
                기본 로고로 되돌리고 이미지 보관
              </button>
            )
          ) : null}
        </section>
      ) : null}

      {documentKey === "header" ? (
        <section className="cms-editor-settings-group">
          <div className="cms-editor-settings-heading">
            <div>
              <h3>상단 내비게이션</h3>
              <p>PC와 모바일 상단 메뉴에 같은 순서로 표시됩니다.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...content,
                  navigation: [...content.navigation, createNavigationItem()],
                })
              }
            >
              메뉴 추가
            </button>
          </div>
          <div className="cms-editor-repeat-list">
            {content.navigation.map((item, index) => (
              <article
                key={item.id}
                className={item.deleted ? "is-deleted" : undefined}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedNavigationIndex !== null) {
                    moveNavigation(draggedNavigationIndex, index);
                  }
                  setDraggedNavigationIndex(null);
                }}
              >
                {item.deleted ? (
                  <div className="cms-editor-deleted-item">
                    <div>
                      <strong>삭제한 메뉴 · {item.label}</strong>
                      <p>초안에 보관되어 있으며 고객 화면에는 표시되지 않습니다.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const navigation = [...content.navigation];
                        navigation[index] = { ...item, deleted: false };
                        onChange({ ...content, navigation });
                      }}
                    >
                      메뉴 복원
                    </button>
                  </div>
                ) : (
                  <>
                <header>
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDraggedNavigationIndex(index)}
                    onDragEnd={() => setDraggedNavigationIndex(null)}
                    aria-label={`${item.label} 메뉴 순서 끌어서 바꾸기`}
                  >
                    ↕
                  </button>
                  <strong>메뉴 {index + 1}</strong>
                  <span>
                    <button
                      type="button"
                      onClick={() => moveNavigation(index, index - 1)}
                      disabled={index === 0}
                      aria-label="위로 이동"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveNavigation(index, index + 1)}
                      disabled={index === content.navigation.length - 1}
                      aria-label="아래로 이동"
                    >
                      ↓
                    </button>
                  </span>
                </header>
                <Field label="메뉴 이름" help="상단 메뉴에 표시됩니다.">
                  <input
                    value={item.label}
                    onChange={(event) => {
                      const navigation = [...content.navigation];
                      navigation[index] = {
                        ...item,
                        label: event.target.value,
                      };
                      onChange({ ...content, navigation });
                    }}
                  />
                </Field>
                <Field
                  label="이동 주소"
                  help="홈 영역은 /#about 형식, 다른 화면은 /inquiries 형식입니다."
                >
                  <input
                    value={item.href}
                    onChange={(event) => {
                      const navigation = [...content.navigation];
                      navigation[index] = {
                        ...item,
                        href: event.target.value,
                      };
                      onChange({ ...content, navigation });
                    }}
                  />
                </Field>
                <footer>
                  <button
                    type="button"
                    onClick={() => {
                      const navigation = [...content.navigation];
                      navigation.splice(index + 1, 0, {
                        ...item,
                        id: `nav_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        label: `${item.label} 복사본`,
                      });
                      onChange({ ...content, navigation });
                    }}
                  >
                    복제
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteNavigationIndex(index)}
                  >
                    삭제
                  </button>
                </footer>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {Object.keys(content.links).length > 0 ? (
        <section className="cms-editor-settings-group">
          <h3>버튼과 링크</h3>
          <div className="cms-editor-repeat-list">
            {Object.entries(content.links).map(([key, link]) => (
              <LinkFields
                key={key}
                name={LINK_NAMES[key] ?? "연결 링크"}
                link={link}
                onChange={(nextLink) =>
                  onChange({
                    ...content,
                    links: { ...content.links, [key]: nextLink },
                  })
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {pendingDeleteNavigationIndex !== null ? (
        <CmsEditorDialog
          className="cms-editor-dialog--small"
          labelledBy="cms-navigation-delete-title"
          onClose={() => setPendingDeleteNavigationIndex(null)}
        >
            <header>
              <div>
                <span>상단 메뉴 삭제</span>
                <h2 id="cms-navigation-delete-title">
                  {content.navigation[pendingDeleteNavigationIndex]?.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPendingDeleteNavigationIndex(null)}
                aria-label="삭제 확인 닫기"
              >
                ×
              </button>
            </header>
            <div className="cms-editor-dialog-copy">
              <p>
                게시하면 이 메뉴가 모든 화면의 상단에서 사라집니다. 삭제 후에도
                게시 전에는 공개 화면이 바뀌지 않습니다.
              </p>
            </div>
            <footer>
              <button
                type="button"
                onClick={() => setPendingDeleteNavigationIndex(null)}
              >
                취소
              </button>
              <button
                className="is-danger"
                type="button"
                onClick={() => {
                  onChange({
                    ...content,
                    navigation: content.navigation.map(
                      (item, itemIndex) =>
                        itemIndex === pendingDeleteNavigationIndex
                          ? { ...item, deleted: true }
                          : item,
                    ),
                  });
                  setPendingDeleteNavigationIndex(null);
                }}
              >
                메뉴 삭제하고 보관
              </button>
            </footer>
        </CmsEditorDialog>
      ) : null}
    </div>
  );
}
