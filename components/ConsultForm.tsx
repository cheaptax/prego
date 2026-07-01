"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import {
  INQUIRY_CATEGORY_AUTO_LABEL,
  INQUIRY_SUPPORT_FIELD_OPTIONS,
} from "@/lib/inquiry-categories";

type PhotoItem = {
  id: string;
  name: string;
  size: number;
  url: string;
  file: File;
};

type InquiryCategory =
  | "AUTO"
  | "TAX"
  | "ACCOUNTING"
  | "LEGAL"
  | "LABOR"
  | "REGISTRATION"
  | "APPRAISAL"
  | "IP"
  | "CUSTOMS"
  | "AUDIT";

type FormState = {
  subject: string;
  message: string;
  category: InquiryCategory;
  visibility: "PUBLIC" | "ORG_ONLY" | "PRIVATE";
};

const INITIAL: FormState = {
  subject: "",
  message: "",
  category: "AUTO",
  visibility: "PRIVATE",
};

const CATEGORY_OPTIONS: { value: InquiryCategory; label: string }[] = [
  { value: "AUTO", label: INQUIRY_CATEGORY_AUTO_LABEL },
  ...INQUIRY_SUPPORT_FIELD_OPTIONS.map((option) => ({
    value: option.value as InquiryCategory,
    label: option.label,
  })),
];

const VISIBILITY_OPTIONS: {
  value: FormState["visibility"];
  label: string;
  description: string;
}[] = [
  {
    value: "PUBLIC",
    label: "전체 공개",
    description: "다른 농협 사용자도 볼 수 있어요.",
  },
  {
    value: "ORG_ONLY",
    label: "우리 농협 공개",
    description: "같은 소속 농협 사용자만 볼 수 있어요.",
  },
  {
    value: "PRIVATE",
    label: "비공개",
    description: "작성자와 관리자만 볼 수 있어요.",
  },
];

const MAX_MESSAGE = 2000;
const MAX_PHOTOS = 6;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

type Status = "idle" | "submitting" | "success" | "error";

function getFollowupContext() {
  if (typeof window === "undefined") {
    return { parentRequestId: "", suggestedSubject: "" };
  }
  const params = new URLSearchParams(window.location.search);
  return {
    parentRequestId: params.get("parentRequestId")?.trim() ?? "",
    suggestedSubject: params.get("subject")?.trim() ?? "",
  };
}

function generateRequestNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${y}${m}${d}-${rand}`;
}

function waitForCurrentUser(timeoutMs = 3000) {
  const auth = getFirebaseAuth();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  return new Promise<User | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(user);
    });
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ConsultForm() {
  const [followupContext] = useState(getFollowupContext);
  const { parentRequestId, suggestedSubject } = followupContext;
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL,
    subject: suggestedSubject,
  }));
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [requestNumber, setRequestNumber] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    };
  }, [photos]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addPhotos = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    const slotsLeft = MAX_PHOTOS - photos.length;
    if (slotsLeft <= 0) {
      setErrorMsg(`사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있어요.`);
      return;
    }

    const accepted: PhotoItem[] = [];
    let oversize = false;
    let invalidType = false;

    for (const file of list.slice(0, slotsLeft)) {
      if (!file.type.startsWith("image/")) {
        invalidType = true;
        continue;
      }
      if (file.size > MAX_PHOTO_SIZE) {
        oversize = true;
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
        name: file.name,
        size: file.size,
        url: URL.createObjectURL(file),
        file,
      });
    }

    if (accepted.length > 0) {
      setPhotos((prev) => [...prev, ...accepted]);
      setErrorMsg("");
    }
    if (invalidType) setErrorMsg("이미지 파일만 첨부할 수 있어요.");
    else if (oversize) setErrorMsg("사진 한 장은 최대 10MB까지 업로드할 수 있어요.");
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((photo) => photo.id !== id);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.subject.trim()) return setErrorMsg("문의 제목을 입력해 주세요.");
    if (!form.message.trim()) return setErrorMsg("문의 내용을 입력해 주세요.");

    setErrorMsg("");
    setStatus("submitting");
    try {
      const currentUser = await waitForCurrentUser();
      if (!currentUser) {
        setStatus("error");
        return setErrorMsg("로그인 후 상담·견적 요청을 등록해 주세요.");
      }

      const token = await currentUser.getIdToken();
      const formData = new FormData();
      formData.set("subject", form.subject.trim());
      formData.set("message", form.message.trim());
      formData.set("visibility", form.visibility);
      formData.set("category", form.category);
      formData.set("consent", "true");
      formData.set("marketingConsent", "false");
      if (parentRequestId) formData.set("parentRequestId", parentRequestId);
      photos.forEach((photo) => formData.append("attachments", photo.file, photo.name));

      const res = await fetch("/api/consult", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        requestNumber?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? "network");
      }
      setRequestNumber(data.requestNumber ?? generateRequestNumber());
      setStatus("success");
    } catch (err) {
      setStatus("error");
      const message = err instanceof Error ? err.message : "";
      if (message === "missing_user_cooperative") {
        setErrorMsg("회원가입 소속 농협 정보가 없어 문의를 등록할 수 없습니다.");
      } else if (message === "invalid_attachment") {
        setErrorMsg("사진은 이미지 파일만 가능하며 한 장당 10MB 이하로 첨부해 주세요.");
      } else if (message === "too_many_attachments") {
        setErrorMsg(`사진은 최대 ${MAX_PHOTOS}장까지 첨부할 수 있어요.`);
      } else {
        setErrorMsg("전송 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
    }
  };

  if (status === "success") {
    return (
      <div className="consult-success" role="status" aria-live="polite">
        <span className="consult-success__seal" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <path
              d="M8 16.5 L14 22.5 L24 11"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </span>
        <h3>문의가 접수되었습니다</h3>
        <p>답변은 마이페이지에서 확인할 수 있어요.</p>
        <dl className="consult-success__meta">
          <div>
            <dt>접수번호</dt>
            <dd>
              <code>{requestNumber}</code>
            </dd>
          </div>
        </dl>
        <button
          type="button"
          className="consult-form__ghost"
          onClick={() => {
            photos.forEach((photo) => URL.revokeObjectURL(photo.url));
            setPhotos([]);
            setForm(INITIAL);
            setStatus("idle");
            setRequestNumber("");
          }}
        >
          새 문의 작성
        </button>
      </div>
    );
  }

  return (
    <form className="consult-form" onSubmit={handleSubmit} noValidate>
      {parentRequestId && (
        <p className="consult-form__notice">
          기존 문의와 연결된 후속 문의로 접수됩니다.
        </p>
      )}

      <div className="consult-form__choices">
        <fieldset className="consult-form__field consult-category">
          <legend className="consult-form__label">문의 유형</legend>
          <p className="consult-form__field-hint">
            어떤 분야인지 잘 모르겠다면 자동 배정을 선택해 주세요. 문의 내용을 보고
            알맞은 담당자가 확인해 드립니다.
          </p>
          <div className="consult-choice__grid" role="radiogroup" aria-label="문의 유형">
            {CATEGORY_OPTIONS.map((option) => {
              const checked = form.category === option.value;
              return (
                <label
                  key={option.value}
                  className={`consult-choice-chip${checked ? " is-active" : ""}`}
                >
                  <input
                    type="radio"
                    name="category"
                    value={option.value}
                    checked={checked}
                    onChange={() => update("category", option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="consult-form__field consult-visibility">
          <legend className="consult-form__label">공개 유형</legend>
          <div
            className="consult-choice__grid consult-choice__grid--visibility"
            role="radiogroup"
            aria-label="공개 유형"
            aria-describedby="consult-visibility-hint"
          >
            {VISIBILITY_OPTIONS.map((option) => {
              const checked = form.visibility === option.value;
              return (
                <label
                  key={option.value}
                  className={`consult-choice-chip${checked ? " is-active" : ""}`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={option.value}
                    checked={checked}
                    onChange={() => update("visibility", option.value)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
          <p className="consult-form__field-hint" id="consult-visibility-hint">
            {
              VISIBILITY_OPTIONS.find((option) => option.value === form.visibility)
                ?.description
            }
          </p>
        </fieldset>
      </div>

      <label className="consult-form__field">
        <span className="consult-form__label">제목</span>
        <input
          type="text"
          required
          value={form.subject}
          onChange={(e) => update("subject", e.target.value)}
          placeholder="문의 제목을 입력해 주세요"
        />
      </label>

      <label className="consult-form__field">
        <span className="consult-form__label">내용</span>
        <textarea
          rows={10}
          required
          maxLength={MAX_MESSAGE}
          value={form.message}
          onChange={(e) => update("message", e.target.value)}
          placeholder="궁금한 내용을 편하게 적어주세요."
        />
        <span className="consult-form__counter" aria-live="polite">
          {form.message.length.toLocaleString()} / {MAX_MESSAGE.toLocaleString()}
        </span>
      </label>

      <div className="consult-form__field">
        <span className="consult-form__label">
          사진 첨부 <em>선택</em>
        </span>

        <button
          type="button"
          className="consult-form__dropzone"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="consult-form__dropzone-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path
                d="M12 16V5M12 5l-4 4M12 5l4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="consult-form__dropzone-text">
            <strong>사진을 추가해 주세요</strong>
            <em>JPG, PNG, GIF · 한 장당 10MB 이하 · 최대 {MAX_PHOTOS}장</em>
          </span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="consult-form__file"
          onChange={(e) => {
            addPhotos(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />

        {photos.length > 0 && (
          <ul className="consult-form__previews" aria-label="첨부한 사진">
            {photos.map((photo) => (
              <li key={photo.id} className="consult-form__preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.name} />
                <div className="consult-form__preview-meta">
                  <strong title={photo.name}>{photo.name}</strong>
                  <span>{formatSize(photo.size)}</span>
                </div>
                <button
                  type="button"
                  className="consult-form__preview-remove"
                  aria-label={`${photo.name} 삭제`}
                  onClick={() => removePhoto(photo.id)}
                >
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                    <path
                      d="M4 4l8 8M12 4l-8 8"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errorMsg && (
        <p className="consult-form__error" role="alert">
          {errorMsg}
        </p>
      )}

      <div className="consult-form__actions">
        <button
          type="submit"
          className="consult-form__submit"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "등록 중..." : "문의 등록하기"}
        </button>
      </div>
    </form>
  );
}
