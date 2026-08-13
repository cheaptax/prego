"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuditEvaluationReportWorkspace } from "@/components/AuditEvaluationReportWorkspace";
import { AuditQuoteReviewWorkspace } from "@/components/AuditQuoteReviewWorkspace";
import { AuditQuoteUploader } from "@/components/AuditQuoteUploader";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import {
  cmsEditableSectionProps,
  type CmsSectionEditingOptions,
} from "@/lib/cms/editable-section";
import { getCmsMessage, getCmsSection } from "@/lib/cms/runtime";
import type { CmsPageKey } from "@/lib/cms/constants";
import type { CmsPageContent } from "@/lib/cms/schemas";
import { getFirebaseAuth } from "@/lib/firebase/client";

type CustomerPageState =
  | { kind: "disabled" }
  | { kind: "denied" }
  | {
      kind: "authorized";
      caseId: string;
      fiscalYear: number;
      currentQuoteCount: number;
      minimumQuoteCount: number;
      status: string;
      reportFeatureEnabled: boolean;
      reportAvailable: boolean;
    };

type EditingProps = CmsSectionEditingOptions & {
  previewMode?: boolean;
};

const editableSectionProps = cmsEditableSectionProps;

export function AuditEvaluationStartPage({
  content,
  enabled,
  ...editingProps
}: {
  content: CmsPageContent;
  enabled: boolean;
} & EditingProps) {
  const router = useRouter();
  const hero = getCmsSection(
    content,
    "event.auditQuoteEvaluate",
    "hero",
  );
  const access = getCmsSection(
    content,
    "event.auditQuoteEvaluate",
    "access",
  );
  const security = getCmsSection(
    content,
    "event.auditQuoteEvaluate",
    "security",
  );
  const [email, setEmail] = useState("");
  const [publicReference, setPublicReference] = useState("");
  const [status, setStatus] = useState<"idle" | "requesting" | "exchanging">(
    "idle",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (editingProps.previewMode || !enabled) return;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("access_token");
    if (!token) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
    void fetch("/api/audit-evaluations/access/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as {
          ok?: boolean;
          caseId?: string;
        } | null;
        if (!response.ok || !data?.ok || !data.caseId) {
          throw new Error("invalid_link");
        }
        window.location.assign(
          `/events/audit-quote/evaluations/${encodeURIComponent(data.caseId)}`,
        );
      })
      .catch(() => {
        setMessage(
          getCmsMessage(
            content,
            "event.auditQuoteEvaluate",
            "invalidOrExpiredLink",
          ),
        );
        setStatus("idle");
      });
  }, [content, editingProps.previewMode, enabled]);

  async function startEvaluation() {
    if (editingProps.previewMode || !enabled || status !== "idle") return;
    setStatus("requesting");
    setMessage("");
    try {
      const response = await fetch("/api/audit-evaluations/access/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          publicReference: publicReference.trim() || undefined,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        status?: string;
        error?: string;
      } | null;
      if (response.status === 429 || data?.error === "temporarily_unavailable") {
        setMessage(
          getCmsMessage(
            content,
            "event.auditQuoteEvaluate",
            "temporarilyUnavailable",
          ),
        );
        setStatus("idle");
        return;
      }
      if (!response.ok || !data?.ok) {
        setMessage(
          getCmsMessage(
            content,
            "event.auditQuoteEvaluate",
            "genericError",
          ),
        );
        setStatus("idle");
        return;
      }
      setMessage(
        getCmsMessage(
          content,
          "event.auditQuoteEvaluate",
          "requestAccepted",
        ),
      );
      setStatus("idle");
    } catch {
      setMessage(
        getCmsMessage(
          content,
          "event.auditQuoteEvaluate",
          "genericError",
        ),
      );
      setStatus("idle");
    }
  }

  async function continueWithFirebase() {
    if (editingProps.previewMode || !enabled) return;
    const user = getFirebaseAuth().currentUser;
    if (!user) {
      router.push("/login");
      return;
    }
    setStatus("exchanging");
    setMessage("");
    try {
      const idToken = await user.getIdToken();
      const response = await fetch(
        "/api/audit-evaluations/access/firebase",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ publicReference }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        caseId?: string;
      } | null;
      if (!response.ok || !data?.ok || !data.caseId) {
        throw new Error("access_denied");
      }
      window.location.assign(
        `/events/audit-quote/evaluations/${encodeURIComponent(data.caseId)}`,
      );
    } catch {
      setMessage(
        getCmsMessage(
          content,
          "event.auditQuoteEvaluate",
          "accessDenied",
        ),
      );
      setStatus("idle");
    }
  }

  return (
    <main id="main" className="login-page audit-evaluation-page">
      <section className="login-shell">
        <header
          {...editableSectionProps(hero, "login-head", editingProps)}
        >
          <span className="login-head__eyebrow">{hero.eyebrow}</span>
          <h1 className="login-head__title">{hero.title}</h1>
          <p className="login-head__lede">{hero.description}</p>
        </header>
        <section
          {...editableSectionProps(access, "login-card", editingProps)}
        >
          <h2 className="login-card__title">{access.title}</h2>
          <p className="login-card__lede">{access.description}</p>
          {!enabled ? (
            <p role="status">
              {getCmsMessage(
                content,
                "event.auditQuoteEvaluate",
                "disabled",
              )}
            </p>
          ) : (
            <div className="login-form">
              <label className="login-form__field">
                <span>{access.text.emailLabel}</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  placeholder={access.text.emailPlaceholder}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void startEvaluation();
                    }
                  }}
                  required
                />
              </label>
              <label className="login-form__field">
                <span>{access.text.referenceLabel}</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={publicReference}
                  placeholder={access.text.referencePlaceholder}
                  onChange={(event) =>
                    setPublicReference(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void startEvaluation();
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="login-card__primary"
                disabled={status !== "idle"}
                onClick={() => void startEvaluation()}
              >
                {status === "requesting"
                  ? access.text.requestingLabel
                  : access.text.requestLinkLabel}
              </button>
              <button
                type="button"
                className="login-card__ghost"
                onClick={continueWithFirebase}
                disabled={status !== "idle"}
              >
                {access.text.firebaseAccessLabel}
              </button>
            </div>
          )}
          {message ? (
            <p className="login-form__error" role="alert" aria-live="assertive">
              {message}
            </p>
          ) : null}
        </section>
        <section
          {...editableSectionProps(
            security,
            "login-card audit-evaluation-security",
            editingProps,
          )}
        >
          <h2 className="login-card__title">{security.title}</h2>
          <p className="login-card__lede">{security.description}</p>
        </section>
      </section>
      <CmsSupplementalSections
        pageKey="event.auditQuoteEvaluate"
        content={content}
        editing={editingProps.editing}
        selectedSectionId={editingProps.selectedSectionId}
        onSelectSection={editingProps.onSelectSection}
      />
    </main>
  );
}

