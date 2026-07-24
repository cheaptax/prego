"use client";

import { useEffect, useRef, useState } from "react";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { getCmsMessage } from "@/lib/cms/runtime";
import {
  createUploadIdempotencyKey,
  fetchWithNetworkRetry,
  uploadWithNetworkRetry,
  XhrAuditEvaluationUploadTransport,
} from "@/lib/audit-evaluation/upload-client";

type UploadPolicy = {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maximumFileSize: number;
  minimumQuoteCount: number;
  maximumQuoteCount: number;
};

type PublicDocument = {
  id: string;
  displayName: string;
  mimeType: string;
  size: number;
  uploadStatus: string;
  scanStatus: string;
  parsingStatus: string;
  matchStatus: string | null;
  customerStatus:
    | "UPLOADED"
    | "CHECKING"
    | "NEEDS_INFORMATION"
    | "READY"
    | "FAILED";
  uploadedAt: string;
};

type UploadItem = {
  localId: string;
  idempotencyKey: string;
  file: File | null;
  documentId: string | null;
  name: string;
  size: number;
  progress: number;
  status: "pending" | "uploading" | "finalizing" | "success" | "failed";
  errorCode: string | null;
  customerStatus: PublicDocument["customerStatus"] | null;
  reviewRequired: boolean;
};

