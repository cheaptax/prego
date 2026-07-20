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
import { CmsCommonAreaSettings } from "@/components/cms-editor/CmsCommonAreaSettings";
import { CmsEditorDialog } from "@/components/cms-editor/CmsEditorDialog";
import { HomePageRenderer } from "@/components/HomePageRenderer";
import { SupportWidget } from "@/components/SupportWidget";
import { CMS_GLOBAL_PRESENTATION } from "@/lib/cms/admin-console-presentation";
import {
  type CmsPublicGlobals,
} from "@/lib/cms/public-content";
import {
  CMS_PUBLIC_GLOBAL_KEYS,
  type CmsGlobalKey,
} from "@/lib/cms/constants";
import type {
  CmsGlobalEditorApiResponse,
  CmsGlobalEditorData,
} from "@/lib/cms/global-editor-types";
import {
  cmsGlobalContentSchema,
  type CmsGlobalContent,
} from "@/lib/cms/schemas";
import {
  getFirebaseAuth,
  getFirebaseStorage,
} from "@/lib/firebase/client";
import type { CmsPreviewDevice } from "@/components/cms-editor/CmsPageRenderer";

type LoadState = "loading" | "ready" | "denied" | "error";
type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";

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

function cloneContent(content: CmsGlobalContent) {
  return structuredClone(content);
}

