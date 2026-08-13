"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CmsSupplementalSections } from "@/components/cms/CmsSupplementalSections";
import { cmsEditableSectionProps } from "@/lib/cms/editable-section";
import type { CmsPageContent, CmsSection } from "@/lib/cms/schemas";
import { getCmsMessage } from "@/lib/cms/runtime";
import { normalizeWonAmount } from "@/lib/audit-evaluation/money";
import type {
  AuditEvaluationReviewWorkspace,
  ReviewWorkspaceQuote,
} from "@/lib/audit-evaluation/review-service";
import type {
  NormalizedAuditQuoteField,
} from "@/lib/audit-evaluation/types";

const COMPARISON_FIELDS = [
  "accountingFirmName",
  "auditFee",
  "vatIncluded",
  "accountingFirmRevenue",
  "recentNonghyupAuditCount",
  "auditedNonghyupTypes",
  "taxAgencyExperience",
  "subsidySettlementExperience",
  "engagementPartner",
  "engagementTeam",
  "totalPlannedHours",
  "auditSchedule",
  "qualityControlPlan",
  "requiredProposalItems",
] as const satisfies readonly NormalizedAuditQuoteField[];

type ComparisonField = (typeof COMPARISON_FIELDS)[number];
type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";
type EditorState = {
  quoteId: string;
  field: ComparisonField;
  valueText: string;
  reason: string;
  expectedRevision: number;
};