export function AuditEvaluationCasePage({
  content,
  state,
  ...editingProps
}: {
  content: CmsPageContent;
  state: CustomerPageState;
} & EditingProps) {
  const [uploadedDocumentCount, setUploadedDocumentCount] = useState(0);
  const hero = getCmsSection(
    content,
    "event.auditQuoteEvaluation",
    "hero",
  );
  const overview = getCmsSection(
    content,
    "event.auditQuoteEvaluation",
    "overview",
  );
  const steps = getCmsSection(
    content,
    "event.auditQuoteEvaluation",
    "steps",
  );
  const privacy = getCmsSection(
    content,
    "event.auditQuoteEvaluation",
    "privacy",
  );
  const disclaimer = getCmsSection(
    content,
    "event.auditQuoteEvaluation",
    "disclaimer",
  );

  return (
    <main id="main" className="policy-page audit-evaluation-page">
      <section
        {...editableSectionProps(hero, "policy-hero", editingProps)}
      >
        <div className="policy-section__inner">
          <span className="kicker">{hero.eyebrow}</span>
          <h1>{hero.title}</h1>
          <p>{hero.description}</p>
        </div>
      </section>
      {state.kind !== "authorized" ? (
        <section className="policy-section">
          <div className="policy-section__inner">
            <p role="alert">
              {getCmsMessage(
                content,
                "event.auditQuoteEvaluation",
                state.kind === "disabled" ? "disabled" : "denied",
              )}
            </p>
            <Link className="cta cta--solid" href="/events/audit-quote/evaluate">
              {getCmsMessage(
                content,
                "event.auditQuoteEvaluation",
                "requestAgainLabel",
              )}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section
            {...editableSectionProps(
              overview,
              "policy-section",
              editingProps,
            )}
          >
            <div className="policy-section__inner">
              <h2>{overview.title}</h2>
              <dl className="audit-evaluation-stats">
                <div>
                  <dt>{overview.text.fiscalYearLabel}</dt>
                  <dd>{state.fiscalYear}</dd>
                </div>
                <div>
                  <dt>{overview.text.currentQuoteCountLabel}</dt>
                  <dd>
                    {Math.max(
                      state.currentQuoteCount,
                      uploadedDocumentCount,
                    )}
                    {overview.text.quoteUnit}
                  </dd>
                </div>
                <div>
                  <dt>{overview.text.minimumQuoteCountLabel}</dt>
                  <dd>
                    {state.minimumQuoteCount}
                    {overview.text.quoteUnit}
                  </dd>
                </div>
              </dl>
              <AuditQuoteUploader
                caseId={state.caseId}
                content={content}
                overview={overview}
                previewMode={editingProps.previewMode}
                onDocumentCountChange={setUploadedDocumentCount}
              />
              <Link
                className="cta cta--solid"
                href={`/events/audit-quote/evaluations/${encodeURIComponent(state.caseId)}/review`}
              >
                {overview.text.reviewQuotesLabel}
              </Link>
            </div>
          </section>
          <section
            {...editableSectionProps(
              steps,
              "policy-section",
              editingProps,
            )}
          >
            <div className="policy-section__inner">
              <h2>{steps.title}</h2>
              <ol className="audit-evaluation-steps">
                {steps.items
                  .filter((item) => item.visible && !item.deleted)
                  .map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </li>
                  ))}
              </ol>
            </div>
          </section>
          {[
            privacy,
            ...(editingProps.editing || editingProps.previewMode
              ? [disclaimer]
              : []),
          ].map((section) => (
            <section
              key={section.id}
              {...editableSectionProps(
                section,
                "policy-section",
                editingProps,
              )}
            >
              <div className="policy-section__inner">
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
            </section>
          ))}
          <SessionExitButton
            label={getCmsMessage(
              content,
              "event.auditQuoteEvaluation",
              "logoutLabel",
            )}
            previewMode={editingProps.previewMode}
          />
        </>
      )}
      <CmsSupplementalSections
        pageKey="event.auditQuoteEvaluation"
        content={content}
        editing={editingProps.editing}
        selectedSectionId={editingProps.selectedSectionId}
        onSelectSection={editingProps.onSelectSection}
      />
    </main>
  );
}

