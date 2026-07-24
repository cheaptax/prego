"use client";

import { onAuthStateChanged, type User } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { logoutPortalSession } from "@/lib/auth/login-client";
import { createAdminOperationsCopy } from "@/lib/cms/admin-operations-content";
import type { CmsPageContent } from "@/lib/cms/schemas";
import type {
  PurgeAdminHistoryItem,
  PurgeInstitutionListItem,
  PurgeInstitutionSummary,
} from "@/lib/test-data/purge-admin-read";
import type {
  PurgeJobRecord,
} from "@/lib/test-data/purge-job-types";
import type {
  CustomerClassificationItem,
  CustomerClassificationSummary,
} from "@/lib/test-data/customer-classification-service";
import {
  getTestDataExecutionBlockers,
  getTestDataJobProgress,
  getTestDataManifestCounts,
} from "@/lib/test-data/purge-admin-ui-policy";
import type { PurgeManifest } from "@/lib/test-data/purge-types";
import type { PurgeResetFieldPreview } from "@/lib/test-data/purge-types";

const ACTIVE_JOB_STATUSES = new Set([
  "CREATED",
  "VALIDATING",
  "RUNNING",
]);
const STORAGE_KEY = "nh-support:test-data-purge-job";

type ApiError = { ok?: false; error?: string };
type PurgePreview = {
  manifestId: string;
  institutionId: string;
  institutionName: string;
  confirmation: string;
  firestoreTargetCount: number;
  pendingAuthCount: number;
  pendingStorageCount: number;
  expiresAt: string;
  checksum: string;
  resetFields?: PurgeResetFieldPreview[];
  preservedFields?: string[];
};
type ConfirmationStep = 0 | 1 | 2;
type TestDashboard = {
  generatedAt: string;
  summary: {
    members: number;
    requests: number;
    answers: number;
    ratings: number;
    ratingAverage: number;
    answeredRequests: number;
    organizations: number;
    walletBalance: number;
  };
  topCooperatives: Array<{ name: string; count: number }>;
  daily: Array<{
    date: string;
    signups: number;
    requests: number;
    answers: number;
  }>;
};

