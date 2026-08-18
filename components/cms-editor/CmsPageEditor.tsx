"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { getBlob, ref, uploadBytes } from "firebase/storage";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CmsEditorSettings } from "@/components/cms-editor/CmsEditorSettings";
import { CmsEditorDialog } from "@/components/cms-editor/CmsEditorDialog";
import { CmsActualPagePreview } from "@/components/cms-editor/CmsActualPagePreview";
import { AuditQuoteEventPage } from "@/components/AuditQuoteEventPage";
import { HomePageRenderer } from "@/components/HomePageRenderer";
import { useCmsGlobals } from "@/components/cms/CmsGlobalsProvider";
import {
  type CmsPreviewDevice,
} from "@/components/cms-editor/CmsPageRenderer";
import { CmsEditorSidebar } from "@/components/cms-editor/CmsEditorSidebar";
import { AuditQuoteGuidePage } from "@/components/AuditQuoteGuidePage";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPublicGlobals } from "@/lib/cms/public-content";
import {
  createBlankCmsSection,
  duplicateCmsSection,
  validatePageContentForPublish,
  type CmsEditorValidationIssue,
} from "@/lib/cms/editor-validation";
import type {
  CmsPageEditorApiResponse,
  CmsPageEditorData,
} from "@/lib/cms/page-editor-types";
import { cmsPageContentSchema, type CmsPageContent, type CmsSection } from "@/lib/cms/schemas";
import { canSoftDeleteCmsSection } from "@/lib/cms/section-lifecycle";
import {
  getFirebaseAuth,
  getFirebaseStorage,
} from "@/lib/firebase/client";

type EditorState = "loading" | "ready" | "denied" | "error";

const AUDIT_QUOTE_PREVIEW_CONFIG = {
  enabled: true,
  privacyPolicyVersion: "preview-protected-value",
  campaign: "preview",
  channel: "event_page",
  pagePath: "/events/audit-quote",
  privacyPolicyHref: "/signup",
  fixedFiscalYear: 2027,
  guaranteeMinQuotes: false,
  showPointsBenefit: false,
  pointsBenefitBaseLabel: null,
  retentionCopy: null,
  closedMessage: "",
} as const;
type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";
type NarrowPane = "sections" | "preview" | "settings";

const DEVICE_LABELS: Record<CmsPreviewDevice, string> = {
  desktop: "PC",
  tablet: "태블릿",
  mobile: "모바일",
};

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function cloneContent(content: CmsPageContent) {
  return structuredClone(content);
}