export function AuditEvaluationReviewPage({
  content,
  state,
  ...editingProps
}: {
  content: CmsPageContent;
  state: CustomerPageState;
} & EditingProps) {
  const pageKey = "event.auditQuoteEvaluationReview" as const;
  const hero = getCmsSection(content, pageKey, "hero");
  const progress = getCmsSection(content, pageKey, "progress");
  const documents = getCmsSection(content, pageKey, "documents");
  const keyCards = getCmsSection(content, pageKey, "keyCards");
  const comparison = getCmsSection(content, pageKey, "comparison");
  const corrections = getCmsSection(content, pageKey, "corrections");
  const actions = getCmsSection(content, pageKey, "actions");
  const guidance = getCmsSection(content, pageKey, "guidance");
  return (
    <main id="main" className="policy-page audit-evaluation-page">
      <section
        {...editableSectionProps(hero, "policy-hero", editingProps)}
      >
        <div className="policy-section__inner">
          <span className="kicker">{hero.eyebrow}</span>
          <h1>{hero.title}</h1>
          <p>{hero.description}</p>
        </div>
      </section>
      {state.kind !== "authorized" ? (
        <section className="policy-section">
          <div className="policy-section__inner">
            <p role="alert">
              {getCmsMessage(
                content,
                pageKey,
                state.kind === "disabled" ? "disabled" : "denied",
              )}
            </p>
          </div>
        </section>
      ) : (
        <>
          <section
            {...editableSectionProps(
              progress,
              "policy-section",
              editingProps,
            )}
          >
            <div className="policy-section__inner">
              <h2>{progress.title}</h2>
              <ol className="audit-evaluation-steps">
                {progress.items
                  .filter((item) => item.visible && !item.deleted)
                  .map((item) => (
                    <li
                      key={item.id}
                      aria-current={item.id === "extract" ? "step" : undefined}
                    >
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                    </li>
                  ))}
              </ol>
            </div>
          </section>
          <section className="policy-section">
            <div className="policy-section__inner">
              <AuditQuoteReviewWorkspace
                caseId={state.caseId}
                content={content}
                sections={{
                  documents,
                  keyCards,
                  comparison,
                  corrections,
                  actions,
                }}
                reportFeatureEnabled={state.reportFeatureEnabled}
                previewMode={editingProps.previewMode}
                editing={editingProps.editing}
                selectedSectionId={editingProps.selectedSectionId}
                onSelectSection={editingProps.onSelectSection}
              />
            </div>
          </section>
          <section
            {...editableSectionProps(
              guidance,
              "policy-section",
              editingProps,
            )}
          >
            <div className="policy-section__inner">
              <h2>{guidance.title}</h2>
              <p>{guidance.description}</p>
            </div>
          </section>
          <SessionExitButton
            label={getCmsMessage(content, pageKey, "logoutLabel")}
            previewMode={editingProps.previewMode}
          />
        </>
      )}
    </main>
  );
}

