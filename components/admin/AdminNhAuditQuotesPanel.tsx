"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { AdminOperationsCopy } from "@/lib/cms/admin-operations-content";
import type {
  AdminNhAuditCriterionView,
  AdminNhAuditQuoteView,
} from "@/lib/quotes/nh-audit-admin-view";

type SectionCopy = ReturnType<AdminOperationsCopy["section"]>;

const CRITERION_COPY_KEYS = {
  LOCAL_NONGHYUP_AUDIT_COUNT_2025: "quoteCriterionAuditCount",
  CERTIFIED_PUBLIC_ACCOUNTANT_COUNT: "quoteCriterionCpaCount",
  ACCOUNTING_FIRM_REVENUE: "quoteCriterionRevenue",
  AUDITED_NONGHYUP_TYPE_DIVERSITY_2025:
    "quoteCriterionTypeDiversity",
  NONGHYUP_TAX_AGENCY_PERFORMED_2025:
    "quoteCriterionTaxAgency",
  NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025:
    "quoteCriterionSubsidy",
} as const;

const BAND_COPY_KEYS: Record<string, string> = {
  "audit-count-0-4": "quoteBandAudit0To4",
  "audit-count-5-9": "quoteBandAudit5To9",
  "audit-count-10-19": "quoteBandAudit10To19",
  "audit-count-20-29": "quoteBandAudit20To29",
  "audit-count-30-39": "quoteBandAudit30To39",
  "audit-count-40-49": "quoteBandAudit40To49",
  "audit-count-50-plus": "quoteBandAudit50Plus",
  "cpa-count-0-6": "quoteBandCpa0To6",
  "cpa-count-7-10": "quoteBandCpa7To10",
  "cpa-count-11-15": "quoteBandCpa11To15",
  "cpa-count-16-19": "quoteBandCpa16To19",
  "cpa-count-20-plus": "quoteBandCpa20Plus",
  "revenue-up-to-500m": "quoteBandRevenueUpTo500m",
  "revenue-over-500m-up-to-2b": "quoteBandRevenue500mTo2b",
  "revenue-over-2b-up-to-5b": "quoteBandRevenue2bTo5b",
  "revenue-over-5b-up-to-8b": "quoteBandRevenue5bTo8b",
  "revenue-over-8b-up-to-10b": "quoteBandRevenue8bTo10b",
  "revenue-over-10b": "quoteBandRevenueOver10b",
  "type-diversity-0": "quoteBandType0",
  "type-diversity-1": "quoteBandType1",
  "type-diversity-2": "quoteBandType2",
  "type-diversity-3": "quoteBandType3",
  "type-diversity-4": "quoteBandType4",
  performed: "quoteBandPerformed",
  "not-performed": "quoteBandNotPerformed",
};

const TYPE_COPY_KEYS: Record<string, string> = {
  LOCAL_AGRICULTURAL_COOPERATIVE: "quoteTypeLocalAgricultural",
  LOCAL_LIVESTOCK_COOPERATIVE: "quoteTypeLocalLivestock",
  ITEM_AGRICULTURAL_OR_LIVESTOCK_COOPERATIVE:
    "quoteTypeItemCooperative",
  GINSENG_COOPERATIVE: "quoteTypeGinseng",
};

const MISSING_FIELD_COPY_KEYS: Record<string, string> = {
  engagementPartnerName: "quoteMissingEngagementPartner",
  proposerType: "quoteMissingProposerType",
  auditFeeWon: "quoteMissingAuditFee",
  expenseBillingMode: "quoteMissingExpenseMode",
  expectedExpenseWon: "quoteMissingExpectedExpense",
  localNonghyupAuditCount2025: "quoteMissingAuditCount",
  certifiedPublicAccountantCount: "quoteMissingCpaCount",
  accountingFirmRevenueWon: "quoteMissingRevenue",
  auditedNonghyupTypes2025: "quoteMissingAuditedTypes",
  nonghyupTaxAgencyPerformed2025: "quoteMissingTaxAgency",
  nonghyupSubsidySettlementPerformed2025:
    "quoteMissingSubsidy",
  factsConfirmed: "quoteMissingFactsConfirmed",
  evaluationSnapshot: "quoteMissingEvaluationSnapshot",
};