function sameContent(left: CmsPageContent, right: CmsPageContent) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readImageSize(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatDate(value: string | null) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function EditorStatePanel({
  state,
  onRetry,
}: {
  state: Exclude<EditorState, "ready">;
  onRetry: () => void;
}) {
  if (state === "loading") {
    return (
      <main className="cms-page-editor-state" role="status" aria-live="polite">
        <span className="cms-console-spinner" aria-hidden="true" />
        <strong>페이지 편집기를 준비하고 있습니다.</strong>
        <p>초안과 게시 내용을 안전하게 불러오는 중입니다.</p>
      </main>
    );
  }
  if (state === "denied") {
    return (
      <main className="cms-page-editor-state" role="alert">
        <strong>관리자 권한이 필요합니다.</strong>
        <p>콘텐츠를 관리할 수 있는 계정으로 다시 로그인해 주세요.</p>
        <Link href="/login">로그인 화면으로</Link>
      </main>
    );
  }
  return (
    <main className="cms-page-editor-state" role="alert">
      <strong>편집할 내용을 불러오지 못했습니다.</strong>
      <p>인터넷 연결을 확인한 뒤 다시 시도해 주세요. 공개 화면에는 영향이 없습니다.</p>
      <button type="button" onClick={onRetry}>
        다시 불러오기
      </button>
    </main>
  );
}

function SaveStatus({
  state,
  hasUnpublishedChanges,
}: {
  state: SaveState;
  hasUnpublishedChanges: boolean;
}) {
  const copy = {
    saved: hasUnpublishedChanges ? "초안 저장됨 · 미게시 변경 있음" : "모두 게시됨",
    dirty: "저장 대기 중",
    saving: "초안 저장 중…",
    failed: "저장하지 못함",
    conflict: "다른 관리자의 변경 발견",
  }[state];
  return (
    <span className={`cms-editor-save-state is-${state}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {copy}
    </span>
  );
}

function ValidationPanel({
  issues,
  onSelect,
}: {
  issues: CmsEditorValidationIssue[];
  onSelect: (sectionId: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="cms-editor-validation is-ok">
        <strong>게시 전 검사를 통과했습니다.</strong>
        <p>필수 문구, 링크, 이미지 설명과 디자인 범위를 확인했습니다.</p>
      </div>
    );
  }
  return (
    <div className="cms-editor-validation">
      <strong>게시 전에 {issues.length}개 항목을 확인해 주세요.</strong>
      <ul>
        {issues.map((issue) => (
          <li className={`is-${issue.severity}`} key={issue.id}>
            <span>{issue.severity === "error" ? "오류" : "경고"}</span>
            <p>{issue.message}</p>
            {issue.sectionId ? (
              <button type="button" onClick={() => onSelect(issue.sectionId!)}>
                해당 영역 열기
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function sectionChangeSummary(
  previous: CmsSection | undefined,
  current: CmsSection | undefined,
  previousIndex: number,
  currentIndex: number,
) {
  if (!previous) return ["새 영역"];
  if (!current) return ["영역 삭제"];
  const changes: string[] = [];
  if (previousIndex !== currentIndex) changes.push("영역 순서");
  if (previous.visible !== current.visible) changes.push("표시 여부");
  if (
    previous.eyebrow !== current.eyebrow ||
    previous.title !== current.title ||
    previous.description !== current.description ||
    JSON.stringify(previous.text) !== JSON.stringify(current.text)
  ) {
    changes.push("문구");
  }
  if (
    JSON.stringify(previous.items) !== JSON.stringify(current.items) ||
    JSON.stringify(previous.groups) !== JSON.stringify(current.groups)
  ) {
    changes.push("카드·목록");
  }
  if (JSON.stringify(previous.actions) !== JSON.stringify(current.actions)) {
    changes.push("버튼·링크");
  }
  if (JSON.stringify(previous.media) !== JSON.stringify(current.media)) {
    changes.push("이미지");
  }
  if (JSON.stringify(previous.style) !== JSON.stringify(current.style)) {
    changes.push("디자인");
  }
  return changes;
}

function CompareDialog({
  before,
  after,
  onClose,
}: {
  before: CmsPageContent;
  after: CmsPageContent;
  onClose: () => void;
}) {
  const beforeMap = new Map(before.sections.map((section) => [section.id, section]));
  const afterMap = new Map(after.sections.map((section) => [section.id, section]));
  const sectionIds = [
    ...new Set([
      ...before.sections.map((section) => section.id),
      ...after.sections.map((section) => section.id),
    ]),
  ];
  const pageChanges = [
    JSON.stringify(before.seo) !== JSON.stringify(after.seo)
      ? "검색·공유 정보"
      : null,
    JSON.stringify(before.messages) !== JSON.stringify(after.messages)
      ? "상태 안내 문구"
      : null,
    JSON.stringify(before.commonOverrides) !==
    JSON.stringify(after.commonOverrides)
      ? "공통 영역 표시 설정"
      : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <CmsEditorDialog
      className="cms-editor-compare"
      labelledBy="cms-compare-title"
      onClose={onClose}
    >
        <header>
          <div>
            <span>변경 전후 비교</span>
            <h2 id="cms-compare-title">게시 화면과 현재 초안</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="비교 창 닫기">
            ×
          </button>
        </header>
        <div className="cms-editor-compare__labels">
          <strong>현재 게시 내용</strong>
          <strong>편집 중인 초안</strong>
        </div>
        <div className="cms-editor-compare__list">
          {pageChanges.length > 0 ? (
            <article className="is-changed">
              <span>변경됨 · 화면 전체 설정</span>
              <p>{pageChanges.join(" · ")}</p>
            </article>
          ) : null}
          {sectionIds.map((sectionId) => {
            const previous = beforeMap.get(sectionId);
            const section = afterMap.get(sectionId);
            const changes = sectionChangeSummary(
              previous,
              section,
              before.sections.findIndex((candidate) => candidate.id === sectionId),
              after.sections.findIndex((candidate) => candidate.id === sectionId),
            );
            const changed = changes.length > 0;
            return (
              <article className={changed ? "is-changed" : ""} key={sectionId}>
                <span>
                  {changed ? "변경됨" : "변경 없음"}
                  {changed ? ` · ${changes.join(" · ")}` : ""}
                </span>
                <div>
                  <section>
                    <strong>{previous?.title ?? "게시 내용 없음"}</strong>
                    <p>{previous?.description ?? "설명 없음"}</p>
                  </section>
                  <section>
                    <strong>{section?.title || "초안에서 삭제됨"}</strong>
                    <p>{section?.description || "설명 없음"}</p>
                  </section>
                </div>
              </article>
            );
          })}
        </div>
        <footer>
          <button type="button" onClick={onClose}>
            확인
          </button>
        </footer>
    </CmsEditorDialog>
  );
}

function PreviewDialog({
  content,
  pageKey,
  globals,
  device,
  assetUrls,
  onClose,
}: {
  content: CmsPageContent;
  pageKey: CmsPageKey;
  globals: CmsPublicGlobals;
  device: CmsPreviewDevice;
  assetUrls: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <CmsEditorDialog
      className="cms-editor-full-preview"
      labelledBy="cms-preview-title"
      onClose={onClose}
    >
        <header>
          <div>
            <span>관리자 전용 초안 미리보기</span>
            <h2 id="cms-preview-title">{DEVICE_LABELS[device]} 화면 확인</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="미리보기 닫기">
            ×
          </button>
        </header>
        <div className={`cms-editor-preview-frame is-${device}`}>
          {pageKey === "home" ? (
            <HomePageRenderer
              content={content}
              globals={globals}
              assetUrls={assetUrls}
              mainId={null}
            />
          ) : pageKey === "event.auditQuote" ? (
            <AuditQuoteEventPage
              config={AUDIT_QUOTE_PREVIEW_CONFIG}
              content={content}
              previewMode
              mainId={null}
            />
          ) : (
            <CmsActualPagePreview
              pageKey={pageKey}
              content={content}
              device={device}
              assetUrls={assetUrls}
            />
          )}
        </div>
    </CmsEditorDialog>
  );
}

function HistoryDialog({
  editor,
  restoring,
  onRestore,
  onClose,
}: {
  editor: CmsPageEditorData;
  restoring: boolean;
  onRestore: (revisionId: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <CmsEditorDialog
      className="cms-editor-history"
      labelledBy="cms-history-title"
      onClose={onClose}
      closeDisabled={restoring}
    >
        <header>
          <div>
            <span>수정·게시 이력</span>
            <h2 id="cms-history-title">{editor.pageName} 이전 버전</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="이력 창 닫기">
            ×
          </button>
        </header>
        {editor.revisions.length === 0 ? (
          <div className="cms-editor-dialog-empty">
            <strong>아직 게시 이력이 없습니다.</strong>
            <p>처음 게시하면 이곳에서 이전 버전을 확인하고 복원할 수 있습니다.</p>
          </div>
        ) : (
          <ol className="cms-editor-history-list">
            {editor.revisions.map((revision) => (
              <li key={revision.id}>
                <div>
                  <strong>게시 버전 {revision.version}</strong>
                  <span>
                    {revision.action === "rollback" ? "이전 버전 게시" : "게시"} ·{" "}
                    {formatDate(revision.createdAt)}
                  </span>
                  {revision.legalCopyChanged ? (
                    <small className="cms-editor-history-legal">
                      필수 동의·면책문구 수정 이력
                    </small>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={() => void onRestore(revision.id)}
                >
                  초안으로 복원
                </button>
              </li>
            ))}
          </ol>
        )}
        <p className="cms-editor-dialog-note">
          복원하면 현재 게시 화면은 바뀌지 않고, 선택한 버전이 새 초안으로 준비됩니다.
        </p>
    </CmsEditorDialog>
  );
}

function PublishDialog({
  editor,
  issues,
  publishing,
  onCompare,
  onConfirm,
  onClose,
}: {
  editor: CmsPageEditorData;
  issues: CmsEditorValidationIssue[];
  publishing: boolean;
  onCompare: () => void;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const errors = issues.filter((issue) => issue.severity === "error");
  return (
    <CmsEditorDialog
      className="cms-editor-publish"
      labelledBy="cms-publish-title"
      onClose={onClose}
      closeDisabled={publishing}
    >
        <header>
          <div>
            <span>게시 확인</span>
            <h2 id="cms-publish-title">{editor.pageName} 화면에 반영할까요?</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="게시 확인 닫기">
            ×
          </button>
        </header>
        <div className="cms-editor-impact">
          <strong>영향받는 범위</strong>
          <p>
            게시하면 <b>{editor.route}</b> 화면을 방문하는 {editor.audienceLabel}에게
            현재 초안이 보입니다.
          </p>
        </div>
        <ValidationPanel issues={issues} onSelect={() => undefined} />
        <footer>
          <button type="button" onClick={onCompare}>
            변경 전후 비교
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="is-primary"
            type="button"
            disabled={publishing || errors.length > 0}
            onClick={() => void onConfirm()}
          >
            {publishing ? "게시 중…" : "확인하고 게시"}
          </button>
        </footer>
    </CmsEditorDialog>
  );
}

export function CmsPageEditor({ pageKey }: { pageKey: CmsPageKey }) {
  const globals = useCmsGlobals();
  const [state, setState] = useState<EditorState>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [editor, setEditor] = useState<CmsPageEditorData | null>(null);
  const [content, setContent] = useState<CmsPageContent | null>(null);
  const [selection, setSelection] = useState("page");
  const [device, setDevice] = useState<CmsPreviewDevice>("desktop");
  const [narrowPane, setNarrowPane] = useState<NarrowPane>("preview");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveTick, setSaveTick] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<CmsPageContent[]>([]);
  const [redoStack, setRedoStack] = useState<CmsPageContent[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [pendingDeleteSectionId, setPendingDeleteSectionId] = useState<
    string | null
  >(null);
  const contentRef = useRef<CmsPageContent | null>(null);
  const draftVersionRef = useRef(0);
  const lastSavedRef = useRef<CmsPageContent | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    draftVersionRef.current = editor?.draftVersion ?? 0;
  }, [editor?.draftVersion]);

  const getToken = useCallback(async () => {
    if (!user) throw new Error("not_authenticated");
    return user.getIdToken();
  }, [user]);

  const loadEditor = useCallback(
    async (activeUser: User) => {
      setState("loading");
      try {
        const token = await activeUser.getIdToken();
        const response = await fetch(
          `/api/admin/cms/pages/${encodeURIComponent(pageKey)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as CmsPageEditorApiResponse;
        if (!response.ok || !payload.ok) {
          setState(
            response.status === 401 || response.status === 403
              ? "denied"
              : "error",
          );
          return;
        }
        setEditor(payload.editor);
        setContent(cloneContent(payload.editor.content));
        lastSavedRef.current = cloneContent(payload.editor.content);
        setSelection(payload.editor.content.sections[0]?.id ?? "page");
        setUndoStack([]);
        setRedoStack([]);
        setSaveState("saved");
        setNotice(null);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [pageKey],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      if (!active) return;
      setUser(nextUser);
      if (!nextUser) {
        setState("denied");
        return;
      }
      void loadEditor(nextUser);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadEditor]);

  useEffect(() => {
    if (!editor) return;
    let active = true;
    Promise.all(
      editor.assets.map(async (asset) => {
        try {
          const blob = await getBlob(ref(getFirebaseStorage(), asset.storagePath));
          const url = URL.createObjectURL(blob);
          return [asset.assetId, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!active) return;
      setAssetUrls(
        Object.fromEntries(
          entries.filter(
            (entry): entry is readonly [string, string] => entry !== null,
          ),
        ),
      );
    });
    return () => {
      active = false;
      setAssetUrls((current) => {
        Object.values(current).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
    };
  }, [editor?.assets, editor]);

  const applyContent = useCallback((next: CmsPageContent) => {
    setContent((current) => {
      if (!current || sameContent(current, next)) return current;
      setUndoStack((history) => [...history.slice(-49), cloneContent(current)]);
      setRedoStack([]);
      setSaveState("dirty");
      return cloneContent(next);
    });
  }, []);

  const saveDraft = useCallback(
    async (manual = false): Promise<number | null> => {
      const snapshot = contentRef.current;
      if (!snapshot || !editor) return null;
      if (savingRef.current) {
        pendingSaveRef.current = true;
        return null;
      }
      if (
        lastSavedRef.current &&
        sameContent(snapshot, lastSavedRef.current)
      ) {
        setSaveState("saved");
        return draftVersionRef.current;
      }
      const parsed = cmsPageContentSchema.safeParse(snapshot);
      if (!parsed.success) {
        setSaveState("failed");
        setNotice(
          "입력한 내용을 저장하지 못했습니다. 비어 있는 필수 문구와 링크 주소, 고급 숫자 범위를 확인해 주세요. 수정하면 자동으로 다시 저장됩니다.",
        );
        return null;
      }
      savingRef.current = true;
      setSaveState("saving");
      try {
        const token = await getToken();
        const response = await fetch(
          `/api/admin/cms/pages/${encodeURIComponent(pageKey)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedVersion: draftVersionRef.current,
              content: parsed.data,
              theme: editor.theme,
            }),
          },
        );
        const payload = (await response.json()) as CmsPageEditorApiResponse;
        if (response.status === 409) {
          setSaveState("conflict");
          setNotice(
            "다른 관리자가 먼저 이 화면을 저장했습니다. 최신 내용을 다시 불러온 뒤 변경사항을 확인해 주세요.",
          );
          return null;
        }
        if (!response.ok || !payload.ok) throw new Error("save_failed");
        const savedSnapshot = cloneContent(parsed.data);
        lastSavedRef.current = savedSnapshot;
        draftVersionRef.current = payload.editor.draftVersion;
        setEditor(payload.editor);
        const latest = contentRef.current;
        setSaveState(
          latest && sameContent(latest, savedSnapshot) ? "saved" : "dirty",
        );
        setNotice(
          manual
            ? "초안을 저장했습니다. 고객 화면에는 게시하기 전까지 반영되지 않습니다."
            : null,
        );
        return payload.editor.draftVersion;
      } catch {
        setSaveState("failed");
        setNotice(
          "초안을 저장하지 못했습니다. 인터넷 연결을 확인하고 잠시 후 상단의 ‘저장’을 눌러 다시 시도해 주세요. 현재 입력 내용은 이 화면에 남아 있습니다.",
        );
        return null;
      } finally {
        savingRef.current = false;
        if (pendingSaveRef.current) {
          pendingSaveRef.current = false;
          setSaveState("dirty");
          setSaveTick((tick) => tick + 1);
        }
      }
    },
    [editor, getToken, pageKey],
  );

  useEffect(() => {
    if (state !== "ready" || saveState !== "dirty") return;
    const timer = window.setTimeout(() => void saveDraft(false), 1200);
    return () => window.clearTimeout(timer);
  }, [content, saveDraft, saveState, saveTick, state]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  const undo = useCallback(() => {
    setUndoStack((history) => {
      const previous = history.at(-1);
      if (!previous) return history;
      setContent((current) => {
        if (current) {
          setRedoStack((redo) => [...redo.slice(-49), cloneContent(current)]);
        }
        setSaveState("dirty");
        return cloneContent(previous);
      });
      return history.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((history) => {
      const next = history.at(-1);
      if (!next) return history;
      setContent((current) => {
        if (current) {
          setUndoStack((undoHistory) => [
            ...undoHistory.slice(-49),
            cloneContent(current),
          ]);
        }
        setSaveState("dirty");
        return cloneContent(next);
      });
      return history.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT"
      ) {
        return;
      }
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (
        event.key.toLowerCase() === "y" ||
        (event.key.toLowerCase() === "z" && event.shiftKey)
      ) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const updateSection = useCallback(
    (section: CmsSection) => {
      if (!contentRef.current) return;
      applyContent({
        ...contentRef.current,
        sections: contentRef.current.sections.map((candidate) =>
          candidate.id === section.id ? section : candidate,
        ),
      });
    },
    [applyContent],
  );

  const reorderSections = useCallback(
    (from: number, to: number) => {
      const current = contentRef.current;
      if (!current || from === to || to < 0 || to >= current.sections.length) {
        return;
      }
      const sections = [...current.sections];
      const [moved] = sections.splice(from, 1);
      sections.splice(to, 0, moved);
      applyContent({ ...current, sections });
    },
    [applyContent],
  );

  const addSection = useCallback(() => {
    const current = contentRef.current;
    if (!current || current.sections.length >= 50) {
      setNotice("화면 영역은 최대 50개까지 추가할 수 있습니다.");
      return;
    }
    const nextSection = createBlankCmsSection();
    applyContent({
      ...current,
      sections: [...current.sections, nextSection],
    });
    setSelection(nextSection.id);
    setNarrowPane("settings");
    setNotice("새 영역을 추가했습니다. 문구와 디자인을 입력한 뒤 게시해 주세요.");
  }, [applyContent]);

  const duplicateSection = useCallback(
    (sectionId: string) => {
      const current = contentRef.current;
      if (!current || current.sections.length >= 50) {
        setNotice("화면 영역은 최대 50개까지 추가할 수 있습니다.");
        return;
      }
      const sourceIndex = current.sections.findIndex(
        (section) => section.id === sectionId,
      );
      if (sourceIndex < 0) return;
      const nextSection = duplicateCmsSection(current.sections[sourceIndex]);
      const sections = [...current.sections];
      sections.splice(sourceIndex + 1, 0, nextSection);
      applyContent({ ...current, sections });
      setSelection(nextSection.id);
      setNarrowPane("settings");
      setNotice("영역을 복제했습니다. 필요한 문구를 수정한 뒤 게시해 주세요.");
    },
    [applyContent],
  );

  const softDeleteSection = useCallback(
    (sectionId: string) => {
      const current = contentRef.current;
      if (!current || !canSoftDeleteCmsSection(current, sectionId)) {
        setNotice("필수 영역이거나 마지막 남은 영역은 삭제할 수 없습니다.");
        return;
      }
      applyContent({
        ...current,
        sections: current.sections.map((section) =>
          section.id === sectionId
            ? { ...section, deleted: true, visible: false }
            : section,
        ),
      });
      const nextSelection =
        current.sections.find(
          (section) => section.id !== sectionId && !section.deleted,
        )?.id ?? "page";
      setSelection(nextSelection);
      setPendingDeleteSectionId(null);
      setNotice(
        "영역을 삭제하고 초안에 보관했습니다. 게시 전에 복원할 수 있습니다.",
      );
    },
    [applyContent],
  );

  const restoreSection = useCallback(
    (sectionId: string) => {
      const current = contentRef.current;
      if (!current) return;
      applyContent({
        ...current,
        sections: current.sections.map((section) =>
          section.id === sectionId
            ? { ...section, deleted: false, visible: true }
            : section,
        ),
      });
      setSelection(sectionId);
      setNarrowPane("settings");
      setNotice("삭제한 영역을 복원했습니다.");
    },
    [applyContent],
  );

  const uploadImage = useCallback(
    async (sectionId: string, file: File, alt: string) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size > 10 * 1024 * 1024) {
        setNotice(
          "이미지는 JPG, PNG, WebP, GIF 형식의 10MB 이하 파일만 사용할 수 있습니다.",
        );
        return;
      }
      if (!alt.trim()) {
        setNotice("이미지 설명을 먼저 입력해 주세요.");
        return;
      }
      setUploading(true);
      setNotice(null);
      try {
        const token = await getToken();
        const size = await readImageSize(file);
        const assetId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "jpg";
        const safeExtension = /^[a-z0-9]{2,5}$/.test(extension)
          ? extension
          : "jpg";
        const fileName = `image_${Date.now()}.${safeExtension}`;
        const storagePath = `cms/drafts/${assetId}/${fileName}`;
        await uploadBytes(ref(getFirebaseStorage(), storagePath), file, {
          contentType: file.type,
        });
        const finalizeResponse = await fetch("/api/admin/cms/assets/finalize", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assetId,
            storagePath,
            originalFileName: file.name,
            mimeType: file.type,
            byteSize: file.size,
            width: size.width,
            height: size.height,
            alt: alt.trim(),
          }),
        });
        if (!finalizeResponse.ok) throw new Error("finalize_failed");
        const imageBlob = await getBlob(ref(getFirebaseStorage(), storagePath));
        const url = URL.createObjectURL(imageBlob);
        setAssetUrls((current) => ({ ...current, [assetId]: url }));
        const current = contentRef.current;
        const section = current?.sections.find(
          (candidate) => candidate.id === sectionId,
        );
        if (section) {
          updateSection({
            ...section,
            media: {
              assetId,
              alt: alt.trim(),
              aspectRatio: "16:9",
            },
          });
        }
        setNotice(
          "이미지를 추가했습니다. 초안 저장 후 게시해야 고객 화면에 반영됩니다.",
        );
      } catch {
        setNotice(
          "이미지를 추가하지 못했습니다. 파일 크기와 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        );
      } finally {
        setUploading(false);
      }
    },
    [getToken, updateSection],
  );

  const restoreRevision = useCallback(
    async (revisionId: string) => {
      if (!editor || !user) return;
      setRestoring(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/admin/cms/pages/${encodeURIComponent(pageKey)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedDraftVersion: draftVersionRef.current,
            }),
          },
        );
        const payload = (await response.json()) as CmsPageEditorApiResponse;
        if (response.status === 409) {
          setSaveState("conflict");
          setNotice(
            "다른 관리자가 먼저 초안을 변경했습니다. 최신 내용을 다시 불러와 주세요.",
          );
          return;
        }
        if (!response.ok || !payload.ok) throw new Error("restore_failed");
        setEditor(payload.editor);
        setContent(cloneContent(payload.editor.content));
        lastSavedRef.current = cloneContent(payload.editor.content);
        setUndoStack([]);
        setRedoStack([]);
        setSaveState("saved");
        setShowHistory(false);
        setNotice(
          "이전 게시 버전을 새 초안으로 복원했습니다. 내용을 확인한 뒤 게시해 주세요.",
        );
      } catch {
        setNotice(
          "이전 버전을 복원하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        );
      } finally {
        setRestoring(false);
      }
    },
    [editor, pageKey, user],
  );

  const openPublish = useCallback(async () => {
    const version = await saveDraft(true);
    if (version === null) return;
    setShowPublish(true);
  }, [saveDraft]);

  const publish = useCallback(async () => {
    if (!editor || !contentRef.current) return;
    const issues = validatePageContentForPublish(
      contentRef.current,
      pageKey,
    );
    if (issues.some((issue) => issue.severity === "error")) return;
    setPublishing(true);
    try {
      const token = await getToken();
      const response = await fetch(
        `/api/admin/cms/pages/${encodeURIComponent(pageKey)}/publish`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expectedDraftVersion: draftVersionRef.current,
          }),
        },
      );
      if (response.status === 409) {
        setSaveState("conflict");
        setNotice(
          "다른 관리자가 먼저 이 화면을 변경했습니다. 최신 내용을 다시 불러온 뒤 게시해 주세요.",
        );
        setShowPublish(false);
        return;
      }
      if (!response.ok) throw new Error("publish_failed");
      setShowPublish(false);
      setNotice("게시를 완료했습니다. 고객 화면에 현재 내용이 반영되었습니다.");
      if (user) await loadEditor(user);
    } catch {
      setNotice(
        "게시하지 못했습니다. 초안은 안전하게 저장되어 있습니다. 잠시 후 다시 게시해 주세요.",
      );
    } finally {
      setPublishing(false);
    }
  }, [editor, getToken, loadEditor, pageKey, user]);

  const issues = useMemo(
    () => (content ? validatePageContentForPublish(content, pageKey) : []),
    [content, pageKey],
  );
  const hasUnpublishedChanges =
    Boolean(editor?.hasUnpublishedChanges) ||
    saveState === "dirty" ||
    saveState === "saving";

  if (state !== "ready" || !editor || !content) {
    return (
      <EditorStatePanel
        state={state === "ready" ? "error" : state}
        onRetry={() => {
          if (user) void loadEditor(user);
        }}
      />
    );
  }

  return (
    <main className="cms-page-editor">
      <header className="cms-editor-topbar">
        <div className="cms-editor-topbar__identity">
          <Link href="/admin" aria-label="페이지 관리로 돌아가기">
            ←
          </Link>
          <div>
            <span>페이지 편집</span>
            <strong>{editor.pageName}</strong>
            <small>{editor.route}</small>
          </div>
          {hasUnpublishedChanges ? <em>미게시 변경</em> : null}
        </div>
        <div className="cms-editor-device-tabs" role="group" aria-label="미리보기 화면 크기">
          {(Object.keys(DEVICE_LABELS) as CmsPreviewDevice[]).map((value) => (
            <button
              className={device === value ? "is-selected" : ""}
              type="button"
              key={value}
              onClick={() => setDevice(value)}
              aria-pressed={device === value}
            >
              {DEVICE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="cms-editor-topbar__actions">
          <SaveStatus
            state={saveState}
            hasUnpublishedChanges={hasUnpublishedChanges}
          />
          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            title="실행 취소"
            aria-label="실행 취소"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoStack.length === 0}
            title="다시 실행"
            aria-label="다시 실행"
          >
            ↷
          </button>
          <button type="button" onClick={() => setShowCompare(true)}>
            비교
          </button>
          <button type="button" onClick={() => setShowHistory(true)}>
            이력
          </button>
          <button type="button" onClick={() => void saveDraft(true)}>
            저장
          </button>
          <button type="button" onClick={() => setShowPreview(true)}>
            미리보기
          </button>
          <button
            className="is-primary"
            type="button"
            onClick={() => void openPublish()}
            disabled={!hasUnpublishedChanges || saveState === "conflict"}
          >
            게시
          </button>
        </div>
      </header>

      {notice ? (
        <div
          className={`cms-editor-notice${saveState === "failed" || saveState === "conflict" ? " is-error" : ""}`}
          role={saveState === "failed" || saveState === "conflict" ? "alert" : "status"}
        >
          <p>{notice}</p>
          {saveState === "conflict" ? (
            <button type="button" onClick={() => void loadEditor(user!)}>
              최신 내용 다시 불러오기
            </button>
          ) : (
            <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기">
              ×
            </button>
          )}
        </div>
      ) : null}

      <div className="cms-editor-narrow-tabs" role="tablist" aria-label="편집기 화면 전환">
        {([
          ["sections", "영역 목록"],
          ["preview", "미리보기"],
          ["settings", "편집 설정"],
        ] as const).map(([value, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={narrowPane === value}
            className={narrowPane === value ? "is-selected" : ""}
            key={value}
            onClick={() => setNarrowPane(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cms-editor-workspace">
        <div
          className={`cms-editor-pane cms-editor-pane--sections${narrowPane === "sections" ? " is-narrow-active" : ""}`}
        >
          <CmsEditorSidebar
            pageName={editor.pageName}
            pageKey={pageKey}
            content={content}
            selection={selection}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
              setNarrowPane("settings");
            }}
            onReorderSections={reorderSections}
            onAddSection={addSection}
            onDuplicateSection={duplicateSection}
            onRequestDeleteSection={setPendingDeleteSectionId}
            onRestoreSection={restoreSection}
          />
        </div>
        <section
          className={`cms-editor-pane cms-editor-pane--preview${narrowPane === "preview" ? " is-narrow-active" : ""}`}
          aria-label="실시간 화면 미리보기"
        >
          <header>
            <div>
              <strong>실시간 미리보기</strong>
              <span>선택한 영역을 누르면 편집 설정이 열립니다.</span>
            </div>
            <span>{DEVICE_LABELS[device]}</span>
          </header>
          <div className={`cms-editor-preview-frame is-${device}`}>
            {pageKey === "home" ? (
              <HomePageRenderer
                content={content}
                globals={globals}
                assetUrls={assetUrls}
                mainId={null}
                editing
                selectedSectionId={
                  selection === "page" || selection === "messages"
                    ? undefined
                    : selection
                }
                onSelectSection={(sectionId) => {
                  setSelection(sectionId);
                  setNarrowPane("settings");
                }}
              />
            ) : pageKey === "event.auditQuoteGuide" ? (
              <AuditQuoteGuidePage
                content={content}
                previewMode
                mainId={null}
                editing
                selectedSectionId={
                  selection === "page" || selection === "messages"
                    ? undefined
                    : selection
                }
                onSelectSection={(sectionId) => {
                  setSelection(sectionId);
                  setNarrowPane("settings");
                }}
              />
            ) : pageKey === "event.auditQuote" ? (
              <AuditQuoteEventPage
                config={AUDIT_QUOTE_PREVIEW_CONFIG}
                content={content}
                previewMode
                mainId={null}
                editing
                selectedSectionId={
                  selection === "page" || selection === "messages"
                    ? undefined
                    : selection
                }
                onSelectSection={(sectionId) => {
                  setSelection(sectionId);
                  setNarrowPane("settings");
                }}
              />
            ) : (
              <CmsActualPagePreview
                pageKey={pageKey}
                content={content}
                device={device}
                selectedSectionId={
                  selection === "page" || selection === "messages"
                    ? undefined
                    : selection
                }
                assetUrls={assetUrls}
                editing
                onSelectSection={(sectionId) => {
                  setSelection(sectionId);
                  setNarrowPane("settings");
                }}
              />
            )}
          </div>
          <ValidationPanel
            issues={issues}
            onSelect={(sectionId) => {
              setSelection(sectionId);
              setNarrowPane("settings");
            }}
          />
        </section>
        <aside
          className={`cms-editor-pane cms-editor-pane--settings${narrowPane === "settings" ? " is-narrow-active" : ""}`}
          aria-label="선택한 영역 편집 설정"
        >
          <CmsEditorSettings
            content={content}
            pageKey={pageKey}
            selection={selection}
            device={device}
            uploading={uploading}
            onChangeContent={applyContent}
            onChangeSection={updateSection}
            onUploadImage={uploadImage}
          />
        </aside>
      </div>

      {showCompare ? (
        <CompareDialog
          before={editor.publishedContent}
          after={content}
          onClose={() => setShowCompare(false)}
        />
      ) : null}
      {showPreview ? (
        <PreviewDialog
          content={content}
          pageKey={pageKey}
          globals={globals}
          device={device}
          assetUrls={assetUrls}
          onClose={() => setShowPreview(false)}
        />
      ) : null}
      {showHistory ? (
        <HistoryDialog
          editor={editor}
          restoring={restoring}
          onRestore={restoreRevision}
          onClose={() => setShowHistory(false)}
        />
      ) : null}
      {showPublish ? (
        <PublishDialog
          editor={editor}
          issues={issues}
          publishing={publishing}
          onCompare={() => {
            setShowPublish(false);
            setShowCompare(true);
          }}
          onConfirm={publish}
          onClose={() => setShowPublish(false)}
        />
      ) : null}
      {pendingDeleteSectionId ? (
        <CmsEditorDialog
          className="cms-editor-dialog--small"
          labelledBy="cms-section-delete-title"
          onClose={() => setPendingDeleteSectionId(null)}
        >
          <header>
            <div>
              <span>화면 영역 삭제</span>
              <h2 id="cms-section-delete-title">
                {content.sections.find(
                  (section) => section.id === pendingDeleteSectionId,
                )?.title || "선택한 영역"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setPendingDeleteSectionId(null)}
              aria-label="삭제 확인 닫기"
            >
              ×
            </button>
          </header>
          <div className="cms-editor-dialog-copy">
            <p>
              게시하면 이 영역이 고객 화면에서 사라집니다. 삭제 후에도 게시
              전에는 초안에서 복원할 수 있습니다.
            </p>
          </div>
          <footer>
            <button
              type="button"
              onClick={() => setPendingDeleteSectionId(null)}
            >
              취소
            </button>
            <button
              className="is-danger"
              type="button"
              onClick={() => softDeleteSection(pendingDeleteSectionId)}
            >
              영역 삭제하고 보관
            </button>
          </footer>
        </CmsEditorDialog>
      ) : null}
    </main>
  );
}