export function TestDataManagement({
  content,
  adminEmail,
}: {
  content: CmsPageContent;
  adminEmail: string;
}) {
  const router = useRouter();
  const copy = useMemo(() => createAdminOperationsCopy(content), [content]);
  const text = copy.section("testDataManagement");
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "denied" | "error"
  >("loading");
  const [errorCode, setErrorCode] = useState("");
  const [query, setQuery] = useState("");
  const [institutions, setInstitutions] = useState<
    PurgeInstitutionListItem[]
  >([]);
  const [selected, setSelected] =
    useState<PurgeInstitutionListItem | null>(null);
  const [summary, setSummary] = useState<PurgeInstitutionSummary | null>(null);
  const [manifest, setManifest] = useState<PurgeManifest | null>(null);
  const [purgePreview, setPurgePreview] = useState<PurgePreview | null>(null);
  const [job, setJob] = useState<PurgeJobRecord | null>(null);
  const [history, setHistory] = useState<PurgeAdminHistoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [scanMode, setScanMode] = useState<"SCAN" | "DRY_RUN" | null>(null);
  const [confirmationStep, setConfirmationStep] =
    useState<ConfirmationStep>(0);
  const [masterAcknowledged, setMasterAcknowledged] = useState(false);
  const [testDataAcknowledged, setTestDataAcknowledged] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [executing, setExecuting] = useState(false);
  const [notice, setNotice] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const [customerItems, setCustomerItems] = useState<
    CustomerClassificationItem[]
  >([]);
  const [customerSummary, setCustomerSummary] =
    useState<CustomerClassificationSummary | null>(null);
  const [allowedTestEmails, setAllowedTestEmails] = useState<string[]>([]);
  const [classificationFilter, setClassificationFilter] = useState<
    "ALL" | "PRODUCTION" | "TEST" | "UNSUPPORTED"
  >("ALL");
  const [testDashboard, setTestDashboard] = useState<TestDashboard | null>(
    null,
  );
  const [testDashboardLoading, setTestDashboardLoading] = useState(false);

  const apiFetch = useCallback(
    async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const activeUser = getFirebaseAuth().currentUser;
      if (!activeUser) throw new Error("permission_denied");
      const token = await activeUser.getIdToken();
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        headers: {
          ...(init?.body ? { "content-type": "application/json" } : {}),
          ...init?.headers,
          authorization: `Bearer ${token}`,
        },
      });
      const body = (await response.json().catch(() => null)) as
        | (T & ApiError)
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error || "request_failed");
      }
      return body;
    },
    [],
  );

  const searchInstitutions = useCallback(
    async (searchQuery: string) => {
      setSearching(true);
      setErrorCode("");
      try {
        const data = await apiFetch<{
          ok: true;
          institutions: PurgeInstitutionListItem[];
        }>(
          `/api/admin/test-data/institutions?q=${encodeURIComponent(searchQuery)}`,
        );
        setInstitutions(data.institutions);
      } catch (error) {
        setErrorCode(errorMessage(error));
      } finally {
        setSearching(false);
      }
    },
    [apiFetch],
  );

  const loadCustomerClassifications = useCallback(async () => {
    const data = await apiFetch<{
      ok: true;
      items: CustomerClassificationItem[];
      summary: CustomerClassificationSummary;
      allowedTestEmails: string[];
    }>("/api/admin/test-data/classification");
    setCustomerItems(data.items);
    setCustomerSummary(data.summary);
    setAllowedTestEmails(data.allowedTestEmails);
  }, [apiFetch]);

  const loadTestDashboard = useCallback(async () => {
    setTestDashboardLoading(true);
    try {
      const data = await apiFetch<{
        ok: true;
        dashboard: TestDashboard;
      }>("/api/admin/test-data/dashboard");
      setTestDashboard(data.dashboard);
    } finally {
      setTestDashboardLoading(false);
    }
  }, [apiFetch]);

  const loadJob = useCallback(
    async (purgeJobId: string) => {
      const data = await apiFetch<{
        ok: true;
        job: PurgeJobRecord;
        preview?: PurgePreview;
      }>(
        `/api/admin/test-data/jobs/${encodeURIComponent(purgeJobId)}`,
      );
      setJob(data.job);
      if (data.preview) {
        setPurgePreview((current) => current ?? data.preview!);
      }
      window.localStorage.setItem(STORAGE_KEY, purgeJobId);
      return data.job;
    },
    [apiFetch],
  );

  const loadHistory = useCallback(
    async (institutionId: string) => {
      const data = await apiFetch<{
        ok: true;
        history: PurgeAdminHistoryItem[];
      }>(
        `/api/admin/test-data/history?institutionId=${encodeURIComponent(institutionId)}`,
      );
      setHistory(data.history);
    },
    [apiFetch],
  );

  const loadSummary = useCallback(
    async (institution: PurgeInstitutionListItem) => {
      setSelected(institution);
      setSummaryLoading(true);
      setManifest(null);
      setPurgePreview(null);
      setErrorCode("");
      try {
        const [summaryData] = await Promise.all([
          apiFetch<{ ok: true; summary: PurgeInstitutionSummary }>(
            `/api/admin/test-data/institutions?institutionId=${encodeURIComponent(institution.institutionId)}`,
          ),
          loadHistory(institution.institutionId),
        ]);
        setSummary(summaryData.summary);
        if (summaryData.summary.activeJob?.purgeJobId) {
          await loadJob(summaryData.summary.activeJob.purgeJobId);
        } else {
          setJob(null);
        }
      } catch (error) {
        setErrorCode(errorMessage(error));
      } finally {
        setSummaryLoading(false);
      }
    },
    [apiFetch, loadHistory, loadJob],
  );

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    updateCurrentTime();
    const timer = window.setInterval(updateCurrentTime, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (activeUser) => {
      if (!activeUser) {
        setUser(null);
        setState("denied");
        return;
      }
      setUser(activeUser);
      setState("ready");
      void searchInstitutions("");
      void loadCustomerClassifications().catch((error) =>
        setErrorCode(errorMessage(error))
      );
      void loadTestDashboard().catch((error) =>
        setErrorCode(errorMessage(error))
      );
      const storedJobId = window.localStorage.getItem(STORAGE_KEY);
      if (storedJobId) {
        void loadJob(storedJobId)
          .then(() => setNotice(text.text("restoredJob")))
          .catch(() => window.localStorage.removeItem(STORAGE_KEY));
      }
    });
    return unsubscribe;
  }, [
    loadCustomerClassifications,
    loadJob,
    loadTestDashboard,
    searchInstitutions,
    text,
  ]);

  useEffect(() => {
    if (!job || !ACTIVE_JOB_STATUSES.has(job.status)) return undefined;
    const timer = window.setInterval(() => {
      void loadJob(job.purgeJobId).catch((error) =>
        setErrorCode(errorMessage(error))
      );
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [job, loadJob]);

  const runScan = useCallback(
    async (mode: "SCAN" | "DRY_RUN") => {
      if (!selected || scanMode) return;
      setScanMode(mode);
      setErrorCode("");
      setNotice("");
      try {
        const scan = await apiFetch<{ ok: true; manifest: PurgeManifest }>(
          "/api/admin/test-data/scan",
          {
            method: "POST",
            body: JSON.stringify({
              institutionId: selected.institutionId,
              mode,
            }),
          },
        );
        setManifest(scan.manifest);
        await loadHistory(selected.institutionId);
        if (mode === "DRY_RUN") {
          await apiFetch<{ ok: true; manifestId: string }>(
            "/api/admin/test-data/manifests",
            {
              method: "POST",
              body: JSON.stringify({ manifest: scan.manifest }),
            },
          );
          const preview = await apiFetch<{
            ok: true;
            preview: PurgePreview;
          }>(
            `/api/admin/test-data/purge?manifestId=${encodeURIComponent(scan.manifest.manifestId)}`,
          );
          setPurgePreview(preview.preview);
        }
      } catch (error) {
        setErrorCode(errorMessage(error));
      } finally {
        setScanMode(null);
      }
    },
    [apiFetch, loadHistory, scanMode, selected],
  );

  const applyPurge = useCallback(async () => {
    if (
      !purgePreview ||
      confirmationInput !== purgePreview.confirmation ||
      executing
    ) {
      return;
    }
    setExecuting(true);
    setErrorCode("");
    try {
      const data = await apiFetch<{
        ok: true;
        result: {
          job: PurgeJobRecord;
          continuationRequired: boolean;
        };
      }>("/api/admin/test-data/purge", {
        method: "POST",
        body: JSON.stringify({
          apply: true,
          manifestId: purgePreview.manifestId,
          confirmation: confirmationInput,
        }),
      });
      window.localStorage.setItem(STORAGE_KEY, data.result.job.purgeJobId);
      setConfirmationStep(0);
      if (selected) {
        await loadSummary(selected);
      }
      setJob(data.result.job);
    } catch (error) {
      setErrorCode(errorMessage(error));
    } finally {
      setExecuting(false);
    }
  }, [
    apiFetch,
    confirmationInput,
    executing,
    loadSummary,
    purgePreview,
    selected,
  ]);

  const retryJob = useCallback(async () => {
    if (!purgePreview) return;
    setMasterAcknowledged(false);
    setTestDataAcknowledged(false);
    setConfirmationInput("");
    setConfirmationStep(1);
  }, [purgePreview]);

  const counts = useMemo(
    () => getTestDataManifestCounts(manifest),
    [manifest],
  );
  const clientBlockers = useMemo(
    () => getTestDataExecutionBlockers(manifest, summary, currentTime),
    [currentTime, manifest, summary],
  );
  const canPreparePreview =
    Boolean(manifest) &&
    manifest?.mode === "SCAN" &&
    clientBlockers.length === 0 &&
    !scanMode;
  const canStartConfirmation =
    Boolean(
      manifest?.mode === "DRY_RUN" &&
      purgePreview &&
      clientBlockers.length === 0,
    ) &&
    !executing &&
    !ACTIVE_JOB_STATUSES.has(job?.status ?? "");
  const progress = getTestDataJobProgress(job);
  const authProcessed = job
    ? Object.values(job.authResults ?? {}).filter(
        (result) =>
          result.deleted === "DELETED" || result.deleted === "NOT_FOUND",
      ).length
    : 0;
  const storageProcessed = job
    ? Object.values(job.storageResults ?? {}).filter(
        (result) => result === "DELETED" || result === "NOT_FOUND",
      ).length
    : 0;
  const completed = job?.status === "COMPLETED";
  const jobRetryable = Boolean(
    job?.status === "PARTIALLY_FAILED" &&
      (!purgePreview?.expiresAt ||
        currentTime < Date.parse(purgePreview.expiresAt)) &&
      (job.failedItems.some((failure) => failure.retryable) ||
        job.progress.processedFirestoreTargets <
          job.progress.totalFirestoreTargets ||
        job.pendingAuthUids.length > authProcessed ||
        job.pendingStoragePaths.length > storageProcessed),
  );
  const canSignupAgain =
    completed &&
    job.resetResult.status !== "FAILED" &&
    job.orphanVerification?.passed === true;
  const filteredCustomerItems = customerItems.filter(
    (item) =>
      classificationFilter === "ALL" ||
      item.classification === classificationFilter,
  );

  if (state !== "ready" || !user) {
    return (
      <main className="test-data-state">
        <section role={state === "denied" ? "alert" : "status"}>
          <h1>
            {state === "denied"
              ? text.text("denied")
              : state === "error"
                ? text.text("genericError")
                : text.text("loading")}
          </h1>
          <p>
            {state === "denied"
              ? text.text("deniedDescription")
              : text.text("loadingDescription")}
          </p>
        </section>
      </main>
    );
  }

  return (
    <div className="admin-shell test-data-admin">
      <aside
        className="admin-sidebar"
        aria-label={text.text("navigationAriaLabel")}
      >
        <Link className="admin-brand" href="/admin">
          <span className="admin-brand__mark" aria-hidden="true">N</span>
          <span className="admin-brand__meta">
            <strong>{text.text("brandName")}</strong>
            <span>{text.text("brandSubtitle")}</span>
          </span>
        </Link>
        <nav className="admin-nav">
          <span className="admin-nav__item is-active" aria-current="page">
            <span className="admin-nav__label">{text.text("menuTitle")}</span>
            <span className="admin-nav__desc">
              {text.text("menuDescription")}
            </span>
          </span>
        </nav>
        <div className="admin-sidebar__footer">
          <div className="admin-user">
            <span className="admin-user__avatar" aria-hidden="true">
              {adminEmail.slice(0, 1).toUpperCase()}
            </span>
            <span className="admin-user__meta">
              <strong>{adminEmail}</strong>
              <span>{text.text("menuTitle")}</span>
            </span>
          </div>
          <Link
            className="admin-btn admin-btn--ghost admin-btn--block"
            href="/admin/operations"
          >
            {text.text("backOperations")}
          </Link>
          <Link
            className="admin-btn admin-btn--ghost admin-btn--block"
            href="/admin"
          >
            {text.text("backContent")}
          </Link>
          <button
            className="admin-btn admin-btn--ghost admin-btn--block"
            type="button"
            onClick={() =>
              logoutPortalSession().then(() => router.push("/admin/login"))
            }
          >
            {text.text("logout")}
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar__crumb">{text.text("breadcrumb")}</p>
            <h1 className="admin-topbar__title">{text.text("pageTitle")}</h1>
            <p className="admin-topbar__hint">
              {text.text("pageDescription")}
            </p>
          </div>
        </header>

        <section className="test-data-notice" aria-labelledby="master-notice">
          <span aria-hidden="true">✓</span>
          <div>
            <h2 id="master-notice">{text.text("securityNoticeTitle")}</h2>
            <p>{text.text("securityNoticeBody")}</p>
          </div>
        </section>

        {notice ? (
          <div className="admin-toast admin-toast--info" role="status">
            {notice}
          </div>
        ) : null}
        {errorCode ? (
          <div className="admin-toast admin-toast--error" role="alert">
            <span>{errorCopy(errorCode, text)}</span>
            <code>{errorCode}</code>
          </div>
        ) : null}

        <section className="admin-panel">
          <div className="admin-panel__head">
            <div>
              <h2>{text.text("testDashboardTitle")}</h2>
              <p>{text.text("testDashboardDescription")}</p>
            </div>
            <button
              className="admin-btn"
              type="button"
              disabled={testDashboardLoading}
              onClick={() =>
                void loadTestDashboard().catch((error) =>
                  setErrorCode(errorMessage(error)),
                )
              }
            >
              {testDashboardLoading
                ? text.text("testDashboardLoading")
                : text.text("testDashboardRefresh")}
            </button>
          </div>
          {testDashboard ? (
            <>
              <div className="test-data-metrics">
                <Metric
                  label={text.text("testDashboardMembers")}
                  value={testDashboard.summary.members}
                  tone="success"
                />
                <Metric
                  label={text.text("testDashboardRequests")}
                  value={testDashboard.summary.requests}
                  tone="neutral"
                />
                <Metric
                  label={text.text("testDashboardAnswers")}
                  value={testDashboard.summary.answers}
                  tone="neutral"
                />
                <Metric
                  label={text.text("testDashboardOrganizations")}
                  value={testDashboard.summary.organizations}
                  tone="neutral"
                />
              </div>
              <dl className="test-data-summary-grid">
                <SummaryItem
                  label={text.text("testDashboardAnswerRate")}
                  value={`${
                    testDashboard.summary.requests
                      ? (
                          (testDashboard.summary.answeredRequests /
                            testDashboard.summary.requests) *
                          100
                        ).toFixed(1)
                      : "0.0"
                  }%`}
                />
                <SummaryItem
                  label={text.text("testDashboardRatingAverage")}
                  value={
                    testDashboard.summary.ratings
                      ? `${testDashboard.summary.ratingAverage.toFixed(2)} / 5.0`
                      : "-"
                  }
                />
                <SummaryItem
                  label={text.text("testDashboardWalletBalance")}
                  value={testDashboard.summary.walletBalance.toLocaleString()}
                />
                <SummaryItem
                  label={text.text("testDashboardGeneratedAt")}
                  value={new Date(testDashboard.generatedAt).toLocaleString(
                    "ko-KR",
                  )}
                />
              </dl>
              <div className="admin-grid">
                <section className="admin-card">
                  <header className="admin-card__head">
                    <div>
                      <h3>{text.text("testDashboardTopCooperatives")}</h3>
                      <p>{text.text("testDashboardSnapshotHelp")}</p>
                    </div>
                  </header>
                  <ol className="admin-ranking">
                    {testDashboard.topCooperatives.map((item, index) => (
                      <li key={item.name}>
                        <span>{index + 1}</span>
                        <strong>{item.name}</strong>
                        <em>
                          {item.count}
                          {text.text("countUnit")}
                        </em>
                      </li>
                    ))}
                    {testDashboard.topCooperatives.length === 0 ? (
                      <li className="admin-empty">
                        {text.text("testDashboardEmpty")}
                      </li>
                    ) : null}
                  </ol>
                </section>
                <section className="admin-card admin-card--span-2">
                  <header className="admin-card__head">
                    <div>
                      <h3>{text.text("testDashboardDailyTitle")}</h3>
                      <p>{text.text("testDashboardDailyDescription")}</p>
                    </div>
                  </header>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>{text.text("testDashboardDate")}</th>
                          <th>{text.text("testDashboardMembers")}</th>
                          <th>{text.text("testDashboardRequests")}</th>
                          <th>{text.text("testDashboardAnswers")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testDashboard.daily.map((item) => (
                          <tr key={item.date}>
                            <td>{item.date}</td>
                            <td>{item.signups}</td>
                            <td>{item.requests}</td>
                            <td>{item.answers}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </>
          ) : (
            <p className="admin-empty">
              {text.text(
                testDashboardLoading
                  ? "testDashboardLoading"
                  : "testDashboardEmpty",
              )}
            </p>
          )}
        </section>

        {customerSummary ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <div>
                <h2>{text.text("customerClassificationTitle")}</h2>
                <p>{text.text("customerClassificationDescription")}</p>
              </div>
              <button
                className="admin-btn"
                type="button"
                onClick={() =>
                  void loadCustomerClassifications().catch((error) =>
                    setErrorCode(errorMessage(error))
                  )
                }
              >
                {text.text("refreshClassification")}
              </button>
            </div>
            <div className="test-data-metrics">
              <Metric
                label={text.text("productionCustomerCount")}
                value={customerSummary.production}
                tone="neutral"
              />
              <Metric
                label={text.text("testCustomerCount")}
                value={customerSummary.test}
                tone="success"
              />
              <Metric
                label={text.text("unsupportedCustomerCount")}
                value={customerSummary.unsupported}
                tone={customerSummary.unsupported > 0 ? "danger" : "neutral"}
              />
              <Metric
                label={text.text("totalCustomerCount")}
                value={customerSummary.total}
                tone="neutral"
              />
            </div>
            <div className="test-data-job__actions" role="group">
              {(["ALL", "PRODUCTION", "TEST", "UNSUPPORTED"] as const).map(
                (filter) => (
                  <button
                    key={filter}
                    className={`admin-btn${
                      classificationFilter === filter
                        ? " admin-btn--primary"
                        : ""
                    }`}
                    type="button"
                    onClick={() => setClassificationFilter(filter)}
                  >
                    {text.text(`classificationFilter${filter}`)}
                  </button>
                ),
              )}
            </div>
            <p>
              <strong>{text.text("allowedTestEmails")}</strong>{" "}
              {allowedTestEmails.join(", ")}
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{text.text("customerClassification")}</th>
                    <th>{text.text("customerEmail")}</th>
                    <th>{text.text("customerName")}</th>
                    <th>{text.text("customerCooperative")}</th>
                    <th>{text.text("customerConnectionStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomerItems.map((item) => (
                    <tr key={item.uid}>
                      <td>
                        <StatusBadge
                          tone={
                            item.classification === "TEST"
                              ? "success"
                              : item.classification === "UNSUPPORTED"
                                ? "danger"
                                : "neutral"
                          }
                        >
                          {text.text(
                            `customerClassification${item.classification}`,
                          )}
                        </StatusBadge>
                      </td>
                      <td>{item.email}</td>
                      <td>{item.name || "-"}</td>
                      <td>{item.cooperativeName || "-"}</td>
                      <td>
                        {text.text(`customerStatus${item.firestoreStatus}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="admin-panel test-data-search">
          <div className="admin-panel__head">
            <div>
              <h2>{text.text("searchTitle")}</h2>
              <p>{text.text("searchDescription")}</p>
            </div>
          </div>
          <form
            className="test-data-search__form"
            onSubmit={(event) => {
              event.preventDefault();
              void searchInstitutions(query);
            }}
          >
            <label>
              <span>{text.text("searchLabel")}</span>
              <input
                className="admin-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={text.text("searchPlaceholder")}
                maxLength={80}
              />
            </label>
            <button className="admin-btn" type="submit" disabled={searching}>
              {searching
                ? text.text("scanRunning")
                : text.text("searchButton")}
            </button>
          </form>
          <div className="test-data-institutions">
            {institutions.length === 0 ? (
              <p className="admin-empty">{text.text("searchEmpty")}</p>
            ) : (
              institutions.map((institution) => (
                <button
                  key={institution.institutionId}
                  type="button"
                  className={
                    selected?.institutionId === institution.institutionId
                      ? "is-selected"
                      : ""
                  }
                  onClick={() => void loadSummary(institution)}
                >
                  <span>
                    <strong>{institution.institutionName}</strong>
                    <small>{institution.institutionId}</small>
                  </span>
                  <span className="test-data-badges">
                    <StatusBadge
                      tone={institution.isDemoInstitution ? "info" : "neutral"}
                    >
                      {institution.isDemoInstitution
                        ? text.text("demoBadge")
                        : text.text("realBadge")}
                    </StatusBadge>
                    {institution.resettable ? (
                      <StatusBadge tone="success">
                        {text.text("resettableBadge")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">
                        {text.text("masterPreservedBadge")}
                      </StatusBadge>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {selected ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <div>
                <span className="admin-panel__eyebrow">
                  {text.text("selectedInstitution")}
                </span>
                <h2>{selected.institutionName}</h2>
                <p>{selected.institutionId}</p>
              </div>
              <button
                className="admin-btn admin-btn--primary"
                type="button"
                onClick={() => void runScan("SCAN")}
                disabled={summaryLoading || Boolean(scanMode)}
              >
                {scanMode === "SCAN"
                  ? text.text("scanRunning")
                  : text.text("dataCheck")}
              </button>
            </div>
            {summaryLoading || !summary ? (
              <p className="admin-empty">{text.text("loading")}</p>
            ) : (
              <>
                <dl className="test-data-summary">
                  <SummaryItem
                    label={text.text("institutionName")}
                    value={summary.institutionName}
                  />
                  <SummaryItem
                    label={text.text("institutionId")}
                    value={summary.institutionId}
                  />
                  <SummaryItem
                    label={text.text("institutionCode")}
                    value={summary.institutionCode}
                  />
                  <SummaryItem
                    label={text.text("institutionType")}
                    value={
                      summary.isDemoInstitution
                        ? text.text("demoBadge")
                        : text.text("realBadge")
                    }
                  />
                  <SummaryItem
                    label={text.text("signupStatus")}
                    value={summary.signupStatus}
                  />
                  <SummaryItem
                    label={text.text("customerAccounts")}
                    value={String(summary.connectedCustomerAccounts)}
                  />
                  <SummaryItem
                    label={text.text("organizations")}
                    value={String(summary.connectedOrganizations)}
                  />
                  <SummaryItem
                    label={text.text("testMarker")}
                    value={
                      summary.hasExplicitTestMarker
                        ? text.text("marked")
                        : text.text("unmarked")
                    }
                  />
                  <SummaryItem
                    label={text.text("lastActivity")}
                    value={
                      summary.lastActivityAt
                        ? formatDate(summary.lastActivityAt)
                        : text.text("noActivity")
                    }
                  />
                  <SummaryItem
                    label={text.text("classification")}
                    value={summary.classificationStatus}
                  />
                </dl>
                {!summary.isDemoInstitution ? (
                  <aside className="test-data-real-notice">
                    <h3>{text.text("realNoticeTitle")}</h3>
                    <ul>
                      <li>{text.text("realNoticeLine1")}</li>
                      <li>{text.text("realNoticeLine2")}</li>
                      <li>{text.text("realNoticeLine3")}</li>
                      <li>{text.text("realNoticeLine4")}</li>
                    </ul>
                  </aside>
                ) : null}
                {summary.activeLock ? (
                  <div className="test-data-blocker" role="alert">
                    <strong>{text.text("duplicateBlocked")}</strong>
                    <code>{summary.activeLock.purgeJobId}</code>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {manifest ? (
          <section className="admin-panel test-data-preview">
            <div className="admin-panel__head">
              <div>
                <h2>{text.text("previewTitle")}</h2>
                <p>{text.text("previewDescription")}</p>
              </div>
              {canPreparePreview ? (
                <button
                  className="admin-btn admin-btn--primary"
                  type="button"
                  onClick={() => void runScan("DRY_RUN")}
                >
                  {scanMode === "DRY_RUN"
                    ? text.text("previewPreparing")
                    : text.text("preparePreview")}
                </button>
              ) : null}
            </div>
            <div className="test-data-metrics">
              <Metric
                label={text.text("confirmedCount")}
                value={counts.confirmed}
                tone="success"
              />
              <Metric
                label={text.text("reviewCount")}
                value={counts.review}
                tone={counts.review > 0 ? "danger" : "neutral"}
              />
              <Metric
                label={text.text("preserveCount")}
                value={counts.preserve}
                tone="neutral"
              />
              <Metric
                label={text.text("blockedStatus")}
                value={manifest.executionStatus === "BLOCKED" ? 1 : 0}
                tone={
                  manifest.executionStatus === "BLOCKED"
                    ? "danger"
                    : "success"
                }
              />
            </div>
            <div className="test-data-preview__grid">
              <PreviewList
                title={text.text("collectionCounts")}
                empty={text.text("noItems")}
                values={Object.entries(manifest.targetsByCollection).map(
                  ([collection, items]) => `${collection} · ${items.length}`,
                )}
              />
              <PreviewList
                title={text.text("resetFields")}
                empty={text.text("noItems")}
                values={manifest.resetFields.map(
                  (field) =>
                    `${field.field}: ${displayValue(field.currentValue)} → ${displayValue(field.expectedValue)}`,
                )}
              />
              <PreviewList
                title={text.text("preservedFields")}
                empty={text.text("noItems")}
                values={manifest.preservedFields}
              />
              <PreviewList
                title={text.text("warnings")}
                empty={text.text("noItems")}
                values={[
                  ...manifest.warnings,
                  ...manifest.blockedReasons,
                ]}
                danger
              />
            </div>
            <dl className="test-data-preview__facts">
              <SummaryItem
                label={text.text("authCount")}
                value={String(counts.auth)}
              />
              <SummaryItem
                label={text.text("storageCount")}
                value={String(counts.storage)}
              />
              <SummaryItem
                label={text.text("manifestExpiresAt")}
                value={formatDate(manifest.expiresAt)}
              />
            </dl>
            {clientBlockers.length > 0 ? (
              <div className="test-data-blocker" role="alert">
                <strong>{text.text("blockTitle")}</strong>
                <ul>
                  {clientBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : manifest.mode === "DRY_RUN" && purgePreview ? (
              <div className="test-data-ready">
                <div>
                  <strong>{text.text("readyTitle")}</strong>
                  <p>{text.text("readyDescription")}</p>
                </div>
                <button
                  className="admin-btn admin-btn--danger"
                  type="button"
                  onClick={() => {
                    setMasterAcknowledged(false);
                    setTestDataAcknowledged(false);
                    setConfirmationInput("");
                    setConfirmationStep(1);
                  }}
                  disabled={!canStartConfirmation}
                >
                  {text.text("startConfirmation")}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {job ? (
          <section className="admin-panel test-data-job" aria-live="polite">
            <div className="admin-panel__head">
              <div>
                <h2>
                  {completed
                    ? text.text("completionTitle")
                    : text.text("progressTitle")}
                </h2>
                <p>{job.purgeJobId}</p>
              </div>
              <StatusBadge
                tone={
                  completed
                    ? "success"
                    : job.status === "BLOCKED" ||
                        job.status === "PARTIALLY_FAILED"
                      ? "danger"
                      : "info"
                }
              >
                {copyStatus(job.status, copy)}
              </StatusBadge>
            </div>
            <div className="test-data-progress">
              <div>
                <span>{text.text("completionPercentage")}</span>
                <strong>{progress}%</strong>
              </div>
              <progress value={progress} max={100}>{progress}%</progress>
            </div>
            <dl className="test-data-summary">
              <SummaryItem
                label={text.text("currentPhase")}
                value={text.item(`phase.${job.currentPhase}`)}
              />
              <SummaryItem
                label={text.text("deletedDocuments")}
                value={String(firestoreDeletedCount(job))}
              />
              <SummaryItem
                label={text.text("authProcessed")}
                value={String(authProcessed)}
              />
              <SummaryItem
                label={text.text("storageProcessed")}
                value={String(storageProcessed)}
              />
              <SummaryItem
                label={text.text("resetResult")}
                value={job.resetResult.status}
              />
              <SummaryItem
                label={text.text("orphanVerification")}
                value={
                  job.orphanVerification
                    ? job.orphanVerification.passed
                      ? text.text("available")
                      : `${text.text("unavailable")} · ${job.orphanVerification.blockerCount}`
                    : "-"
                }
              />
              <SummaryItem
                label={text.text("completedAt")}
                value={job.completedAt ? formatDate(job.completedAt) : "-"}
              />
              <SummaryItem
                label={text.text("canSignupAgain")}
                value={
                  canSignupAgain
                    ? text.text("available")
                    : text.text("unavailable")
                }
              />
              <SummaryItem
                label={text.text("retryable")}
                value={
                  jobRetryable
                    ? text.text("available")
                    : text.text("unavailable")
                }
              />
            </dl>
            <PreviewList
              title={text.text("deletedByCollection")}
              empty={text.text("noItems")}
              values={Object.entries(job.deletedCounts).map(
                ([collection, count]) => `${collection} · ${count}`,
              )}
            />
            <PreviewList
              title={text.text("failedItems")}
              empty={text.text("noFailures")}
              values={job.failedItems.map(
                (failure) =>
                  `${text.item(`phase.${failure.phase}`)} · ${failure.code} · ${failure.retryable ? text.text("retryable") : text.text("unavailable")}`,
              )}
              danger
            />
            <div className="test-data-job__actions">
              {jobRetryable ? (
                <button
                  className="admin-btn admin-btn--primary"
                  type="button"
                  onClick={() => void retryJob()}
                >
                  {text.text("retryJob")}
                </button>
              ) : null}
              {completed && summary?.isDemoInstitution ? (
                <Link className="admin-btn admin-btn--primary" href="/signup">
                  {text.text("testSignupStart")}
                </Link>
              ) : null}
              {completed && selected ? (
                <button
                  className="admin-btn"
                  type="button"
                  onClick={() => void runScan("SCAN")}
                >
                  {text.text("rescan")}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {selected ? (
          <section className="admin-panel">
            <div className="admin-panel__head">
              <div>
                <h2>{text.text("historyTitle")}</h2>
                <p>{text.text("historyDescription")}</p>
              </div>
            </div>
            {history.length === 0 ? (
              <p className="admin-empty">{text.text("historyEmpty")}</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{text.text("historyTitle")}</th>
                      <th>{text.text("historyActor")}</th>
                      <th>{text.text("historyStatus")}</th>
                      <th>{text.text("historyTime")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr key={`${item.eventType}:${item.id}`}>
                        <td>{text.item(`event.${item.eventType}`)}</td>
                        <td>{item.actorEmail || item.actorId}</td>
                        <td>{text.item(`status.${item.status}`)}</td>
                        <td>{formatDate(item.occurredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}
      </main>

      {confirmationStep > 0 && purgePreview ? (
        <ConfirmationDialog
          step={confirmationStep as 1 | 2}
          text={text}
          preview={purgePreview}
          manifest={manifest}
          masterAcknowledged={masterAcknowledged}
          testDataAcknowledged={testDataAcknowledged}
          confirmationInput={confirmationInput}
          executing={executing}
          onMasterAcknowledged={setMasterAcknowledged}
          onTestDataAcknowledged={setTestDataAcknowledged}
          onConfirmationInput={setConfirmationInput}
          onNext={() => setConfirmationStep(2)}
          onBack={() => setConfirmationStep(1)}
          onCancel={() => setConfirmationStep(0)}
          onExecute={() => void applyPurge()}
        />
      ) : null}
    </div>
  );
}

function ConfirmationDialog({
  step,
  text,
  preview,
  manifest,
  masterAcknowledged,
  testDataAcknowledged,
  confirmationInput,
  executing,
  onMasterAcknowledged,
  onTestDataAcknowledged,
  onConfirmationInput,
  onNext,
  onBack,
  onCancel,
  onExecute,
}: {
  step: 1 | 2;
  text: ReturnType<typeof createAdminOperationsCopy>["section"] extends (
    id: string,
  ) => infer T
    ? T
    : never;
  preview: PurgePreview;
  manifest: PurgeManifest | null;
  masterAcknowledged: boolean;
  testDataAcknowledged: boolean;
  confirmationInput: string;
  executing: boolean;
  onMasterAcknowledged(value: boolean): void;
  onTestDataAcknowledged(value: boolean): void;
  onConfirmationInput(value: string): void;
  onNext(): void;
  onBack(): void;
  onCancel(): void;
  onExecute(): void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !executing) {
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [executing, onCancel]);
  const inputMatches = confirmationInput === preview.confirmation;
  return (
    <div className="admin-modal test-data-confirmation" role="presentation">
      <button
        type="button"
        className="admin-modal__backdrop"
        aria-label={text.text("cancel")}
        onClick={onCancel}
        disabled={executing}
      />
      <section
        ref={panelRef}
        className="admin-modal__panel admin-modal__panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-data-confirmation-title"
      >
        <header className="admin-modal__head">
          <div>
            <p className="admin-modal__eyebrow">{`${step} / 2`}</p>
            <h2 id="test-data-confirmation-title">
              {step === 1
                ? text.text("firstConfirmationTitle")
                : text.text("secondConfirmationTitle")}
            </h2>
            <p className="admin-modal__lede">
              {step === 1
                ? text.text("firstConfirmationDescription")
                : text.text("secondConfirmationDescription")}
            </p>
          </div>
        </header>
        <div className="admin-modal__body">
          {step === 1 ? (
            <>
              <dl className="test-data-confirmation__counts">
                <SummaryItem
                  label={text.text("firestoreDocuments")}
                  value={String(preview.firestoreTargetCount)}
                />
                <SummaryItem
                  label={text.text("authUsers")}
                  value={String(preview.pendingAuthCount)}
                />
                <SummaryItem
                  label={text.text("storageObjects")}
                  value={String(preview.pendingStorageCount)}
                />
                <SummaryItem
                  label={text.text("expectedRestoration")}
                  value={
                    (manifest?.resetFields ?? preview.resetFields ?? [])
                      .map(
                        (field) =>
                          `${field.field} → ${displayValue(field.expectedValue)}`,
                      )
                      .join(", ") || text.text("noItems")
                  }
                />
              </dl>
              <div className="test-data-preserved-master">
                <strong>{text.text("preservedMaster")}</strong>
                <p>
                  {(manifest?.preservedFields ?? preview.preservedFields ?? [])
                    .join(", ")}
                </p>
              </div>
              <label className="test-data-confirmation__check">
                <input
                  type="checkbox"
                  checked={masterAcknowledged}
                  onChange={(event) =>
                    onMasterAcknowledged(event.target.checked)
                  }
                />
                <span>{text.text("masterAcknowledgement")}</span>
              </label>
              <label className="test-data-confirmation__check">
                <input
                  type="checkbox"
                  checked={testDataAcknowledged}
                  onChange={(event) =>
                    onTestDataAcknowledged(event.target.checked)
                  }
                />
                <span>{text.text("testDataAcknowledgement")}</span>
              </label>
            </>
          ) : (
            <>
              <div className="test-data-confirmation__phrase">
                <code>{preview.confirmation}</code>
              </div>
              <label className="admin-modal__field">
                {text.text("confirmationLabel")}
                <input
                  className="admin-input"
                  value={confirmationInput}
                  onChange={(event) =>
                    onConfirmationInput(event.target.value)
                  }
                  placeholder={text.text("confirmationPlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={executing}
                />
              </label>
              {confirmationInput && !inputMatches ? (
                <p className="test-data-confirmation__error" role="alert">
                  {text.text("confirmationMismatch")}
                </p>
              ) : null}
            </>
          )}
          <div className="admin-modal__actions">
            <button
              className="admin-btn"
              type="button"
              onClick={step === 1 ? onCancel : onBack}
              disabled={executing}
            >
              {text.text("cancel")}
            </button>
            {step === 1 ? (
              <button
                className="admin-btn admin-btn--primary"
                type="button"
                onClick={onNext}
                disabled={!masterAcknowledged || !testDataAcknowledged}
              >
                {text.text("nextConfirmation")}
              </button>
            ) : (
              <button
                className="admin-btn admin-btn--danger"
                type="button"
                onClick={onExecute}
                disabled={!inputMatches || executing}
              >
                {executing ? text.text("executing") : text.text("execute")}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value || "-"}</dd>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "neutral";
}) {
  return (
    <article className={`test-data-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PreviewList({
  title,
  values,
  empty,
  danger = false,
}: {
  title: string;
  values: string[];
  empty: string;
  danger?: boolean;
}) {
  return (
    <section className={`test-data-list${danger ? " is-danger" : ""}`}>
      <h3>{title}</h3>
      {values.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {values.map((value) => <li key={value}>{value}</li>)}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({
  tone,
  children,
}: {
  tone: "success" | "danger" | "info" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={`test-data-badge is-${tone}`}>{children}</span>
  );
}

function firestoreDeletedCount(job: PurgeJobRecord) {
  return Object.entries(job.deletedCounts)
    .filter(([key]) => !["firebaseAuth", "storageObjects"].includes(key))
    .reduce((sum, [, count]) => sum + count, 0);
}

function copyStatus(
  status: string,
  copy: ReturnType<typeof createAdminOperationsCopy>,
) {
  const label = copy.section("testDataManagement").item(`status.${status}`);
  return label === `status.${status}` ? status : label;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayValue(value: unknown) {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "-";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "request_failed";
}

function errorCopy(
  code: string,
  text: ReturnType<typeof createAdminOperationsCopy>["section"] extends (
    id: string,
  ) => infer T
    ? T
    : never,
) {
  if (code === "permission_denied") return text.text("permissionDenied");
  if (code === "recent_authentication_required") {
    return text.text("recentAuthenticationRequired");
  }
  if (code === "manifest_expired") return text.text("expiredManifest");
  if (
    code === "manifest_already_running" ||
    code === "institution_purge_locked"
  ) {
    return text.text("duplicateBlocked");
  }
  return text.text("requestFailed");
}
