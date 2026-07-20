"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getCmsSection } from "@/lib/cms/runtime";

type BoardFilter = "all" | "org" | "mine";

type InquiryBoardAnswer = {
  body: string;
  status: string | null;
  pointCost: number;
  createdAt: string;
};

type InquiryBoardItem = {
  id: string;
  requestNumber?: string;
  subject: string;
  visibility: "public" | "nonghyup" | "private" | string;
  visibilityLabel: string;
  status: string;
  statusLabel: string;
  createdAt: string;
  canReadDetails: boolean;
  isMine: boolean;
  isOrgInquiry: boolean;
  detailNotice: string;
  message: string | null;
  answer: InquiryBoardAnswer | null;
};

type InquiryBoardResponse = {
  ok?: boolean;
  error?: string;
  auth?: "member" | "public";
  items?: InquiryBoardItem[];
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function visibilityClass(value: string) {
  if (value === "public") return "inquiry-chip--public";
  if (value === "nonghyup") return "inquiry-chip--org";
  return "inquiry-chip--private";
}

function matchesBoardFilter(item: InquiryBoardItem, filter: BoardFilter) {
  if (filter === "mine") return item.isMine;
  if (filter === "org") return item.isOrgInquiry;
  return true;
}

function createPreviewItems(copy: CmsPageContent["sections"][number]["text"]) {
  return [
    {
      id: "preview-public",
      requestNumber: "REQ-20260721-1001",
      subject: copy.previewPublicSubject,
      visibility: "public",
      visibilityLabel: "",
      status: "ANSWERED",
      statusLabel: "",
      createdAt: "2026-07-21T00:00:00.000Z",
      canReadDetails: true,
      isMine: false,
      isOrgInquiry: false,
      detailNotice: "",
      message: copy.previewPublicMessage,
      answer: {
        body: copy.previewPublicAnswer,
        status: "published",
        pointCost: 0,
        createdAt: "2026-07-21T00:00:00.000Z",
      },
    },
    {
      id: "preview-locked",
      requestNumber: "REQ-20260721-1002",
      subject: copy.previewLockedSubject,
      visibility: "nonghyup",
      visibilityLabel: "",
      status: "SUBMITTED",
      statusLabel: "",
      createdAt: "2026-07-20T00:00:00.000Z",
      canReadDetails: false,
      isMine: false,
      isOrgInquiry: true,
      detailNotice: "",
      message: null,
      answer: null,
    },
  ] satisfies InquiryBoardItem[];
}

export function InquiryBoard({
  content,
  previewMode = false,
}: {
  content: CmsPageContent;
  previewMode?: boolean;
}) {
  const filterCopy = getCmsSection(content, "public.inquiries", "filters");
  const listCopy = getCmsSection(content, "public.inquiries", "list");
  const [items, setItems] = useState<InquiryBoardItem[]>([]);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"member" | "public">(
    previewMode ? "member" : "public",
  );
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [query, setQuery] = useState("");
  const effectiveItems = useMemo(
    () => (previewMode ? createPreviewItems(listCopy.text) : items),
    [items, listCopy.text, previewMode],
  );

  const publicFilters: { value: BoardFilter; label: string }[] = [
    { value: "all", label: filterCopy.text.allFilter },
  ];
  const memberFilters: { value: BoardFilter; label: string }[] = [
    ...publicFilters,
    { value: "org", label: filterCopy.text.organizationFilter },
    { value: "mine", label: filterCopy.text.mineFilter },
  ];
  const filters = authMode === "member" ? memberFilters : publicFilters;
  const effectiveFilter = authMode === "public" ? "all" : filter;

  useEffect(() => {
    if (previewMode) return;
    const auth = getFirebaseAuth();
    const load = async (user: User | null) => {
      setLoading(true);
      setError("");
      try {
        const headers: Record<string, string> = {};
        if (user) {
          headers.authorization = `Bearer ${await user.getIdToken()}`;
        }
        const res = await fetch("/api/inquiries", { headers });
        const data = (await res.json()) as InquiryBoardResponse;
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "inquiries_load_failed");
        }
        setItems(data.items ?? []);
        setAuthMode(data.auth ?? "public");
      } catch {
        setError(content.messages.genericError);
      } finally {
        setLoading(false);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      void load(user);
    });
    return () => unsubscribe();
  }, [content.messages.genericError, previewMode]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return effectiveItems.filter((item) => {
      const matchesFilter = matchesBoardFilter(item, effectiveFilter);
      const matchesQuery =
        !normalizedQuery ||
        item.subject.toLowerCase().includes(normalizedQuery) ||
        item.requestNumber?.toLowerCase().includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });
  }, [effectiveFilter, effectiveItems, query]);

  const toolbarSummary = useMemo(() => {
    if (effectiveFilter === "org") {
      return filterCopy.text.organizationSummary;
    }
    if (effectiveFilter === "mine") {
      return filterCopy.text.mineSummary;
    }
    if (authMode === "member") {
      return filterCopy.text.allMemberSummary;
    }
    return filterCopy.text.allGuestSummary;
  }, [authMode, effectiveFilter, filterCopy.text]);

  function visibilityLabel(item: InquiryBoardItem) {
    if (item.visibility === "public") return listCopy.text.visibilityPublic;
    if (item.visibility === "nonghyup") {
      return listCopy.text.visibilityOrganization;
    }
    return listCopy.text.visibilityPrivate;
  }

  function statusLabel(item: InquiryBoardItem) {
    if (item.answer) return listCopy.text.statusAnswered;
    const normalized = item.status.toUpperCase();
    if (normalized === "COMPLETED") return listCopy.text.statusCompleted;
    if (normalized === "FOLLOWUP") return listCopy.text.statusFollowup;
    return listCopy.text.statusReceived;
  }

  return (
    <section
      className="inquiry-board"
      aria-label={filterCopy.text.boardAriaLabel}
    >
      <div className="inquiry-board__toolbar">
        <div>
          <strong>
            {filterCopy.text.countPrefix}{" "}
            {filteredItems.length.toLocaleString("ko-KR")}
            {filterCopy.text.countSuffix}
          </strong>
          <span>{toolbarSummary}</span>
        </div>
        <label className="inquiry-board__search">
          <span>{filterCopy.text.searchLabel}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={filterCopy.text.searchPlaceholder}
          />
        </label>
      </div>

      <div
        className={`inquiry-board__filters${
          filters.length === 1 ? " inquiry-board__filters--single" : ""
        }`}
        aria-label={filterCopy.text.filtersAriaLabel}
      >
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            className={effectiveFilter === item.value ? "is-active" : undefined}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="inquiry-board__state">{content.messages.loading}</div>
      ) : error ? (
        <div className="inquiry-board__state inquiry-board__state--error">
          {error}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="inquiry-board__state">{content.messages.empty}</div>
      ) : (
        <div className="inquiry-list">
          {filteredItems.map((item) => (
            <details className="inquiry-row" key={item.id}>
              <summary>
                <span className="inquiry-row__number">
                  {item.requestNumber ?? listCopy.text.missingRequestNumber}
                </span>
                <strong>{item.subject}</strong>
                <span className="inquiry-row__meta">
                  <span className={`inquiry-chip ${visibilityClass(item.visibility)}`}>
                    {visibilityLabel(item)}
                  </span>
                  <span className="inquiry-chip inquiry-chip--status">
                    {statusLabel(item)}
                  </span>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </span>
              </summary>

              <div className="inquiry-row__detail">
                {item.canReadDetails ? (
                  <>
                    <section>
                      <h3>{listCopy.text.requestHeading}</h3>
                      <p>{item.message}</p>
                    </section>
                    <section>
                      <h3>{listCopy.text.answerHeading}</h3>
                      {item.answer ? (
                        <p>{item.answer.body}</p>
                      ) : (
                        <p className="inquiry-row__muted">
                          {listCopy.text.answerPending}
                        </p>
                      )}
                    </section>
                  </>
                ) : (
                  <div className="inquiry-row__locked">
                    <strong>{listCopy.text.lockedTitle}</strong>
                    <p>{listCopy.text.lockedDescription}</p>
                    {authMode === "public" && (
                      <Link
                        href="/login"
                        onClick={
                          previewMode
                            ? (event) => event.preventDefault()
                            : undefined
                        }
                      >
                        {listCopy.text.loginLabel}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
