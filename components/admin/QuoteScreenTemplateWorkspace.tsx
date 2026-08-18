"use client";

import { onAuthStateChanged } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logoutPortalSession } from "@/lib/auth/login-client";
import {
  createAdminOperationsCopy,
  type AdminOperationsCopy,
} from "@/lib/cms/admin-operations-content";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { QUOTE_DOCUMENT_COPY_KEYS } from "@/lib/quotes/quote-document-content";
import {
  DEFAULT_QUOTE_SCREEN_SECTIONS,
  DEFAULT_QUOTE_SCREEN_THEME,
  QUOTE_SCREEN_LAYOUT_FAMILIES,
  QUOTE_SCREEN_SECTIONS,
  recommendedQuoteLayoutFamily,
  type QuoteScreenLayoutFamily,
  type QuoteScreenSectionConfig,
  type QuoteScreenTheme,
} from "@/lib/quotes/quote-screen-profile";

type PartnerListItem = {
  id: string;
  name: string;
  displayName: string;
  contactEmail: string;
  status: string;
  hasDraft: boolean;
  hasPublished: boolean;
  publishedVersion: number | null;
  publishedAt: string | null;
};

type TemplatePayload = {
  layoutFamily: QuoteScreenLayoutFamily;
  sections: QuoteScreenSectionConfig[];
  copy: Record<string, string>;
  theme: QuoteScreenTheme;
};

const FIELD_LABELS: Record<string, string> = {
  auditTitleTemplate: "외부회계감사 제목 형식",
  generalTitleTemplate: "일반 견적서 제목 형식",
  recipientTemplate: "수신자 이름 형식",
  quoteIntro: "견적 표 상단 문구",
  footerStatement: "하단 신뢰/면책 문구",
  thankYouStatement: "하단 인사",
  evaluationFactsHelp: "제휴사 평가정보 안내",
  comparisonQrHelp: "비교 보고서 QR 안내",
  emailSubjectTemplate: "견적 도착 이메일 제목",
  emailArrivalTemplate: "견적 도착 이메일 첫 문장",
};

const LAYOUT_FAMILY_LABELS: Record<QuoteScreenLayoutFamily, string> = {
  classicNavy: "기본 네이비",
  formalCentered: "정식 중앙형",
  compactLedger: "장부형",
  letterheadLeft: "레터헤드 (로고 강조)",
  evaluationFirst: "카드형",
};

const FOCUS_COPY_KEYS = [
  "auditTitleTemplate",
  "generalTitleTemplate",
  "recipientTemplate",
  "quoteIntro",
  "footerStatement",
  "thankYouStatement",
  "evaluationFactsHelp",
  "comparisonQrHelp",
  "emailSubjectTemplate",
  "emailArrivalTemplate",
];

function emptyTemplate(
  partner?: Pick<PartnerListItem, "name" | "displayName">,
): TemplatePayload {
  return {
    layoutFamily: recommendedQuoteLayoutFamily(partner) ?? "classicNavy",
    sections: DEFAULT_QUOTE_SCREEN_SECTIONS,
    copy: {},
    theme: DEFAULT_QUOTE_SCREEN_THEME,
  };
}

const API_ERROR_COPY: Record<string, string> = {
  partner_not_found: "선택한 회계법인을 찾을 수 없습니다.",
  invalid_quote_screen_profile:
    "템플릿 내용이 올바르지 않습니다. 색상과 영역을 다시 확인해 주세요.",
  draft_not_found: "게시할 초안이 없습니다. 먼저 초안을 저장해 주세요.",
  request_failed: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  load_failed: "견적서 템플릿을 불러오지 못했습니다.",
  profile_load_failed: "선택한 법인의 템플릿을 불러오지 못했습니다.",
  save_failed: "초안을 저장하지 못했습니다.",
  publish_failed: "템플릿을 게시하지 못했습니다.",
  preview_failed: "견적서 미리보기를 만들지 못했습니다.",
};

const AUTH_ERROR_CODES = new Set([
  "auth_required",
  "missing_token",
  "invalid_token",
]);

const DENIED_ERROR_CODES = new Set([
  "permission_denied",
  "inactive_account",
  "profile_not_found",
]);