function sameContent(left: CmsGlobalContent, right: CmsGlobalContent) {
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

function StatePanel({
  state,
  onRetry,
}: {
  state: Exclude<LoadState, "ready">;
  onRetry: () => void;
}) {
  return (
    <main
      className="cms-page-editor-state"
      role={state === "loading" ? "status" : "alert"}
    >
      {state === "loading" ? (
        <span className="cms-console-spinner" aria-hidden="true" />
      ) : null}
      <strong>
        {state === "loading"
          ? "공통 영역 편집기를 준비하고 있습니다."
          : state === "denied"
            ? "관리자 권한이 필요합니다."
            : "공통 영역을 불러오지 못했습니다."}
      </strong>
      <p>
        {state === "loading"
          ? "초안과 게시 내용을 안전하게 불러오는 중입니다."
          : state === "denied"
            ? "콘텐츠를 관리할 수 있는 계정으로 다시 로그인해 주세요."
            : "인터넷 연결을 확인한 뒤 다시 시도해 주세요. 공개 화면에는 영향이 없습니다."}
      </p>
      {state === "denied" ? (
        <Link href="/login">로그인 화면으로</Link>
      ) : state === "error" ? (
        <button type="button" onClick={onRetry}>
          다시 불러오기
        </button>
      ) : null}
    </main>
  );
}

export function CmsCommonAreaEditor({
  documentKey,
}: {
  documentKey: CmsGlobalKey;
}) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveTick, setSaveTick] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [editor, setEditor] = useState<CmsGlobalEditorData | null>(null);
  const [content, setContent] = useState<CmsGlobalContent | null>(null);
  const [device, setDevice] = useState<CmsPreviewDevice>("desktop");
  const [notice, setNotice] = useState<string | null>(null);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<CmsGlobalContent[]>([]);
  const [redoStack, setRedoStack] = useState<CmsGlobalContent[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    { type: "publish" } | { type: "restore"; revisionId: string } | null
  >(null);
  const contentRef = useRef<CmsGlobalContent | null>(null);
  const lastSavedRef = useRef<CmsGlobalContent | null>(null);
  const versionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const uploadedObjectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(
    () => () => {
      uploadedObjectUrlsRef.current.forEach((url) =>
        URL.revokeObjectURL(url),
      );
    },
    [],
  );

  const loadEditor = useCallback(
    async (activeUser: User) => {
      setLoadState("loading");
      try {
        const token = await activeUser.getIdToken();
        const response = await fetch(
          `/api/admin/cms/globals/${encodeURIComponent(documentKey)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as CmsGlobalEditorApiResponse;
        if (!response.ok || !payload.ok) {
          setLoadState(
            response.status === 401 || response.status === 403
              ? "denied"
              : "error",
          );
          return;
        }
        setEditor(payload.editor);
        setContent(cloneContent(payload.editor.content));
        lastSavedRef.current = cloneContent(payload.editor.content);
        versionRef.current = payload.editor.draftVersion;
        setUndoStack([]);
        setRedoStack([]);
        setSaveState("saved");
        pendingSaveRef.current = false;
        setNotice(null);
        setLoadState("ready");
      } catch {
        setLoadState("error");
      }
    },
    [documentKey],
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setLoadState("denied");
        return;
      }
      void loadEditor(nextUser);
    });
    return unsubscribe;
  }, [loadEditor]);

  useEffect(() => {
    if (!editor) return;
    let active = true;
    const createdUrls: string[] = [];
    Promise.all(
      editor.assets.map(async (asset) => {
        try {
          const blob = await getBlob(
            ref(getFirebaseStorage(), asset.storagePath),
          );
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
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
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [editor]);

  const applyContent = useCallback((next: CmsGlobalContent) => {
    setContent((current) => {
      if (!current || sameContent(current, next)) return current;
      setUndoStack((history) => [...history.slice(-49), cloneContent(current)]);
      setRedoStack([]);
      setSaveState("dirty");
      return cloneContent(next);
    });
  }, []);

  const saveDraft = useCallback(
    async (manual = false) => {
      const snapshot = contentRef.current;
      if (!snapshot || !editor || !user) return null;
      if (savingRef.current) {
        pendingSaveRef.current = true;
        return null;
      }
      if (lastSavedRef.current && sameContent(snapshot, lastSavedRef.current)) {
        setSaveState("saved");
        return versionRef.current;
      }
      const parsed = cmsGlobalContentSchema.safeParse(snapshot);
      if (!parsed.success) {
        setSaveState("failed");
        setNotice(
          "필수 문구와 연결 주소를 확인해 주세요. 수정하면 자동으로 다시 저장됩니다.",
        );
        return null;
      }
      savingRef.current = true;
      setSaveState("saving");
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/admin/cms/globals/${encodeURIComponent(documentKey)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedVersion: versionRef.current,
              content: parsed.data,
            }),
          },
        );
        const payload = (await response.json()) as CmsGlobalEditorApiResponse;
        if (response.status === 409) {
          setSaveState("conflict");
          setNotice(
            "다른 관리자가 먼저 이 공통 영역을 저장했습니다. 최신 내용을 다시 불러와 주세요.",
          );
          return null;
        }
        if (!response.ok || !payload.ok) throw new Error("save_failed");
        versionRef.current = payload.editor.draftVersion;
        lastSavedRef.current = cloneContent(parsed.data);
        setEditor(payload.editor);
        setSaveState(
          contentRef.current &&
            sameContent(contentRef.current, parsed.data)
            ? "saved"
            : "dirty",
        );
        if (manual) {
          setNotice(
            "초안을 저장했습니다. 게시하기 전에는 고객 화면에 반영되지 않습니다.",
          );
        }
        return payload.editor.draftVersion;
      } catch {
        setSaveState("failed");
        setNotice(
          "초안을 저장하지 못했습니다. 인터넷 연결을 확인한 뒤 상단의 저장을 다시 눌러 주세요.",
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
    [documentKey, editor, user],
  );

  useEffect(() => {
    if (loadState !== "ready" || saveState !== "dirty") return;
    const timer = window.setTimeout(() => void saveDraft(false), 1200);
    return () => window.clearTimeout(timer);
  }, [content, loadState, saveDraft, saveState, saveTick]);

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

  const uploadLogo = useCallback(
    async (file: File, alt: string) => {
      if (
        !user ||
        !ALLOWED_IMAGE_TYPES.has(file.type) ||
        file.size > 10 * 1024 * 1024
      ) {
        setNotice(
          "로고는 JPG, PNG, WebP, GIF 형식의 10MB 이하 파일만 사용할 수 있습니다.",
        );
        return;
      }
      setUploading(true);
      try {
        const token = await user.getIdToken();
        const size = await readImageSize(file);
        const assetId = `logo_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "png";
        const safeExtension = /^[a-z0-9]{2,5}$/.test(extension)
          ? extension
          : "png";
        const storagePath = `cms/drafts/${assetId}/logo_${Date.now()}.${safeExtension}`;
        await uploadBytes(ref(getFirebaseStorage(), storagePath), file, {
          contentType: file.type,
        });
        const response = await fetch("/api/admin/cms/assets/finalize", {
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
            alt,
          }),
        });
        if (!response.ok) throw new Error("finalize_failed");
        const blob = await getBlob(ref(getFirebaseStorage(), storagePath));
        const objectUrl = URL.createObjectURL(blob);
        uploadedObjectUrlsRef.current.push(objectUrl);
        setAssetUrls((current) => ({ ...current, [assetId]: objectUrl }));
        if (contentRef.current) {
          applyContent({
            ...contentRef.current,
            sections: contentRef.current.sections.map((section) =>
              section.id === "brand"
                ? {
                    ...section,
                    media: { assetId, alt, aspectRatio: "auto" },
                  }
                : section,
            ),
          });
        }
        setNotice(
          "로고 이미지를 추가했습니다. 저장 후 게시해야 모든 화면에 반영됩니다.",
        );
      } catch {
        setNotice(
          "로고 이미지를 추가하지 못했습니다. 파일과 인터넷 연결을 확인해 주세요.",
        );
      } finally {
        setUploading(false);
      }
    },
    [applyContent, user],
  );

  const openPublish = useCallback(async () => {
    let version = await saveDraft(true);
    if (
      version !== null &&
      contentRef.current &&
      lastSavedRef.current &&
      !sameContent(contentRef.current, lastSavedRef.current)
    ) {
      version = await saveDraft(true);
    }
    if (
      version !== null &&
      contentRef.current &&
      lastSavedRef.current &&
      sameContent(contentRef.current, lastSavedRef.current)
    ) {
      setConfirmAction({ type: "publish" });
    }
  }, [saveDraft]);

  const publish = useCallback(async () => {
    if (!user) return;
    setPublishing(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/admin/cms/globals/${encodeURIComponent(documentKey)}/publish`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ expectedDraftVersion: versionRef.current }),
        },
      );
      if (response.status === 409) {
        setSaveState("conflict");
        setNotice(
          "다른 관리자가 먼저 변경했습니다. 최신 내용을 다시 불러와 주세요.",
        );
        return;
      }
      if (!response.ok) throw new Error("publish_failed");
      await loadEditor(user);
      setNotice("공통 영역 게시를 완료했습니다.");
    } catch {
      setNotice(
        "게시하지 못했습니다. 초안은 저장되어 있으므로 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setPublishing(false);
    }
  }, [documentKey, loadEditor, user]);

  const restore = useCallback(
    async (revisionId: string) => {
      if (!user || !editor) return;
      setRestoring(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/admin/cms/globals/${encodeURIComponent(documentKey)}/revisions/${encodeURIComponent(revisionId)}/restore`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expectedDraftVersion: versionRef.current,
            }),
          },
        );
        const payload = (await response.json()) as CmsGlobalEditorApiResponse;
        if (response.status === 409) {
          setSaveState("conflict");
          setNotice(
            "다른 관리자가 먼저 초안을 변경했습니다. 최신 내용을 다시 불러온 뒤 복원할 버전을 다시 선택해 주세요.",
          );
          return;
        }
        if (!response.ok || !payload.ok) throw new Error("restore_failed");
        setEditor(payload.editor);
        setContent(cloneContent(payload.editor.content));
        lastSavedRef.current = cloneContent(payload.editor.content);
        versionRef.current = payload.editor.draftVersion;
        setSaveState("saved");
        setShowHistory(false);
        setNotice(
          "이전 게시 버전을 새 초안으로 복원했습니다. 확인 후 게시해 주세요.",
        );
      } catch {
        setNotice("이전 버전을 복원하지 못했습니다. 다시 시도해 주세요.");
      } finally {
        setRestoring(false);
      }
    },
    [documentKey, editor, user],
  );

  const previewGlobals = useMemo(() => {
    if (!editor || !content) return null;
    return {
      ...editor.previewGlobals,
      [documentKey]: content,
    } as CmsPublicGlobals;
  }, [content, documentKey, editor]);

  if (loadState !== "ready" || !editor || !content || !previewGlobals) {
    return (
      <StatePanel
        state={loadState === "ready" ? "error" : loadState}
        onRetry={() => {
          if (user) void loadEditor(user);
        }}
      />
    );
  }

  const hasChanges =
    editor.hasUnpublishedChanges ||
    saveState === "dirty" ||
    saveState === "saving";
  const compareChanges = [
    JSON.stringify(editor.publishedContent.text) !== JSON.stringify(content.text)
      ? "문구"
      : null,
    JSON.stringify(editor.publishedContent.links) !==
    JSON.stringify(content.links)
      ? "버튼·링크"
      : null,
    JSON.stringify(editor.publishedContent.navigation) !==
    JSON.stringify(content.navigation)
      ? "상단 메뉴와 순서"
      : null,
    JSON.stringify(editor.publishedContent.sections) !==
    JSON.stringify(content.sections)
      ? "이미지·영역"
      : null,
    JSON.stringify(editor.publishedContent.theme) !== JSON.stringify(content.theme)
      ? "디자인"
      : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <main className="cms-page-editor cms-common-editor">
      <header className="cms-editor-topbar">
        <div className="cms-editor-topbar__identity">
          <Link href="/admin" aria-label="공통 영역 관리로 돌아가기">
            ←
          </Link>
          <div>
            <span>공통 영역 편집</span>
            <strong>{editor.name}</strong>
            <small>{editor.affectedArea}</small>
          </div>
          {hasChanges ? <em>미게시 변경</em> : null}
        </div>
        <div className="cms-editor-device-tabs" role="group" aria-label="미리보기 화면 크기">
          {(Object.keys(DEVICE_LABELS) as CmsPreviewDevice[]).map((value) => (
            <button
              type="button"
              className={device === value ? "is-selected" : ""}
              key={value}
              onClick={() => setDevice(value)}
              aria-pressed={device === value}
            >
              {DEVICE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="cms-editor-topbar__actions">
          <span className={`cms-editor-save-state is-${saveState}`} role="status">
            <i aria-hidden="true" />
            {saveState === "saved"
              ? "초안 저장됨"
              : saveState === "dirty"
                ? "저장 대기 중"
                : saveState === "saving"
                  ? "저장 중…"
                  : saveState === "conflict"
                    ? "다른 관리자 변경 발견"
                    : "저장하지 못함"}
          </span>
          <button type="button" onClick={undo} disabled={undoStack.length === 0}>
            실행 취소
          </button>
          <button type="button" onClick={redo} disabled={redoStack.length === 0}>
            다시 실행
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
          <button
            className="is-primary"
            type="button"
            disabled={!hasChanges || publishing || saveState === "conflict"}
            onClick={() => void openPublish()}
          >
            {publishing ? "게시 중…" : "게시"}
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

      <div className="cms-common-editor__workspace">
        <aside className="cms-common-editor__nav" aria-label="공통 영역 목록">
          <header>
            <span>여러 화면에 함께 적용</span>
            <h2>공통 영역</h2>
          </header>
          <nav>
            {CMS_PUBLIC_GLOBAL_KEYS.map((key) => (
              <Link
                className={key === documentKey ? "is-selected" : ""}
                key={key}
                href={`/admin/globals/${key}`}
                aria-current={key === documentKey ? "page" : undefined}
              >
                <strong>{CMS_GLOBAL_PRESENTATION[key].name}</strong>
                <small>{CMS_GLOBAL_PRESENTATION[key].affectedArea}</small>
              </Link>
            ))}
          </nav>
          <p>
            공통 영역을 게시하면 이를 사용하는 모든 화면에 반영됩니다. 게시 전
            PC와 모바일을 모두 확인해 주세요.
          </p>
        </aside>
        <section className="cms-editor-pane--preview cms-common-preview">
          <header>
            <div>
              <strong>실제 메인 화면 미리보기</strong>
              <span>현재 초안이 모든 공통 영역과 함께 표시됩니다.</span>
            </div>
            <span>{DEVICE_LABELS[device]}</span>
          </header>
          <div className={`cms-editor-preview-frame is-${device}`}>
            <HomePageRenderer
              content={editor.previewPageContent}
              globals={previewGlobals}
              assetUrls={assetUrls}
              mainId={null}
            />
            <SupportWidget content={previewGlobals.support} />
          </div>
        </section>
        <aside className="cms-editor-pane--settings">
          <CmsCommonAreaSettings
            documentKey={documentKey}
            content={content}
            uploading={uploading}
            onChange={applyContent}
            onUploadLogo={uploadLogo}
          />
        </aside>
      </div>

      {showCompare ? (
        <CmsEditorDialog
          labelledBy="cms-common-compare-title"
          onClose={() => setShowCompare(false)}
        >
            <header>
              <div>
                <span>변경 전후 비교</span>
                <h2 id="cms-common-compare-title">{editor.name}</h2>
              </div>
              <button type="button" onClick={() => setShowCompare(false)} aria-label="비교 닫기">
                ×
              </button>
            </header>
            <p className="cms-editor-dialog-note">
              {compareChanges.length > 0
                ? `바뀐 항목: ${compareChanges.join(" · ")}`
                : "게시 내용과 현재 초안이 같습니다."}
            </p>
            <div className="cms-common-compare">
              <section>
                <strong>현재 게시 내용</strong>
                {Object.values(editor.publishedContent.text).map((value, index) => (
                  <p key={`${value}-${index}`}>{value}</p>
                ))}
              </section>
              <section>
                <strong>편집 중인 초안</strong>
                {Object.values(content.text).map((value, index) => (
                  <p key={`${value}-${index}`}>{value}</p>
                ))}
              </section>
            </div>
            <footer>
              <button type="button" onClick={() => setShowCompare(false)}>
                확인
              </button>
            </footer>
        </CmsEditorDialog>
      ) : null}

      {showHistory ? (
        <CmsEditorDialog
          labelledBy="cms-common-history-title"
          onClose={() => setShowHistory(false)}
          closeDisabled={restoring}
        >
            <header>
              <div>
                <span>수정·게시 이력</span>
                <h2 id="cms-common-history-title">{editor.name}</h2>
              </div>
              <button type="button" onClick={() => setShowHistory(false)} aria-label="이력 닫기">
                ×
              </button>
            </header>
            {editor.revisions.length === 0 ? (
              <div className="cms-editor-dialog-empty">
                <strong>아직 게시 이력이 없습니다.</strong>
              </div>
            ) : (
              <ol className="cms-editor-history-list">
                {editor.revisions.map((revision) => (
                  <li key={revision.id}>
                    <div>
                      <strong>게시 버전 {revision.version}</strong>
                      <span>{formatDate(revision.createdAt)}</span>
                    </div>
                    <button
                      type="button"
                      disabled={restoring}
                      onClick={() =>
                        setConfirmAction({
                          type: "restore",
                          revisionId: revision.id,
                        })
                      }
                    >
                      초안으로 복원
                    </button>
                  </li>
                ))}
              </ol>
            )}
        </CmsEditorDialog>
      ) : null}
      {confirmAction ? (
        <CmsEditorDialog
          className="cms-editor-dialog--small"
          labelledBy="cms-common-confirm-title"
          onClose={() => setConfirmAction(null)}
          closeDisabled={publishing || restoring}
        >
            <header>
              <div>
                <span>
                  {confirmAction.type === "publish"
                    ? "공통 영역 게시"
                    : "이전 버전 복원"}
                </span>
                <h2 id="cms-common-confirm-title">
                  {confirmAction.type === "publish"
                    ? `${editor.name}을 게시할까요?`
                    : "이 게시 버전을 새 초안으로 복원할까요?"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                aria-label="확인 창 닫기"
              >
                ×
              </button>
            </header>
            <div className="cms-editor-dialog-copy">
              <p>
                {confirmAction.type === "publish"
                  ? `게시하면 ${CMS_GLOBAL_PRESENTATION[documentKey].affectedArea}에 이 변경이 적용됩니다.`
                  : "복원은 현재 공개 화면을 바꾸지 않고 선택한 게시 버전을 새 초안으로 만듭니다."}
              </p>
            </div>
            <footer>
              <button type="button" onClick={() => setConfirmAction(null)}>
                취소
              </button>
              <button
                className="is-primary"
                type="button"
                disabled={publishing || restoring}
                onClick={() => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  if (action.type === "publish") {
                    void publish();
                  } else {
                    void restore(action.revisionId);
                  }
                }}
              >
                {confirmAction.type === "publish" ? "게시" : "초안으로 복원"}
              </button>
            </footer>
        </CmsEditorDialog>
      ) : null}
    </main>
  );
}