export function AuditQuoteReviewWorkspace({
  caseId,
  content,
  sections,
  reportFeatureEnabled = true,
  previewMode = false,
  editing = false,
  selectedSectionId,
  onSelectSection,
}: {
  caseId: string;
  content: CmsPageContent;
  sections: {
    documents: CmsSection;
    keyCards: CmsSection;
    comparison: CmsSection;
    corrections: CmsSection;
    actions: CmsSection;
  };
  reportFeatureEnabled?: boolean;
  previewMode?: boolean;
  editing?: boolean;
  selectedSectionId?: string;
  onSelectSection?: (sectionId: string) => void;
}) {
  const [workspace, setWorkspace] =
    useState<AuditEvaluationReviewWorkspace | null>(
      previewMode ? createPreviewWorkspace() : null,
    );
  const [loadError, setLoadError] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [finalChecked, setFinalChecked] = useState(false);
  const [actionState, setActionState] = useState<
    | "idle"
    | "confirming"
    | "confirmed"
    | "confirmError"
  >("idle");
  const saveSequence = useRef(0);
  const lastSavedCorrection = useRef("");

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    void loadWorkspace(caseId).then((next) => {
      if (!active) return;
      if (next) setWorkspace(next);
      else setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, [caseId, previewMode]);

  useEffect(() => {
    if (
      previewMode ||
      !editor ||
      !editor.valueText.trim() ||
      editor.reason.trim().length < 2
    ) {
      return;
    }
    const signature = [
      editor.quoteId,
      editor.field,
      editor.valueText,
      editor.reason,
    ].join("\u0000");
    if (lastSavedCorrection.current === signature) return;
    const sequence = saveSequence.current + 1;
    saveSequence.current = sequence;
    const timer = window.setTimeout(() => {
      setSaveState("saving");
      void saveCorrection(caseId, editor, editor.expectedRevision).then(
        async (result) => {
          if (result === "conflict") {
            const latest = await loadWorkspace(caseId);
            if (latest) setWorkspace(latest);
            setEditor(null);
            setSaveState("conflict");
            return;
          }
          if (result === "error") {
            setSaveState("error");
            return;
          }
          lastSavedCorrection.current = signature;
          const latest = await loadWorkspace(caseId);
          if (latest) {
            setWorkspace(latest);
            const latestQuote = latest.quotes.find(
              ({ quoteId }) => quoteId === editor.quoteId,
            );
            if (latestQuote) {
              setEditor((current) =>
                current
                  ? { ...current, expectedRevision: latestQuote.revision }
                  : current
              );
            }
          }
          if (saveSequence.current === sequence) {
            setSaveState("saved");
          }
        },
      );
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [caseId, editor, previewMode]);

  if (!workspace) {
    return (
      <p role={loadError ? "alert" : "status"}>
        {getCmsMessage(
          content,
          "event.auditQuoteEvaluationReview",
          loadError ? "workspaceFailed" : "workspacePending",
        )}
      </p>
    );
  }

  const {
    documents,
    keyCards,
    comparison,
    corrections,
    actions,
  } = sections;
  const finalConfirmed = workspace.finalConfirmed || actionState === "confirmed";
  const canConfirm =
    workspace.readiness.ready && finalChecked && !finalConfirmed;

  async function refreshWorkspace() {
    const latest = await loadWorkspace(caseId);
    if (latest) setWorkspace(latest);
    return latest;
  }

  async function confirmFinal() {
    if (!workspace || previewMode) return;
    if (!finalChecked) {
      setActionState("confirmError");
      return;
    }
    setActionState("confirming");
    const response = await fetch(
      `/api/audit-evaluations/${encodeURIComponent(caseId)}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          finalAcknowledged: true,
          expectedQuoteRevisions: Object.fromEntries(
            workspace.quotes.map(({ quoteId, revision }) => [
              quoteId,
              revision,
            ]),
          ),
        }),
      },
    );
    if (!response.ok) {
      await refreshWorkspace();
      setActionState("confirmError");
      return;
    }
    await refreshWorkspace();
    setFinalChecked(false);
    setActionState("confirmed");
  }

  function openEditor(quote: ReviewWorkspaceQuote, field: ComparisonField) {
    setEditor({
      quoteId: quote.quoteId,
      field,
      valueText: editableValue(quote, field, keyCards),
      reason: "",
      expectedRevision: quote.revision,
    });
    lastSavedCorrection.current = "";
    setSaveState("idle");
  }

  return (
    <div className="audit-review">
      <section
        {...reviewSectionProps(
          documents,
          editing,
          selectedSectionId,
          onSelectSection,
        )}
        aria-labelledby="review-documents"
      >
        <h2 id="review-documents">{documents.title}</h2>
        {workspace.documents.length === 0 ? (
          <p>{documents.text.emptyLabel}</p>
        ) : (
          <ul
            className="audit-review__documents"
            aria-label={documents.text.listAriaLabel}
          >
            {workspace.documents.map((document) => (
              <li key={document.id}>
                <strong>{document.safeDisplayName}</strong>
                <span className={`audit-review__badge is-${document.customerStatus.toLowerCase()}`}>
                  {documentStatusLabel(document.customerStatus, documents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        {...reviewSectionProps(
          keyCards,
          editing,
          selectedSectionId,
          onSelectSection,
        )}
        aria-labelledby="review-key-cards"
      >
        <h2 id="review-key-cards">{keyCards.title}</h2>
        <div className="audit-review__key-cards">
          {workspace.quotes.map((quote) => (
            <article key={quote.quoteId} className="audit-review__key-card">
              <h3>
                {quote.accountingFirmName || keyCards.text.missingLabel}
              </h3>
              <dl>
                <KeyValue
                  label={keyCards.text.auditFeeLabel}
                  value={formatMoney(quote.auditFee, keyCards)}
                />
                <KeyValue
                  label={keyCards.text.vatLabel}
                  value={formatVat(quote.vatIncluded, keyCards)}
                />
                <KeyValue
                  label={keyCards.text.revenueLabel}
                  value={formatMoney(quote.accountingFirmRevenue, keyCards)}
                />
                <KeyValue
                  label={keyCards.text.auditCountLabel}
                  value={formatCount(
                    quote.recentNonghyupAuditCount,
                    keyCards.text.countUnit,
                    keyCards.text.missingLabel,
                  )}
                />
                <KeyValue
                  label={keyCards.text.hoursLabel}
                  value={formatCount(
                    quote.totalPlannedHours,
                    keyCards.text.hourUnit,
                    keyCards.text.missingLabel,
                  )}
                />
              </dl>
              {quote.trustedMismatchFields.length > 0 ? (
                <p className="audit-review__warning" role="alert">
                  {keyCards.text.trustedMismatchLabel}
                </p>
              ) : null}
              {(quote.pendingAdminReviewFields?.length ?? 0) > 0 ? (
                <p className="audit-review__warning" role="status">
                  {keyCards.text.adminReviewLabel}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => openEditor(quote, "auditFee")}
              >
                {corrections.text.editLabel}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section
        {...reviewSectionProps(
          comparison,
          editing,
          selectedSectionId,
          onSelectSection,
        )}
        aria-labelledby="review-comparison"
      >
        <div className="audit-review__heading">
          <h2 id="review-comparison">{comparison.title}</h2>
          <div className="audit-review__view-toggle">
            <button
              type="button"
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              {comparison.text.tableViewLabel}
            </button>
            <button
              type="button"
              aria-pressed={viewMode === "cards"}
              onClick={() => setViewMode("cards")}
            >
              {comparison.text.cardViewLabel}
            </button>
          </div>
        </div>
        <QuoteComparisonTable
          quotes={workspace.quotes}
          section={comparison}
          correctionSection={corrections}
          visible={viewMode === "table"}
          onEdit={openEditor}
        />
        <QuoteComparisonCards
          quotes={workspace.quotes}
          section={comparison}
          correctionSection={corrections}
          visible={viewMode === "cards"}
          onEdit={openEditor}
        />
      </section>

      <section
        {...reviewSectionProps(
          corrections,
          editing,
          selectedSectionId,
          onSelectSection,
        )}
        aria-labelledby="review-corrections"
      >
        <h2 id="review-corrections">{corrections.title}</h2>
        <ReviewIssues
          workspace={workspace}
          comparison={comparison}
          corrections={corrections}
        />
        {!editor && saveState === "conflict" ? (
          <p role="alert">{corrections.text.conflictLabel}</p>
        ) : null}
        {editor ? (
          <div className="audit-review__editor">
            <div className="audit-review__heading">
              <h3>
                {fieldLabel(editor.field, comparison)}
              </h3>
              <button type="button" onClick={() => setEditor(null)}>
                {corrections.text.closeLabel}
              </button>
            </div>
            <CorrectionValueInput
              editor={editor}
              comparison={comparison}
              corrections={corrections}
              onChange={(valueText) =>
                setEditor((current) =>
                  current ? { ...current, valueText } : current
                )}
            />
            <label>
              {corrections.text.reasonLabel}
              <textarea
                value={editor.reason}
                placeholder={corrections.text.reasonPlaceholder}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current
                  )}
              />
            </label>
            <p>{corrections.text.formatHelp}</p>
            <p>{corrections.text.autoSaveLabel}</p>
            <p role={saveState === "error" ? "alert" : "status"}>
              {saveStateLabel(saveState, corrections, content)}
            </p>
          </div>
        ) : null}
      </section>

      <section
        {...reviewSectionProps(
          actions,
          editing,
          selectedSectionId,
          onSelectSection,
        )}
        aria-labelledby="review-actions"
      >
        <h2 id="review-actions">{actions.title}</h2>
        <label className="audit-review__final-check">
          <input
            type="checkbox"
            checked={finalChecked}
            disabled={finalConfirmed}
            onChange={(event) => setFinalChecked(event.target.checked)}
          />
          <span>{actions.text.finalCheckLabel}</span>
        </label>
        <div className="audit-review__actions">
          <button
            type="button"
            className="cta cta--ghost"
            disabled={!canConfirm || actionState === "confirming"}
            onClick={() => void confirmFinal()}
          >
            {actions.text.confirmLabel}
          </button>
          {reportFeatureEnabled && workspace.canRequestReport ? (
            <Link
              className="cta cta--solid"
              href={`/events/audit-quote/evaluations/${encodeURIComponent(caseId)}/report`}
            >
              {actions.text.generateLabel}
            </Link>
          ) : null}
        </div>
        {!workspace.readiness.ready ? (
          <p role="alert">
            {getCmsMessage(
              content,
              "event.auditQuoteEvaluationReview",
              "readinessBlocked",
            )}
          </p>
        ) : null}
        {finalConfirmed ? (
          <p role="status">{actions.text.confirmedLabel}</p>
        ) : null}
        {reportFeatureEnabled &&
        (
          workspace.evaluationCase.status === "GENERATING" ||
          workspace.evaluationCase.status === "COMPLETED" ||
          workspace.evaluationCase.status === "FAILED"
        ) ? (
          <Link
            className="cta cta--ghost"
            href={`/events/audit-quote/evaluations/${encodeURIComponent(caseId)}/report`}
          >
            {actions.text.reportOpenLabel}
          </Link>
        ) : null}
        {actionState === "confirmError" ? (
          <p role="alert">
            {getCmsMessage(
              content,
              "event.auditQuoteEvaluationReview",
              finalChecked
                ? "confirmationFailed"
                : "finalCheckRequired",
            )}
          </p>
        ) : null}
      </section>
      <CmsSupplementalSections
        pageKey="event.auditQuoteEvaluationReview"
        content={content}
        editing={editing}
        selectedSectionId={selectedSectionId}
        onSelectSection={onSelectSection}
      />
    </div>
  );
}

function reviewSectionProps(
  section: CmsSection,
  editing: boolean,
  selectedSectionId: string | undefined,
  onSelectSection: ((sectionId: string) => void) | undefined,
) {
  return cmsEditableSectionProps(section, "audit-review__block", {
    editing,
    selectedSectionId,
    onSelectSection,
  });
}

function QuoteComparisonTable({
  quotes,
  section,
  correctionSection,
  visible,
  onEdit,
}: {
  quotes: ReviewWorkspaceQuote[];
  section: CmsSection;
  correctionSection: CmsSection;
  visible: boolean;
  onEdit: (quote: ReviewWorkspaceQuote, field: ComparisonField) => void;
}) {
  return (
    <div
      className={`audit-review__table-wrap${visible ? "" : " is-hidden"}`}
    >
      <table className="audit-review__table">
        <caption>{section.text.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{section.title}</th>
            {quotes.map((quote) => (
              <th key={quote.quoteId} scope="col">
                {quote.accountingFirmName || section.text.missingLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARISON_FIELDS.map((field) => (
            <tr key={field}>
              <th scope="row">{fieldLabel(field, section)}</th>
              {quotes.map((quote) => (
                <td key={`${quote.quoteId}-${field}`}>
                  <ExpandableValue
                    value={formatFieldValue(quote, field, section)}
                    section={section}
                  />
                  <button type="button" onClick={() => onEdit(quote, field)}>
                    {correctionSection.text.editLabel}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuoteComparisonCards({
  quotes,
  section,
  correctionSection,
  visible,
  onEdit,
}: {
  quotes: ReviewWorkspaceQuote[];
  section: CmsSection;
  correctionSection: CmsSection;
  visible: boolean;
  onEdit: (quote: ReviewWorkspaceQuote, field: ComparisonField) => void;
}) {
  return (
    <div
      className={`audit-review__comparison-cards${visible ? "" : " is-hidden"}`}
    >
      {quotes.map((quote) => (
        <article key={quote.quoteId}>
          <h3>{quote.accountingFirmName || section.text.missingLabel}</h3>
          <dl>
            {COMPARISON_FIELDS.map((field) => (
              <div key={field}>
                <dt>{fieldLabel(field, section)}</dt>
                <dd>
                  <ExpandableValue
                    value={formatFieldValue(quote, field, section)}
                    section={section}
                  />
                  <button type="button" onClick={() => onEdit(quote, field)}>
                    {correctionSection.text.editLabel}
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

function ReviewIssues({
  workspace,
  comparison,
  corrections,
}: {
  workspace: AuditEvaluationReviewWorkspace;
  comparison: CmsSection;
  corrections: CmsSection;
}) {
  if (workspace.readiness.issues.length === 0) {
    return <p>{corrections.text.noWarningsLabel}</p>;
  }
  const quotes = new Map(
    workspace.quotes.map((quote) => [quote.quoteId, quote]),
  );
  return (
    <ul aria-label={corrections.text.warningListLabel}>
      {workspace.readiness.issues.map((issue, index) => {
        const quote = issue.quoteId ? quotes.get(issue.quoteId) : null;
        return (
          <li key={`${issue.code}-${issue.quoteId ?? "case"}-${issue.field ?? index}`}>
            {quote?.accountingFirmName ?? corrections.title}
            {issue.field ? ` · ${fieldLabel(issue.field, comparison)}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

function CorrectionValueInput({
  editor,
  comparison,
  corrections,
  onChange,
}: {
  editor: EditorState;
  comparison: CmsSection;
  corrections: CmsSection;
  onChange: (value: string) => void;
}) {
  if (editor.field === "vatIncluded") {
    return (
      <label>
        {corrections.text.valueLabel}
        <select
          value={editor.valueText}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="부가세 포함">
            {comparison.text.vatIncludedValueLabel}
          </option>
          <option value="부가세 별도">
            {comparison.text.vatExcludedValueLabel}
          </option>
        </select>
      </label>
    );
  }
  return (
    <label>
      {corrections.text.valueLabel}
      <textarea
        value={editor.valueText}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ExpandableValue({
  value,
  section,
}: {
  value: string;
  section: CmsSection;
}) {
  if (value.length <= 80) return <span>{value}</span>;
  return (
    <details>
      <summary>{section.text.expandLabel}</summary>
      <p>{value}</p>
    </details>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function fieldLabel(field: NormalizedAuditQuoteField, section: CmsSection) {
  const key = `${field}Label`;
  return section.text[key] ?? field;
}

function formatFieldValue(
  quote: ReviewWorkspaceQuote,
  field: ComparisonField,
  section: CmsSection,
) {
  const missing = section.text.missingLabel;
  if (field === "accountingFirmName") return quote.accountingFirmName || missing;
  if (field === "auditFee") return quote.auditFee ? formatWon(quote.auditFee) : missing;
  if (field === "vatIncluded") {
    return quote.vatIncluded === null
      ? missing
      : quote.vatIncluded
        ? section.text.vatIncludedValueLabel
        : section.text.vatExcludedValueLabel;
  }
  if (field === "accountingFirmRevenue") {
    return quote.accountingFirmRevenue
      ? formatWon(quote.accountingFirmRevenue)
      : missing;
  }
  if (field === "recentNonghyupAuditCount") {
    return quote.recentNonghyupAuditCount === null
      ? missing
      : String(quote.recentNonghyupAuditCount);
  }
  if (field === "auditedNonghyupTypes") {
    return quote.auditedNonghyupTypes.join(", ") || missing;
  }
  if (
    field === "taxAgencyExperience" ||
    field === "subsidySettlementExperience"
  ) {
    const experience = quote[field];
    return experience.hasExperience
      ? experience.descriptions.join(", ") || section.text.yesLabel
      : section.text.noLabel;
  }
  if (field === "engagementPartner") {
    return quote.engagementPartner
      ? [
          quote.engagementPartner.name,
          quote.engagementPartner.title,
          quote.engagementPartner.yearsOfExperience,
        ].filter((item) => item !== null && item !== "").join(" · ")
      : missing;
  }
  if (field === "engagementTeam") {
    return quote.engagementTeam
      .map(({ name, role, plannedHours }) =>
        [name, role, plannedHours].filter((item) => item !== null).join(" · ")
      )
      .join("; ") || missing;
  }
  if (field === "totalPlannedHours") {
    return quote.totalPlannedHours === null
      ? missing
      : String(quote.totalPlannedHours);
  }
  if (field === "auditSchedule") {
    return quote.auditSchedule
      .map(({ label, startsOn, endsOn }) =>
        [label, startsOn, endsOn].filter(Boolean).join(" · ")
      )
      .join("; ") || missing;
  }
  if (field === "qualityControlPlan") {
    return quote.qualityControlPlan.join("; ") || missing;
  }
  const items = Object.entries(quote.requiredProposalItems);
  return items.length > 0
    ? items
        .map(([id, item]) =>
          `${id}: ${item.present ? section.text.presentLabel : section.text.absentLabel}`
        )
        .join("; ")
    : missing;
}

function editableValue(
  quote: ReviewWorkspaceQuote,
  field: ComparisonField,
  section: CmsSection,
) {
  if (field === "auditFee" || field === "accountingFirmRevenue") {
    const value = quote[field];
    return value ? `${value} 원` : "";
  }
  if (field === "vatIncluded") {
    return quote.vatIncluded ? "부가세 포함" : "부가세 별도";
  }
  if (
    field === "taxAgencyExperience" ||
    field === "subsidySettlementExperience"
  ) {
    const value = quote[field];
    return value.hasExperience
      ? value.descriptions.join("\n") || section.text.yesLabel
      : section.text.noLabel;
  }
  if (field === "engagementPartner") {
    const value = quote.engagementPartner;
    return value
      ? `${value.name} | ${value.title ?? ""} | ${value.yearsOfExperience ?? ""}`
      : "";
  }
  if (field === "engagementTeam") {
    return quote.engagementTeam
      .map(({ name, role, plannedHours }) =>
        `${name} | ${role} | ${plannedHours ?? ""}`
      )
      .join("\n");
  }
  if (field === "auditSchedule") {
    return quote.auditSchedule
      .map(({ label, startsOn, endsOn }) =>
        `${label} | ${startsOn ?? ""} | ${endsOn ?? ""}`
      )
      .join("\n");
  }
  if (field === "requiredProposalItems") {
    return Object.entries(quote.requiredProposalItems)
      .map(([id, item]) =>
        `${id} | ${item.present ? "충족" : "미충족"} | ${item.value ?? ""}`
      )
      .join("\n");
  }
  const value = quote[field];
  if (Array.isArray(value)) return value.join("\n");
  return value === null || value === undefined ? "" : String(value);
}

function formatMoney(value: string | null, section: CmsSection) {
  return value
    ? `${formatWon(value)} ${section.text.wonUnit}`
    : section.text.missingLabel;
}

function formatWon(value: string) {
  return BigInt(value).toLocaleString("ko-KR");
}

function formatVat(value: boolean | null, section: CmsSection) {
  if (value === null) return section.text.missingLabel;
  return value
    ? section.text.vatIncludedLabel
    : section.text.vatExcludedLabel;
}

function formatCount(
  value: number | null,
  unit: string,
  missing: string,
) {
  return value === null ? missing : `${value.toLocaleString("ko-KR")} ${unit}`;
}

function documentStatusLabel(
  status: AuditEvaluationReviewWorkspace["documents"][number]["customerStatus"],
  section: CmsSection,
) {
  if (status === "UPLOADED") return section.text.uploadedLabel;
  if (status === "CHECKING") return section.text.checkingLabel;
  if (status === "NEEDS_INFORMATION") {
    return section.text.needsInformationLabel;
  }
  if (status === "READY") return section.text.readyLabel;
  return section.text.failedLabel;
}

function saveStateLabel(
  state: SaveState,
  section: CmsSection,
  content: CmsPageContent,
) {
  if (state === "saving") return section.text.savingLabel;
  if (state === "saved") return section.text.savedLabel;
  if (state === "conflict") return section.text.conflictLabel;
  if (state === "error") {
    return getCmsMessage(
      content,
      "event.auditQuoteEvaluationReview",
      "correctionFailed",
    );
  }
  return "";
}

async function loadWorkspace(caseId: string) {
  const response = await fetch(
    `/api/audit-evaluations/${encodeURIComponent(caseId)}/review`,
    { cache: "no-store" },
  );
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    workspace?: AuditEvaluationReviewWorkspace;
  } | null;
  return response.ok && data?.ok && data.workspace ? data.workspace : null;
}

async function saveCorrection(
  caseId: string,
  editor: EditorState,
  expectedRevision: number,
) {
  const response = await fetch(
    `/api/audit-evaluations/${encodeURIComponent(caseId)}/quotes/${encodeURIComponent(editor.quoteId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        field: editor.field,
        valueText: editor.valueText,
        reason: editor.reason,
        expectedRevision,
      }),
    },
  );
  if (response.status === 409) return "conflict" as const;
  return response.ok ? "saved" as const : "error" as const;
}

function createPreviewWorkspace(): AuditEvaluationReviewWorkspace {
  const quote = {
    quoteId: "preview-quote",
    accountingFirmName: "예시 회계법인",
    auditFee: normalizeWonAmount("55000000"),
    vatIncluded: true,
    accountingFirmRevenue: normalizeWonAmount("120000000000"),
    recentNonghyupAuditCount: 8,
    auditedNonghyupTypes: ["지역농협", "품목농협"],
    taxAgencyExperience: { hasExperience: true, descriptions: ["세무대리 수행"] },
    subsidySettlementExperience: { hasExperience: true, descriptions: ["정산 검증 수행"] },
    engagementPartner: { name: "책임 회계사", title: "파트너", yearsOfExperience: 18 },
    engagementTeam: [{ name: "담당 회계사", role: "매니저", plannedHours: 120 }],
    totalPlannedHours: 320,
    auditSchedule: [{ id: "preview", label: "감사 계획", startsOn: "2027-01-10", endsOn: "2027-01-20" }],
    qualityControlPlan: ["독립 품질관리 검토자가 최종 결과를 검토합니다."],
    requiredProposalItems: { independence: { present: true, value: "확인" } },
    confirmedByCustomer: false,
    revision: 0,
    pendingAdminReviewFields: [],
    trustedMismatchFields: [],
  } satisfies ReviewWorkspaceQuote;
  return {
    evaluationCase: {
      id: "preview-case",
      fiscalYear: 2027,
      status: "NEEDS_REVIEW",
      confirmationVersion: null,
      reportRequestedConfirmationVersion: null,
    },
    documents: [{
      id: "preview-document",
      safeDisplayName: "example.pdf",
      scanStatus: "CLEAN",
      parsingStatus: "PARSED",
      matchStatus: "LEGACY_DOCUMENT",
      integrityStatus: "PENDING",
      customerStatus: "READY",
    }],
    quotes: [quote],
    readiness: {
      ready: false,
      minimumQuoteCount: 2,
      distinctFirmCount: 1,
      issues: [{
        code: "NOT_ENOUGH_DISTINCT_FIRMS",
        quoteId: null,
        field: null,
      }],
    },
    finalConfirmed: false,
    canRequestReport: false,
  };
}