export function AdminNhAuditQuotesPanel({
  copy,
  quotes,
}: {
  copy: AdminOperationsCopy;
  quotes: readonly AdminNhAuditQuoteView[];
}) {
  const sectionCopy = useMemo(() => copy.section("partners"), [copy]);
  const [selectedQuoteId, setSelectedQuoteId] = useState("");
  const selectedQuote =
    quotes.find((quote) => quote.id === selectedQuoteId) ??
    quotes[0] ??
    null;

  return (
    <>
      <section className="admin-card admin-card--span-2 nh-audit-admin">
        <header className="admin-card__head">
          <div>
            <h2>{sectionCopy.text("quoteReviewTitle")}</h2>
            <p>{sectionCopy.text("quoteReviewDescription")}</p>
          </div>
        </header>
        {quotes.length === 0 ? (
          <p className="admin-empty">
            {sectionCopy.text("quoteReviewEmpty")}
          </p>
        ) : (
          <>
            <div className="admin-table-wrap nh-audit-admin__table-wrap">
              <table className="admin-table nh-audit-admin__table">
                <thead>
                  <tr>
                    <th>{sectionCopy.text("quoteTargetCooperativeLabel")}</th>
                    <th>{sectionCopy.text("quoteFiscalYearLabel")}</th>
                    <th>{sectionCopy.text("quoteAccountingFirmLabel")}</th>
                    <th>{sectionCopy.text("quoteEngagementPartnerLabel")}</th>
                    <th>{sectionCopy.text("quoteSubmittedAtLabel")}</th>
                    <th>{sectionCopy.text("quoteAuditFeeLabel")}</th>
                    <th>{sectionCopy.text("quoteExpectedTotalLabel")}</th>
                    <th>{sectionCopy.text("quoteQualityScoreLabel")}</th>
                    <th>{sectionCopy.text("quoteEvaluationStatusLabel")}</th>
                    <th>{sectionCopy.text("manageLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>{displayValue(quote.targetCooperativeName, sectionCopy)}</td>
                      <td>{displayValue(quote.fiscalYear, sectionCopy)}</td>
                      <td>{displayValue(quote.accountingFirmName, sectionCopy)}</td>
                      <td>{displayValue(quote.engagementPartnerName, sectionCopy)}</td>
                      <td>{formatDate(quote.submittedAt, sectionCopy)}</td>
                      <td>{formatWon(quote.cost?.auditFeeWon, sectionCopy)}</td>
                      <td>
                        {formatWon(
                          quote.cost?.expectedTotalBurdenWon,
                          sectionCopy,
                        )}
                      </td>
                      <td>{formatQualityScore(quote, sectionCopy)}</td>
                      <td>
                        <QuoteStatusBadge
                          quote={quote}
                          copy={sectionCopy}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="admin-link"
                          aria-controls="nh-audit-admin-detail"
                          aria-pressed={selectedQuote?.id === quote.id}
                          onClick={() => setSelectedQuoteId(quote.id)}
                        >
                          {sectionCopy.text("quoteViewDetail")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="nh-audit-admin__mobile-list">
              {quotes.map((quote) => (
                <li key={quote.id}>
                  <button
                    type="button"
                    aria-controls="nh-audit-admin-detail"
                    aria-pressed={selectedQuote?.id === quote.id}
                    onClick={() => setSelectedQuoteId(quote.id)}
                  >
                    <span>
                      <strong>
                        {displayValue(
                          quote.accountingFirmName,
                          sectionCopy,
                        )}
                      </strong>
                      <small>
                        {displayValue(
                          quote.targetCooperativeName,
                          sectionCopy,
                        )}{" "}
                        · {displayValue(quote.fiscalYear, sectionCopy)}
                      </small>
                    </span>
                    <span>
                      <QuoteStatusBadge quote={quote} copy={sectionCopy} />
                      <small>
                        {sectionCopy.text("quoteExpectedTotalLabel")}{" "}
                        {formatWon(
                          quote.cost?.expectedTotalBurdenWon,
                          sectionCopy,
                        )}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {selectedQuote ? (
        <QuoteDetail
          quote={selectedQuote}
          copy={sectionCopy}
        />
      ) : null}
    </>
  );
}

function QuoteDetail({
  quote,
  copy,
}: {
  quote: AdminNhAuditQuoteView;
  copy: SectionCopy;
}) {
  const input = quote.evaluationInput;
  return (
    <section
      id="nh-audit-admin-detail"
      className="admin-card admin-card--span-2 nh-audit-admin-detail"
      aria-labelledby="nh-audit-admin-detail-title"
    >
      <header className="admin-card__head">
        <div>
          <h2 id="nh-audit-admin-detail-title">
            {copy.text("quoteDetailTitle")}
          </h2>
          <p>
            {displayValue(quote.accountingFirmName, copy)} ·{" "}
            {displayValue(quote.targetCooperativeName, copy)}
          </p>
        </div>
        <QuoteStatusBadge quote={quote} copy={copy} />
      </header>

      <div className="nh-audit-admin-detail__sections">
        <DetailSection title={copy.text("quoteBasicInfoTitle")}>
          <DetailList
            items={[
              [copy.text("quoteTargetCooperativeLabel"), quote.targetCooperativeName],
              [copy.text("quoteFiscalYearLabel"), quote.fiscalYear],
              [copy.text("quoteAccountingFirmLabel"), quote.accountingFirmName],
              [copy.text("quoteEngagementPartnerLabel"), quote.engagementPartnerName],
              [
                copy.text("quoteProposerTypeLabel"),
                quote.proposerType
                  ? copy.text(
                      quote.proposerType === "AUDIT_GROUP"
                        ? "quoteAuditGroupProposer"
                        : "quoteAccountingFirmProposer",
                    )
                  : null,
              ],
              [copy.text("quoteSubmittedAtLabel"), formatDate(quote.submittedAt, copy)],
              [copy.text("quotePartnerOrganizationIdLabel"), quote.partnerOrganizationId],
              [copy.text("quotePartnerAccountIdLabel"), quote.partnerAccountId],
            ]}
            copy={copy}
          />
        </DetailSection>

        <DetailSection title={copy.text("quoteCostInfoTitle")}>
          <DetailList
            items={[
              [copy.text("quoteAuditFeeLabel"), formatWon(quote.cost?.auditFeeWon, copy)],
              [
                copy.text("quoteExpenseBillingModeLabel"),
                quote.cost
                  ? copy.text(
                      quote.cost.expenseBillingMode ===
                        "INCLUDED_IN_AUDIT_FEE"
                        ? "quoteExpenseIncluded"
                        : "quoteExpenseSeparate",
                    )
                  : null,
              ],
              [
                copy.text("quoteExpectedExpenseLabel"),
                formatWon(quote.cost?.expectedExpenseWon, copy),
              ],
              [
                copy.text("quoteSupplyAmountLabel"),
                formatWon(quote.cost?.supplyAmountWon, copy),
              ],
              [
                copy.text("quoteVatLabel"),
                formatWon(quote.cost?.vatWon, copy),
              ],
              [
                copy.text("quoteExpectedTotalLabel"),
                formatWon(quote.cost?.expectedTotalBurdenWon, copy),
              ],
            ]}
            copy={copy}
          />
        </DetailSection>

        <DetailSection title={copy.text("quoteEvaluationInputTitle")}>
          <DetailList
            items={[
              [
                copy.text("quoteLocalAuditCountLabel"),
                input
                  ? `${input.localNonghyupAuditCount2025.toLocaleString("ko-KR")}${copy.text("quoteCountUnit")}`
                  : null,
              ],
              [
                copy.text("quoteCpaCountLabel"),
                input
                  ? `${input.certifiedPublicAccountantCount.toLocaleString("ko-KR")}${copy.text("quotePeopleUnit")}`
                  : null,
              ],
              [
                copy.text("quoteRevenueLabel"),
                formatWon(input?.accountingFirmRevenueWon, copy),
              ],
              [
                copy.text("quoteAuditedTypesLabel"),
                input
                  ? input.auditedNonghyupTypes2025
                      .map((type) =>
                        copy.text(TYPE_COPY_KEYS[type] ?? "quoteUnavailable"),
                      )
                      .join(", ")
                  : null,
              ],
              [
                copy.text("quoteTaxAgencyLabel"),
                input
                  ? copy.text(
                      input.nonghyupTaxAgencyPerformed2025
                        ? "quoteYes"
                        : "quoteNo",
                    )
                  : null,
              ],
              [
                copy.text("quoteSubsidyLabel"),
                input
                  ? copy.text(
                      input.nonghyupSubsidySettlementPerformed2025
                        ? "quoteYes"
                        : "quoteNo",
                    )
                  : null,
              ],
              [
                copy.text("quoteFactsConfirmedLabel"),
                input
                  ? copy.text(
                      input.factsConfirmed
                        ? "quoteConfirmed"
                        : "quoteNotConfirmed",
                    )
                  : null,
              ],
            ]}
            copy={copy}
          />
        </DetailSection>

        <DetailSection title={copy.text("quoteQualityEvaluationTitle")}>
          {quote.quality ? (
            <div className="admin-table-wrap">
              <table className="admin-table nh-audit-admin__quality-table">
                <thead>
                  <tr>
                    <th>{copy.text("quoteCriterionLabel")}</th>
                    <th>{copy.text("quoteCriterionInputLabel")}</th>
                    <th>{copy.text("quoteCriterionWeightLabel")}</th>
                    <th>{copy.text("quoteCriterionBandLabel")}</th>
                    <th>{copy.text("quoteCriterionRateLabel")}</th>
                    <th>{copy.text("quoteCriterionScoreLabel")}</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.quality.criteria.map((criterion) => (
                    <tr key={criterion.criterionId}>
                      <td>
                        {copy.text(
                          CRITERION_COPY_KEYS[criterion.criterionId],
                        )}
                      </td>
                      <td>{formatCriterionInput(criterion, copy)}</td>
                      <td>
                        {criterion.weightPoints}
                        {copy.text("quotePointUnit")}
                      </td>
                      <td>
                        {copy.text(
                          BAND_COPY_KEYS[criterion.appliedBandId] ??
                            "quoteUnavailable",
                        )}
                      </td>
                      <td>
                        {formatRecognitionRate(
                          criterion.recognitionRateBasisPoints,
                        )}
                        {copy.text("quotePercentUnit")}
                      </td>
                      <td>
                        {criterion.earnedScoreOneDecimal}
                        {copy.text("quotePointUnit")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">{copy.text("quoteUnavailable")}</p>
          )}
        </DetailSection>

        <DetailSection title={copy.text("quoteResultStatusTitle")}>
          <DetailList
            items={[
              [copy.text("quoteQualityTotalLabel"), formatQualityScore(quote, copy)],
              [
                copy.text("quoteEligibilityLabel"),
                statusLabel(quote, copy),
              ],
              [
                copy.text("quoteIneligibilityReasonLabel"),
                reasonLabels(quote, copy),
              ],
              [
                copy.text("quoteEvaluationVersionLabel"),
                quote.evaluationStandardVersion,
              ],
              [
                copy.text("quoteEvaluatedAtLabel"),
                formatDate(quote.evaluatedAt, copy),
              ],
              [
                copy.text("quoteMissingFieldsLabel"),
                quote.missingFields.length > 0
                  ? quote.missingFields
                      .map((field) =>
                        copy.text(
                          MISSING_FIELD_COPY_KEYS[field] ??
                            "quoteUnavailable",
                        ),
                      )
                      .join(", ")
                  : copy.text("quoteNone"),
              ],
              [
                copy.text("quoteResubmissionReasonLabel"),
                quote.eligibilityStatus === "RESUBMISSION_REQUIRED"
                  ? reasonLabels(quote, copy)
                  : copy.text("quoteNone"),
              ],
              [
                copy.text("quoteRankingStatusLabel"),
                copy.text(
                  quote.includedInOverallRanking
                    ? "quoteRankingIncluded"
                    : "quoteRankingExcluded",
                ),
              ],
            ]}
            copy={copy}
          />
        </DetailSection>
      </div>
    </section>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="nh-audit-admin-detail__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailList({
  items,
  copy,
}: {
  items: Array<[string, string | number | null | undefined]>;
  copy: SectionCopy;
}) {
  return (
    <dl className="admin-detail-list nh-audit-admin-detail__list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{displayValue(value, copy)}</dd>
        </div>
      ))}
    </dl>
  );
}

function QuoteStatusBadge({
  quote,
  copy,
}: {
  quote: AdminNhAuditQuoteView;
  copy: SectionCopy;
}) {
  return (
    <span
      className={`nh-audit-status nh-audit-status--${quote.eligibilityStatus.toLowerCase()}`}
    >
      {statusLabel(quote, copy)}
    </span>
  );
}

function statusLabel(quote: AdminNhAuditQuoteView, copy: SectionCopy) {
  const key = {
    ELIGIBLE: "quoteStatusEligible",
    INELIGIBLE: "quoteStatusIneligible",
    RESUBMISSION_REQUIRED: "quoteStatusResubmissionRequired",
    EXCLUDED: "quoteStatusExcluded",
  }[quote.eligibilityStatus];
  return copy.text(key);
}

function reasonLabels(quote: AdminNhAuditQuoteView, copy: SectionCopy) {
  const labels = quote.reasonCodes.map((reason) =>
    copy.text(
      {
        AUDIT_GROUP_PROPOSER: "quoteReasonAuditGroup",
        LEGACY_DOCUMENT_MISSING_REQUIRED_FIELDS: "quoteReasonLegacy",
        SERVER_VALIDATION_FAILED: "quoteReasonValidation",
        ADMINISTRATIVELY_EXCLUDED: "quoteReasonAdminExcluded",
        NON_POSITIVE_TOTAL_BURDEN: "quoteReasonNonPositiveCost",
      }[reason],
    ),
  );
  return labels.join(" ") || copy.text("quoteNone");
}

function formatCriterionInput(
  criterion: AdminNhAuditCriterionView,
  copy: SectionCopy,
) {
  if (criterion.criterionId === "ACCOUNTING_FIRM_REVENUE") {
    return formatWon(String(criterion.inputValue), copy);
  }
  if (
    criterion.criterionId ===
    "AUDITED_NONGHYUP_TYPE_DIVERSITY_2025"
  ) {
    return Array.isArray(criterion.inputValue)
      ? criterion.inputValue
          .map((value) =>
            copy.text(TYPE_COPY_KEYS[String(value)] ?? "quoteUnavailable"),
          )
          .join(", ")
      : copy.text("quoteUnavailable");
  }
  if (
    criterion.criterionId ===
      "NONGHYUP_TAX_AGENCY_PERFORMED_2025" ||
    criterion.criterionId ===
      "NONGHYUP_SUBSIDY_SETTLEMENT_PERFORMED_2025"
  ) {
    return copy.text(criterion.inputValue ? "quoteYes" : "quoteNo");
  }
  const unit =
    criterion.criterionId === "CERTIFIED_PUBLIC_ACCOUNTANT_COUNT"
      ? copy.text("quotePeopleUnit")
      : copy.text("quoteCountUnit");
  return `${Number(criterion.inputValue).toLocaleString("ko-KR")}${unit}`;
}

function formatRecognitionRate(basisPoints: number) {
  const percent = basisPoints / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1);
}

function formatQualityScore(
  quote: AdminNhAuditQuoteView,
  copy: SectionCopy,
) {
  if (
    quote.eligibilityStatus === "RESUBMISSION_REQUIRED" ||
    !quote.quality
  ) {
    return copy.text("quoteUnavailable");
  }
  return `${quote.quality.scoreOneDecimal}${copy.text("quotePointUnit")}`;
}

function formatWon(value: string | undefined, copy: SectionCopy) {
  if (value === undefined) return copy.text("quoteUnavailable");
  try {
    return `${new Intl.NumberFormat("ko-KR").format(BigInt(value))}${copy.text("quoteWonUnit")}`;
  } catch {
    return copy.text("quoteUnavailable");
  }
}

function formatDate(value: string | null, copy: SectionCopy) {
  if (!value) return copy.text("quoteUnavailable");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.text("quoteUnavailable");
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function displayValue(
  value: string | number | null | undefined,
  copy: SectionCopy,
) {
  if (value === null || value === undefined || value === "") {
    return copy.text("quoteUnavailable");
  }
  return String(value);
}