function errorCode(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function errorCopy(
  error: unknown,
  fallback: string,
  copy?: AdminOperationsCopy,
) {
  const code = errorCode(error);
  if (copy && AUTH_ERROR_CODES.has(code)) return copy.message("authRequired");
  if (copy && DENIED_ERROR_CODES.has(code)) {
    return copy.message("deniedDescription");
  }
  return API_ERROR_COPY[code] || fallback;
}

async function adminFetch(
  path: string,
  init?: RequestInit & { expect?: "json" | "blob" },
) {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("auth_required");
  const idToken = await user.getIdToken();
  const { expect, ...requestInit } = init ?? {};
  const res = await fetch(path, {
    ...requestInit,
    headers: {
      ...(requestInit.headers ?? {}),
      authorization: `Bearer ${idToken}`,
      ...(requestInit.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(
      data?.error ?? (res.status >= 500 ? "preview_failed" : "request_failed"),
    );
  }
  if (expect === "blob" || res.headers.get("content-type")?.includes("application/pdf")) {
    const buffer = await res.arrayBuffer();
    return new Blob([buffer], { type: "application/pdf" });
  }
  return res.json();
}

export function QuoteScreenTemplateWorkspace({
  content,
}: {
  content: CmsPageContent;
}) {
  const router = useRouter();
  const copy = useMemo(() => createAdminOperationsCopy(content), [content]);
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [template, setTemplate] = useState<TemplatePayload>(emptyTemplate);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [templateReady, setTemplateReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const previewRequestId = useRef(0);
  const previewedPartnerId = useRef("");
  const previewAbort = useRef<AbortController | null>(null);

  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.id === selectedPartnerId) ?? null,
    [partners, selectedPartnerId],
  );

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
      if (!active) return;
      if (!user) {
        setState("denied");
        setMessage(copy.message("authRequired"));
        router.push("/admin/login");
        return;
      }
      try {
        const token = await user.getIdTokenResult(true);
        if (token.claims.admin !== true) {
          setState("denied");
          setMessage(copy.message("deniedDescription"));
          return;
        }
        const data = await adminFetch("/api/admin/quote-screens");
        if (!active) return;
        const list = (data.partners ?? []) as PartnerListItem[];
        setPartners(list);
        setSelectedPartnerId((current) => current || list[0]?.id || "");
        setState("ready");
      } catch (error) {
        if (!active) return;
        const code = errorCode(error) || "load_failed";
        if (AUTH_ERROR_CODES.has(code) || DENIED_ERROR_CODES.has(code)) {
          setState("denied");
          setMessage(errorCopy(error, copy.message("deniedDescription"), copy));
          return;
        }
        setState("error");
        setMessage(errorCopy(error, copy.message("genericError"), copy));
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [copy, router]);

  useEffect(() => {
    if (!selectedPartnerId) return;
    let active = true;
    const selected = partners.find((partner) => partner.id === selectedPartnerId);
    const useDefaultTemplate = Boolean(
      selected && !selected.hasDraft && !selected.hasPublished,
    );
    setTemplate(emptyTemplate(selected));
    setTemplateReady(useDefaultTemplate);
    previewedPartnerId.current = "";
    setPreviewStatus("loading");
    setPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    adminFetch(`/api/admin/quote-screens/${selectedPartnerId}`)
      .then((data) => {
        if (!active) return;
        const profile = data.profile?.draft ?? data.profile?.published;
        setTemplate({
          ...emptyTemplate(selected),
          ...(profile
            ? {
                layoutFamily: profile.layoutFamily,
                sections: profile.sections,
                copy: profile.copy ?? {},
                theme: profile.theme,
              }
            : {}),
        });
        setTemplateReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setTemplateReady(false);
        setPreviewStatus("error");
        setMessage(
          errorCopy(error, API_ERROR_COPY.profile_load_failed, copy),
        );
      });
    return () => {
      active = false;
    };
  }, [copy, partners, selectedPartnerId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refreshPreview = useCallback(async (nextTemplate: TemplatePayload) => {
    if (!selectedPartnerId) return;
    const requestId = ++previewRequestId.current;
    previewAbort.current?.abort();
    const controller = new AbortController();
    previewAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setPreviewStatus("loading");
    try {
      const blob = (await adminFetch(
        `/api/admin/quote-screens/${selectedPartnerId}/preview`,
        {
          method: "POST",
          body: JSON.stringify(nextTemplate),
          signal: controller.signal,
          expect: "blob",
        },
      )) as Blob;
      if (requestId !== previewRequestId.current) return;
      const url = URL.createObjectURL(blob);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return url;
      });
      previewedPartnerId.current = selectedPartnerId;
      setPreviewStatus("ready");
    } catch (error) {
      if (requestId !== previewRequestId.current) return;
      setPreviewStatus("error");
      setMessage(
        errorCopy(
          error instanceof DOMException && error.name === "AbortError"
            ? new Error("preview_failed")
            : error,
          API_ERROR_COPY.preview_failed,
          copy,
        ),
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }, [copy, selectedPartnerId]);

  useEffect(() => {
    if (state !== "ready" || !selectedPartnerId || !templateReady) return;
    const delay =
      previewedPartnerId.current === selectedPartnerId ? 700 : 0;
    const timer = window.setTimeout(() => {
      void refreshPreview(template);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshPreview, selectedPartnerId, state, template, templateReady]);

  async function saveDraft() {
    if (!selectedPartnerId) return;
    setSaving(true);
    try {
      await adminFetch(`/api/admin/quote-screens/${selectedPartnerId}`, {
        method: "PUT",
        body: JSON.stringify(template),
      });
      setMessage("초안을 저장했습니다.");
      await refreshPreview(template);
    } catch (error) {
      setMessage(errorCopy(error, API_ERROR_COPY.save_failed, copy));
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (!selectedPartnerId) return;
    setSaving(true);
    try {
      await saveDraft();
      await adminFetch(`/api/admin/quote-screens/${selectedPartnerId}`, {
        method: "POST",
      });
      setMessage("게시했습니다. 이후 자동 발송 견적서에 적용됩니다.");
    } catch (error) {
      setMessage(errorCopy(error, API_ERROR_COPY.publish_failed, copy));
    } finally {
      setSaving(false);
    }
  }

  const updateSection = (
    id: QuoteScreenSectionConfig["id"],
    patch: Partial<QuoteScreenSectionConfig>,
  ) => {
    setTemplate((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === id ? { ...section, ...patch } : section,
      ),
    }));
  };

  if (state === "loading") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <div className="admin-state__spinner" aria-hidden="true" />
          <h2>{copy.message("loading")}</h2>
          <p>{copy.message("loadingDescription")}</p>
        </div>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="admin-state">
        <div className="admin-state__card">
          <h2>{copy.message("denied")}</h2>
          <p>{message || copy.message("deniedDescription")}</p>
          <div className="admin-actions">
            <Link className="admin-btn" href="/admin/operations">
              운영 화면으로 돌아가기
            </Link>
            <button
              className="admin-btn admin-btn--primary"
              type="button"
              onClick={() =>
                logoutPortalSession().then(() => router.push("/admin/login"))
              }
            >
              {copy.message("loginAgain")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="admin-state">
        <div className="admin-state__card admin-state__card--error">
          <h2>{copy.message("genericError")}</h2>
          <p>{message || copy.message("genericError")}</p>
          <button
            className="admin-btn"
            type="button"
            onClick={() => window.location.reload()}
          >
            {copy.message("retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="admin-shell quote-screen-template">
      <aside className="admin-card">
        <header className="admin-card__head">
          <div>
            <h1>법인별 견적서 템플릿</h1>
            <p>자동 발송 PDF가 회계법인마다 독립적으로 보이도록 관리합니다.</p>
          </div>
          <Link className="admin-btn admin-btn--ghost" href="/admin/operations">
            운영 화면으로
          </Link>
        </header>
        <div className="admin-list">
          {partners.map((partner) => (
            <button
              key={partner.id}
              type="button"
              className={`admin-list__item${partner.id === selectedPartnerId ? " is-active" : ""}`}
              onClick={() => setSelectedPartnerId(partner.id)}
            >
              <strong>{partner.displayName || partner.name}</strong>
              <span>
                {partner.hasPublished
                  ? `게시 v${partner.publishedVersion}`
                  : partner.hasDraft
                    ? "초안 있음"
                    : "기본 양식"}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="admin-card admin-card--span-2">
        <header className="admin-card__head">
          <div>
            <h2>{selectedPartner?.displayName || "법인 선택"}</h2>
            <p>{selectedPartner?.contactEmail}</p>
          </div>
          <button
            type="button"
            className="admin-button admin-button--ghost"
            onClick={() => void refreshPreview(template)}
            disabled={!selectedPartnerId || saving || previewStatus === "loading"}
          >
            {previewStatus === "loading"
              ? "미리보기 만드는 중"
              : "미리보기 다시 만들기"}
          </button>
        </header>
        <div className="quote-screen-preview-frame">
          {previewUrl ? (
            <iframe
              title="견적서 템플릿 미리보기"
              src={`${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
              className="partner-quote-preview"
            />
          ) : null}
          {previewStatus === "loading" ? (
            <div
              className={`quote-screen-preview-status${previewUrl ? " is-overlay" : ""}`}
            >
              <div className="admin-state__spinner" aria-hidden="true" />
              <p>샘플 견적서 PDF를 만들고 있습니다.</p>
              <p>첫 미리보기는 글꼴을 준비하느라 몇 초 걸릴 수 있습니다.</p>
            </div>
          ) : null}
          {previewStatus === "error" && !previewUrl ? (
            <div className="quote-screen-preview-status quote-screen-preview-status--error">
              <p>{message || API_ERROR_COPY.preview_failed}</p>
              <button
                type="button"
                className="admin-btn"
                onClick={() => void refreshPreview(template)}
              >
                다시 시도
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="admin-card">
        <header className="admin-card__head">
          <div>
            <h2>편집</h2>
            <p>필수 영역은 숨길 수 없습니다.</p>
          </div>
        </header>

        <label className="admin-field">
          <span>레이아웃 패밀리</span>
          <select
            value={template.layoutFamily}
            onChange={(event) =>
              setTemplate((current) => ({
                ...current,
                layoutFamily: event.target.value as QuoteScreenLayoutFamily,
              }))
            }
          >
            {QUOTE_SCREEN_LAYOUT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {LAYOUT_FAMILY_LABELS[family]}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-stack">
          <h3>구성요소</h3>
          {template.sections.map((section) => {
            const meta = QUOTE_SCREEN_SECTIONS.find((item) => item.id === section.id);
            return (
              <fieldset key={section.id} className="admin-fieldset">
                <legend>{meta?.label ?? section.id}</legend>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={section.visible}
                    disabled={meta?.required}
                    onChange={(event) =>
                      updateSection(section.id, { visible: event.target.checked })
                    }
                  />
                  표시 {meta?.required ? "(필수)" : ""}
                </label>
                <label className="admin-field">
                  <span>순서</span>
                  <input
                    type="number"
                    value={section.order}
                    onChange={(event) =>
                      updateSection(section.id, {
                        order: Number(event.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="admin-field">
                  <span>제목 덮어쓰기</span>
                  <input
                    value={section.titleOverride ?? ""}
                    onChange={(event) =>
                      updateSection(section.id, {
                        titleOverride: event.target.value,
                      })
                    }
                  />
                </label>
              </fieldset>
            );
          })}
        </div>

        <div className="admin-stack">
          <h3>테마</h3>
          {(["primary", "accent", "ink", "muted", "surface", "subtle"] as const).map(
            (key) => (
              <label key={key} className="admin-field">
                <span>{key}</span>
                <input
                  type="color"
                  value={template.theme[key]}
                  onChange={(event) =>
                    setTemplate((current) => ({
                      ...current,
                      theme: { ...current.theme, [key]: event.target.value },
                    }))
                  }
                />
              </label>
            ),
          )}
          <label className="admin-field">
            <span>제목 정렬</span>
            <select
              value={template.theme.titleAlignment}
              onChange={(event) =>
                setTemplate((current) => ({
                  ...current,
                  theme: {
                    ...current.theme,
                    titleAlignment: event.target.value as QuoteScreenTheme["titleAlignment"],
                  },
                }))
              }
            >
              <option value="left">left</option>
              <option value="center">center</option>
              <option value="right">right</option>
            </select>
          </label>
        </div>

        <div className="admin-stack">
          <h3>주요 문구</h3>
          {FOCUS_COPY_KEYS.map((key) => (
            <label key={key} className="admin-field">
              <span>{FIELD_LABELS[key] ?? key}</span>
              <textarea
                rows={key.includes("Template") ? 2 : 3}
                value={template.copy[key] ?? ""}
                placeholder="비워두면 공통 CMS 문구 사용"
                onChange={(event) =>
                  setTemplate((current) => ({
                    ...current,
                    copy: {
                      ...current.copy,
                      [key]: event.target.value,
                    },
                  }))
                }
              />
            </label>
          ))}
          <details>
            <summary>전체 라벨 편집</summary>
            {QUOTE_DOCUMENT_COPY_KEYS.filter(
              (key) => !FOCUS_COPY_KEYS.includes(key),
            ).map((key) => (
              <label key={key} className="admin-field">
                <span>{key}</span>
                <input
                  value={template.copy[key] ?? ""}
                  placeholder="공통 CMS 문구 사용"
                  onChange={(event) =>
                    setTemplate((current) => ({
                      ...current,
                      copy: { ...current.copy, [key]: event.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </details>
        </div>

        <div className="admin-actions">
          <button
            type="button"
            className="admin-button admin-button--ghost"
            onClick={() => void saveDraft()}
            disabled={saving || !selectedPartnerId}
          >
            초안 저장
          </button>
          <button
            type="button"
            className="admin-button"
            onClick={() => void publishDraft()}
            disabled={saving || !selectedPartnerId}
          >
            게시
          </button>
        </div>
        {message ? <p className="admin-help">{message}</p> : null}
      </aside>
    </section>
  );
}
