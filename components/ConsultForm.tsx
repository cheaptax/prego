"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

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

const CATEGORY_VALUES: Record<string, InquiryCategory> = {
  auto: "AUTO",
  tax: "TAX",
  accounting: "ACCOUNTING",
  legal: "LEGAL",
  labor: "LABOR",
  registration: "REGISTRATION",
  appraisal: "APPRAISAL",
  ip: "IP",
  customs: "CUSTOMS",
  audit: "AUDIT",
};

const VISIBILITY_VALUES: Record<string, FormState["visibility"]> = {
  public: "PUBLIC",
  organization: "ORG_ONLY",
  private: "PRIVATE",
};

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

function formatSize(
  bytes: number,
  units: { bytes: string; kilobytes: string; megabytes: string },
) {
  if (bytes < 1024) return `${bytes} ${units.bytes}`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} ${units.kilobytes}`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${units.megabytes}`;
}

export function ConsultForm({
  content,
  previewMode = false,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
}) {
  const categoryCopy = getCmsSection(
    content,
    "public.consult",
    "categorySelector",
  );
  const visibilityCopy = getCmsSection(
    content,
    "public.consult",
    "visibilitySelector",
  );
  const fieldsCopy = getCmsSection(
    content,
    "public.consult",
    "requestFields",
  );
  const successCopy = getCmsSection(content, "public.consult", "success");
  const messages = content.messages;
  const categoryOptions = categoryCopy.items.flatMap((item) => {
    const value = CATEGORY_VALUES[item.id];
    return value && item.visible && !item.deleted
      ? [{ value, label: item.title }]
      : [];
  });
  const visibilityOptions = visibilityCopy.items.flatMap((item) => {
    const value = VISIBILITY_VALUES[item.id];
    return value && item.visible && !item.deleted
      ? [{ value, label: item.title, description: item.description ?? "" }]
      : [];
  });
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
      setErrorMsg(messages.tooManyAttachments);
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
    if (invalidType) setErrorMsg(messages.imageOnly);
    else if (oversize) setErrorMsg(messages.imageTooLarge);
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
    if (previewMode) return;

    if (!form.subject.trim()) return setErrorMsg(messages.subjectRequired);
    if (!form.message.trim()) return setErrorMsg(messages.messageRequired);

    setErrorMsg("");
    setStatus("submitting");
    try {
      const currentUser = await waitForCurrentUser();
      if (!currentUser) {
        setStatus("error");
        return setErrorMsg(messages.authRequired);
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
        setErrorMsg(messages.organizationRequired);
      } else if (message === "invalid_attachment") {
        setErrorMsg(messages.invalidAttachment);
      } else if (message === "too_many_attachments") {
        setErrorMsg(messages.tooManyAttachments);
      } else {
        setErrorMsg(messages.genericError);
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
        <h3>{successCopy.title}</h3>
        <p>{successCopy.description}</p>
        <dl className="consult-success__meta">
          <div>
            <dt>{successCopy.text.requestNumberLabel}</dt>
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
          {successCopy.text.resetLabel}
        </button>
      </div>
    );
  }

  return (
    <form className="consult-form" onSubmit={handleSubmit} noValidate>
      {parentRequestId && (
        <p className="consult-form__notice">
          {fieldsCopy.text.followupNotice}
        </p>
      )}

      <div className="consult-form__choices">
        <fieldset className="consult-form__field consult-category">
          <legend className="consult-form__label">{categoryCopy.title}</legend>
          <p className="consult-form__field-hint">
            {categoryCopy.description}
          </p>
          <div
            className="consult-choice__grid"
            role="radiogroup"
            aria-label={categoryCopy.text.ariaLabel}
          >
            {categoryOptions.map((option) => {
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
          <legend className="consult-form__label">{visibilityCopy.title}</legend>
          <div
            className="consult-choice__grid consult-choice__grid--visibility"
            role="radiogroup"
            aria-label={visibilityCopy.text.ariaLabel}
            aria-describedby="consult-visibility-hint"
          >
            {visibilityOptions.map((option) => {
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
              visibilityOptions.find((option) => option.value === form.visibility)
                ?.description
            }
          </p>
        </fieldset>
      </div>

      <label className="consult-form__field">
        <span className="consult-form__label">
          {fieldsCopy.text.subjectLabel}
        </span>
        <input
          type="text"
          required
          value={form.subject}
          onChange={(e) => update("subject", e.target.value)}
          placeholder={fieldsCopy.text.subjectPlaceholder}
        />
      </label>

      <label className="consult-form__field">
        <span className="consult-form__label">
          {fieldsCopy.text.messageLabel}
        </span>
        <textarea
          rows={10}
          required
          maxLength={MAX_MESSAGE}
          value={form.message}
          onChange={(e) => update("message", e.target.value)}
          placeholder={fieldsCopy.text.messagePlaceholder}
        />
        <span className="consult-form__counter" aria-live="polite">
          {form.message.length.toLocaleString()} / {MAX_MESSAGE.toLocaleString()}
        </span>
      </label>

      <div className="consult-form__field">
        <span className="consult-form__label">
          {fieldsCopy.text.photoLabel} <em>{fieldsCopy.text.optionalLabel}</em>
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
            <strong>{fieldsCopy.text.photoButtonTitle}</strong>
            <em>{fieldsCopy.text.photoHelp}</em>
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
          <ul
            className="consult-form__previews"
            aria-label={fieldsCopy.text.photoListAriaLabel}
          >
            {photos.map((photo) => (
              <li key={photo.id} className="consult-form__preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.name} />
                <div className="consult-form__preview-meta">
                  <strong title={photo.name}>{photo.name}</strong>
                  <span>
                    {formatSize(photo.size, {
                      bytes: fieldsCopy.text.bytesUnit,
                      kilobytes: fieldsCopy.text.kilobytesUnit,
                      megabytes: fieldsCopy.text.megabytesUnit,
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="consult-form__preview-remove"
                  aria-label={`${photo.name} ${fieldsCopy.text.deleteSuffix}`}
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
          {status === "submitting"
            ? fieldsCopy.text.submittingLabel
            : fieldsCopy.text.submitLabel}
        </button>
      </div>
    </form>
  );
}