export function AuditQuoteUploader({
  caseId,
  content,
  overview,
  previewMode = false,
  onDocumentCountChange,
}: {
  caseId: string;
  content: CmsPageContent;
  overview: CmsSection;
  previewMode?: boolean;
  onDocumentCountChange?: (count: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [policy, setPolicy] = useState<UploadPolicy | null>(
    previewMode
      ? {
          allowedMimeTypes: ["application/pdf"],
          allowedExtensions: [".pdf"],
          maximumFileSize: 10 * 1024 * 1024,
          minimumQuoteCount: 2,
          maximumQuoteCount: 5,
        }
      : null,
  );
  const [items, setItems] = useState<UploadItem[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const processingDocumentIds = items
    .filter(
      (item) =>
        item.documentId &&
        (
          item.customerStatus === "UPLOADED" ||
          item.customerStatus === "CHECKING"
        ),
    )
    .map((item) => item.documentId)
    .join(",");

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    void fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/documents`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          policy?: UploadPolicy;
          documents?: PublicDocument[];
          error?: string;
        } | null;
        if (!response.ok || !data?.ok || !data.policy) {
          throw new Error(data?.error ?? "upload_failed");
        }
        if (!active) return;
        setPolicy(data.policy);
        const nextItems = (data.documents ?? []).map(toUploadedItem);
        setItems(nextItems);
        onDocumentCountChange?.(nextItems.length);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setWorkspaceError(
          messageForError(
            error instanceof Error ? error.message : "upload_failed",
            content,
          ),
        );
      });
    return () => {
      active = false;
    };
  }, [caseId, content, onDocumentCountChange, previewMode]);

  useEffect(() => {
    if (previewMode || !processingDocumentIds) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/documents`,
        { cache: "no-store" },
      ).then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          documents?: PublicDocument[];
        } | null;
        if (!active || !response.ok || !data?.ok) return;
        const uploaded = (data.documents ?? []).map(toUploadedItem);
        setItems((current) => [
          ...uploaded,
          ...current.filter(
            (item) => !item.documentId && item.status !== "success",
          ),
        ]);
        onDocumentCountChange?.(uploaded.length);
      });
    }, 2_000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    caseId,
    onDocumentCountChange,
    previewMode,
    processingDocumentIds,
  ]);

  function chooseFiles(fileList: FileList | null) {
    if (!fileList || !policy || previewMode) return;
    const files = Array.from(fileList);
    let availableSlots =
      policy.maximumQuoteCount -
      items.filter((item) => item.status !== "failed").length;
    const additions: UploadItem[] = [];
    for (const file of files) {
      const clientError = validateClientFile(file, policy);
      const tooMany = availableSlots <= 0;
      const errorCode = tooMany
          ? "too_many_files"
          : clientError;
      if (!errorCode) {
        availableSlots -= 1;
      }
      additions.push({
        localId: crypto.randomUUID(),
        idempotencyKey: createUploadIdempotencyKey(),
        file,
        documentId: null,
        name: file.name,
        size: file.size,
        progress: 0,
        status: errorCode ? "failed" : "pending",
        errorCode,
        customerStatus: null,
        reviewRequired: false,
      });
    }
    setItems((current) => [...current, ...additions]);
    for (const item of additions) {
      if (!item.errorCode && item.file) {
        void uploadItem(item.localId, item.file, item.idempotencyKey);
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadItem(
    localId: string,
    file: File,
    idempotencyKey: string,
  ) {
    updateItem(localId, {
      status: "uploading",
      progress: 0,
      errorCode: null,
    });
    try {
      const mimeType = file.type || "application/pdf";
      const intentResponse = await fetchWithNetworkRetry(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/upload-intents`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify({
            fileName: file.name,
            mimeType,
            size: file.size,
          }),
        },
      );
      const intent = (await intentResponse.json().catch(() => null)) as {
        ok?: boolean;
        completed?: boolean;
        intentId?: string;
        documentId?: string;
        uploadUrl?: string | null;
        requiredHeaders?: Record<string, string>;
        error?: string;
      } | null;
      if (!intentResponse.ok || !intent?.ok || !intent.intentId) {
        throw new Error(intent?.error ?? "upload_failed");
      }
      if (intent.completed) {
        updateItem(localId, {
          status: "success",
          progress: 100,
          documentId: intent.documentId ?? null,
        });
        await refreshWorkspace();
        return;
      }
      if (!intent.uploadUrl) throw new Error("upload_failed");
      await uploadWithNetworkRetry(
        new XhrAuditEvaluationUploadTransport(),
        {
          url: intent.uploadUrl,
          file,
          headers: intent.requiredHeaders ?? {
            "content-type": mimeType,
          },
          onProgress: (progress) => updateItem(localId, { progress }),
          onRetry: () =>
            updateItem(localId, { errorCode: "network_retry" }),
        },
      );
      updateItem(localId, {
        status: "finalizing",
        progress: 100,
        errorCode: null,
      });
      const finalizeResponse = await fetchWithNetworkRetry(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/upload-intents/${encodeURIComponent(intent.intentId)}/finalize`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
        },
      );
      const finalized = (await finalizeResponse.json().catch(() => null)) as {
        ok?: boolean;
        document?: PublicDocument;
        error?: string;
      } | null;
      if (!finalizeResponse.ok || !finalized?.ok || !finalized.document) {
        throw new Error(finalized?.error ?? "upload_failed");
      }
      updateItem(localId, {
        status: "success",
        progress: 100,
        documentId: finalized.document.id,
        errorCode: null,
        reviewRequired:
          finalized.document.customerStatus === "NEEDS_INFORMATION",
        customerStatus: finalized.document.customerStatus,
      });
      await refreshWorkspace();
    } catch (error) {
      updateItem(localId, {
        status: "failed",
        errorCode:
          error instanceof Error ? error.message : "upload_failed",
      });
    }
  }

  async function refreshWorkspace() {
    const response = await fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/documents`,
      { cache: "no-store" },
    );
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      policy?: UploadPolicy;
      documents?: PublicDocument[];
    } | null;
    if (!response.ok || !data?.ok) return;
    if (data.policy) setPolicy(data.policy);
    const uploaded = (data.documents ?? []).map(toUploadedItem);
    setItems((current) => [
      ...uploaded,
      ...current.filter(
        (item) =>
          !item.documentId &&
          item.status !== "success",
      ),
    ]);
    onDocumentCountChange?.(uploaded.length);
  }

  async function removeItem(item: UploadItem) {
    if (previewMode) return;
    if (!item.documentId) {
      setItems((current) =>
        current.filter((candidate) => candidate.localId !== item.localId),
      );
      return;
    }
    try {
      const response = await fetch(
        `/api/audit-evaluations/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(item.documentId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("delete_failed");
      setItems((current) =>
        current.filter((candidate) => candidate.localId !== item.localId),
      );
      const nextCount = items.filter(
        (candidate) =>
          candidate.localId !== item.localId &&
          candidate.documentId,
      ).length;
      onDocumentCountChange?.(nextCount);
    } catch {
      updateItem(item.localId, { errorCode: "delete_failed" });
    }
  }

  function retryItem(item: UploadItem) {
    if (!item.file || previewMode) return;
    const nextKey = createUploadIdempotencyKey();
    updateItem(item.localId, {
      idempotencyKey: nextKey,
      errorCode: null,
      progress: 0,
      status: "pending",
    });
    void uploadItem(item.localId, item.file, nextKey);
  }

  function updateItem(localId: string, patch: Partial<UploadItem>) {
    setItems((current) =>
      current.map((item) =>
        item.localId === localId ? { ...item, ...patch } : item,
      ),
    );
  }

  if (!policy) {
    return (
      <p role={workspaceError ? "alert" : "status"}>
        {workspaceError ||
          getCmsMessage(
            content,
            "event.auditQuoteEvaluation",
            "uploadPending",
          )}
      </p>
    );
  }

  return (
    <div className="audit-upload">
      <div className="audit-upload__limits" aria-label={overview.text.uploadHelp}>
        <span>
          <strong>{overview.text.allowedTypeLabel}</strong>
          PDF
        </span>
        <span>
          <strong>{overview.text.maximumSizeLabel}</strong>
          {formatBytes(policy.maximumFileSize, overview)}
        </span>
        <span>
          <strong>{overview.text.quoteRangeLabel}</strong>
          {policy.minimumQuoteCount}
          {overview.text.rangeSeparator}
          {policy.maximumQuoteCount}
          {overview.text.quoteUnit}
        </span>
      </div>
      <p>{overview.text.uploadHelp}</p>
      <div
        className={`audit-upload__dropzone${dragActive ? " is-active" : ""}`}
        role="group"
        aria-label={overview.text.dropzoneTitle}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragActive(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          chooseFiles(event.dataTransfer.files);
        }}
      >
        <strong>{overview.text.dropzoneTitle}</strong>
        <p>{overview.text.dropzoneDescription}</p>
        <button
          type="button"
          className="cta cta--solid"
          onClick={() => inputRef.current?.click()}
        >
          {overview.text.uploadLabel}
        </button>
        <input
          ref={inputRef}
          className="audit-upload__input"
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={(event) => chooseFiles(event.target.files)}
          aria-label={overview.text.uploadLabel}
        />
      </div>
      <ul
        className="audit-upload__list"
        aria-label={overview.text.fileListAriaLabel}
        aria-live="polite"
      >
        {items.map((item) => (
          <li key={item.localId} className="audit-upload__item">
            <div className="audit-upload__item-head">
              <div>
                <strong>{item.name}</strong>
                <span>{formatBytes(item.size, overview)}</span>
              </div>
              <span className={`audit-upload__status is-${item.status}`}>
                {statusLabel(item, overview)}
              </span>
            </div>
            {item.status === "uploading" ||
            item.status === "finalizing" ? (
              <progress
                max={100}
                value={item.progress}
                aria-label={`${item.name} ${overview.text.progressLabel}`}
              >
                {item.progress}%
              </progress>
            ) : null}
            {item.errorCode ? (
              <p className="audit-upload__error" role="alert">
                {messageForError(item.errorCode, content)}
              </p>
            ) : null}
            {item.reviewRequired ? (
              <p role="status">
                {getCmsMessage(
                  content,
                  "event.auditQuoteEvaluation",
                  "reviewRequired",
                )}
              </p>
            ) : null}
            <div className="audit-upload__actions">
              {item.status === "failed" && item.file ? (
                <button type="button" onClick={() => retryItem(item)}>
                  {overview.text.retryLabel}
                </button>
              ) : null}
              {item.status !== "uploading" &&
              item.status !== "finalizing" ? (
                <button
                  type="button"
                  onClick={() => void removeItem(item)}
                  aria-label={`${item.name} ${overview.text.deleteSuffix}`}
                >
                  {overview.text.deleteSuffix}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function validateClientFile(file: File, policy: UploadPolicy) {
  if (file.size <= 0) return "empty_file";
  if (file.size > policy.maximumFileSize) return "file_too_large";
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (
    !policy.allowedExtensions.includes(extension) ||
    (file.type !== "" &&
      !policy.allowedMimeTypes.includes(file.type))
  ) {
    return "unsupported_file_type";
  }
  return null;
}

function toUploadedItem(document: PublicDocument): UploadItem {
  return {
    localId: document.id,
    idempotencyKey: "",
    file: null,
    documentId: document.id,
    name: document.displayName,
    size: document.size,
    progress: 100,
    status: "success",
    errorCode: null,
    customerStatus: document.customerStatus,
    reviewRequired:
      document.customerStatus === "NEEDS_INFORMATION",
  };
}

function statusLabel(item: UploadItem, overview: CmsSection) {
  if (item.status === "pending") return overview.text.pendingLabel;
  if (item.status === "uploading") return overview.text.uploadingLabel;
  if (item.status === "finalizing") return overview.text.finalizingLabel;
  if (item.status === "success") {
    if (item.customerStatus === "CHECKING") {
      return overview.text.verifyingLabel;
    }
    if (item.customerStatus === "NEEDS_INFORMATION") {
      return overview.text.needsInfoLabel;
    }
    if (item.customerStatus === "READY") {
      return overview.text.readyLabel;
    }
    if (item.customerStatus === "FAILED") {
      return overview.text.verificationFailedLabel;
    }
    return overview.text.uploadedLabel ?? overview.text.successLabel;
  }
  return overview.text.failedLabel;
}

function messageForError(code: string, content: CmsPageContent) {
  const messageKey: Record<string, string> = {
    unsupported_file_type: "unsupportedFileType",
    empty_file: "emptyFile",
    file_too_large: "fileTooLarge",
    too_many_files: "tooManyFiles",
    corrupt_pdf: "corruptOrEncrypted",
    encrypted_pdf: "corruptOrEncrypted",
    duplicate_document: "duplicateQuote",
    wrong_case: "wrongCase",
    access_denied: "accessExpired",
    network_retry: "networkRetry",
    delete_failed: "deleteFailed",
  };
  return getCmsMessage(
    content,
    "event.auditQuoteEvaluation",
    messageKey[code] ?? "uploadFailed",
  );
}

function formatBytes(size: number, overview: CmsSection) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} ${overview.text.megabytesUnit}`;
  }
  if (size >= 1024) {
    return `${Math.ceil(size / 1024)} ${overview.text.kilobytesUnit}`;
  }
  return `${size} ${overview.text.bytesUnit}`;
}