export function AuditEvaluationReportPage({
  content,
  state,
  ...editingProps
}: {
  content: CmsPageContent;
  state: CustomerPageState;
} & EditingProps) {
  const hero = getCmsSection(
    content,
    "event.auditQuoteEvaluationReport",
    "hero",
  );
  const report = getCmsSection(
    content,
    "event.auditQuoteEvaluationReport",
    "report",
  );
  return (
    <main id="main" className="policy-page audit-evaluation-page">
      <section
        {...editableSectionProps(hero, "policy-hero", editingProps)}
      >
        <div className="policy-section__inner">
          <span className="kicker">{hero.eyebrow}</span>
          <h1>{hero.title}</h1>
          <p>{hero.description}</p>
        </div>
      </section>
      <section
        {...editableSectionProps(
          report,
          "policy-section",
          editingProps,
        )}
      >
        <div className="policy-section__inner">
          <h2>{report.title}</h2>
          {state.kind === "authorized" ? (
            <>
              <p>
                {report.text.fiscalYearLabel}: {state.fiscalYear}
              </p>
              {!state.reportFeatureEnabled ? (
                <p role="status">
                  {getCmsMessage(
                    content,
                    "event.auditQuoteEvaluationReport",
                    "disabled",
                  )}
                </p>
              ) : editingProps.previewMode ? (
                <p role="status">{report.text.readyLabel}</p>
              ) : (
                <AuditEvaluationReportWorkspace
                  caseId={state.caseId}
                  content={content}
                  section={report}
                />
              )}
            </>
          ) : (
            <p role="alert">
              {getCmsMessage(
                content,
                "event.auditQuoteEvaluationReport",
                state.kind === "disabled" ? "disabled" : "denied",
              )}
            </p>
          )}
        </div>
      </section>
      {state.kind === "authorized" ? (
        <SessionExitButton
          label={getCmsMessage(
            content,
            "event.auditQuoteEvaluationReport",
            "logoutLabel",
          )}
          previewMode={editingProps.previewMode}
        />
      ) : null}
      <CmsSupplementalSections
        pageKey="event.auditQuoteEvaluationReport"
        content={content}
        editing={editingProps.editing}
        selectedSectionId={editingProps.selectedSectionId}
        onSelectSection={editingProps.onSelectSection}
      />
    </main>
  );
}

function SessionExitButton({
  label,
  previewMode,
}: {
  label: string;
  previewMode?: boolean;
}) {
  const router = useRouter();
  async function exit() {
    if (previewMode) return;
    await fetch("/api/audit-evaluations/access/logout", {
      method: "POST",
    }).catch(() => undefined);
    router.replace("/events/audit-quote/evaluate");
    router.refresh();
  }
  return (
    <div className="audit-evaluation-session-exit">
      <button type="button" className="cta" onClick={exit}>
        {label}
      </button>
    </div>
  );
}

export function AuditEvaluationCmsPreview({
  pageKey,
  content,
  editing,
  selectedSectionId,
  onSelectSection,
}: {
  pageKey: CmsPageKey;
  content: CmsPageContent;
  editing?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const shared = {
    content,
    previewMode: true,
    editing,
    selectedSectionId,
    onSelectSection,
  };
  if (pageKey === "event.auditQuoteEvaluate") {
    return <AuditEvaluationStartPage {...shared} enabled />;
  }
  const state: CustomerPageState = {
    kind: "authorized",
    caseId: "preview-case",
    fiscalYear: 2027,
    currentQuoteCount: 2,
    minimumQuoteCount: 2,
    status: "ACCESS_PENDING",
    reportFeatureEnabled: true,
    reportAvailable: false,
  };
  if (pageKey === "event.auditQuoteEvaluation") {
    return <AuditEvaluationCasePage {...shared} state={state} />;
  }
  if (pageKey === "event.auditQuoteEvaluationReview") {
    return <AuditEvaluationReviewPage {...shared} state={state} />;
  }
  return <AuditEvaluationReportPage {...shared} state={state} />;
}
