import path from "node:path";
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { QuoteRecord, QuoteRequestRecord } from "@/lib/firebase/schema";
import {
  quoteConditionRows,
  quoteDisplayNumber,
  quoteDocumentTitle,
  quoteEvaluationCapacityRows,
  quoteIssueDate,
  quotePartnerCredentialRows,
  quotePartnerEvaluationFactRows,
  quoteRecipient,
} from "@/lib/quotes/quote-presentation";
import { formatQuoteVersionLabel } from "@/lib/quotes/quote-revision";
import { quoteComparisonReportUrl } from "@/lib/quotes/quote-comparison-link";
import {
  quoteDocumentContentFromCms,
  type QuoteDocumentContent,
} from "@/lib/quotes/quote-document-content";
import { renderQuoteComparisonQrDataUri } from "@/lib/quotes/quote-pdf-qr";

const FONT_FAMILY = "NH-Pretendard-Quote";
const NAVY = "#1B365D";
const NAVY_SOFT = "#E8EEF5";
const RULE = "#D7DEE8";
const MUTED = "#5B6B7C";
const INK = "#1A2332";
const PRETENDARD_PACKAGE_ROOT = path.join(
  process.cwd(),
  "node_modules",
  "pretendard",
);
const staticFont = (fileName: string) =>
  path.join(
    PRETENDARD_PACKAGE_ROOT,
    "dist",
    "public",
    "static",
    "alternative",
    fileName,
  );

Font.register({
  family: FONT_FAMILY,
  fonts: [
    { src: staticFont("Pretendard-Regular.ttf"), fontWeight: 400 },
    { src: staticFont("Pretendard-SemiBold.ttf"), fontWeight: 600 },
    { src: staticFont("Pretendard-Bold.ttf"), fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingHorizontal: 32,
    paddingBottom: 58,
    fontFamily: FONT_FAMILY,
    fontSize: 9.5,
    color: INK,
  },
  runningHeader: {
    position: "absolute",
    top: 18,
    left: 32,
    right: 32,
    height: 22,
    borderBottomWidth: 1.5,
    borderBottomColor: NAVY,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 4,
  },
  runningBrand: {
    color: NAVY,
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.4,
  },
  runningMeta: {
    color: MUTED,
    fontSize: 7.5,
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  brandBlock: {
    flexGrow: 1,
    paddingRight: 16,
    maxWidth: "62%",
  },
  logo: { width: 92, height: 34, objectFit: "contain", marginBottom: 8 },
  logoPlaceholder: {
    color: MUTED,
    fontSize: 7.5,
    marginBottom: 8,
  },
  companyName: {
    fontSize: 15,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 4,
  },
  brandLine: {
    color: MUTED,
    fontSize: 8,
    lineHeight: 1.45,
  },
  quoteMeta: {
    width: 196,
    alignItems: "flex-end",
  },
  documentKind: {
    fontSize: 22,
    fontWeight: 700,
    color: "#7A93B2",
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  metaTable: {
    width: 196,
    borderWidth: 1,
    borderColor: RULE,
  },
  metaRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  metaLabel: {
    width: 78,
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: NAVY_SOFT,
    color: NAVY,
    fontSize: 7.5,
    fontWeight: 700,
  },
  metaValue: {
    flexGrow: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 8,
    textAlign: "right",
  },
  subject: {
    fontSize: 11,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 12,
    lineHeight: 1.4,
  },
  sectionBar: {
    backgroundColor: NAVY,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  sectionBarText: {
    color: "#ffffff",
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 0.6,
  },
  panel: {
    borderWidth: 1,
    borderColor: RULE,
    borderTopWidth: 0,
    padding: 8,
    marginBottom: 10,
  },
  twoCol: {
    flexDirection: "row",
  },
  col: { flexGrow: 1, flexBasis: 0, paddingRight: 10 },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 0.6,
    borderBottomColor: "#EEF2F6",
  },
  factRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  factLabel: {
    width: 108,
    color: MUTED,
    fontSize: 8,
    flexShrink: 0,
  },
  factValue: {
    flexGrow: 1,
    fontSize: 9,
    fontWeight: 600,
    color: INK,
    textAlign: "right",
  },
  help: {
    color: MUTED,
    fontSize: 7.5,
    marginBottom: 8,
    lineHeight: 1.4,
  },
  supplierRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  supplierFacts: {
    flexGrow: 1,
    flexShrink: 1,
    paddingRight: 16,
  },
  sealBox: {
    width: 72,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  seal: { width: 68, height: 68, objectFit: "contain" },
  sealPlaceholder: { color: MUTED, fontSize: 8, textAlign: "center" },
  intro: {
    marginBottom: 8,
    fontSize: 10,
    fontWeight: 600,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: NAVY,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  tableRowAlt: {
    backgroundColor: "#F5F7FA",
  },
  th: {
    color: "#ffffff",
    fontWeight: 700,
    fontSize: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  td: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8.5,
  },
  itemName: { fontWeight: 600 },
  itemDesc: { color: MUTED, fontSize: 7.5, marginTop: 2 },
  colName: { width: "46%" },
  colQty: { width: "12%", textAlign: "right" },
  colMoney: { width: "21%", textAlign: "right" },
  bottomRow: {
    flexDirection: "row",
    marginTop: 12,
    alignItems: "flex-start",
    width: "100%",
  },
  termsCol: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    paddingRight: 16,
    minWidth: 0,
  },
  termLine: {
    fontSize: 8,
    lineHeight: 1.5,
    marginBottom: 3,
  },
  totals: {
    width: 210,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: RULE,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: RULE,
  },
  grandTotal: {
    backgroundColor: NAVY_SOFT,
    borderBottomWidth: 0,
  },
  grandTotalText: {
    fontSize: 11,
    fontWeight: 700,
    color: NAVY,
  },
  comparison: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: RULE,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    width: "100%",
  },
  qrImage: {
    width: 56,
    height: 56,
    marginRight: 8,
    flexShrink: 0,
  },
  comparisonCopy: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    paddingRight: 4,
  },
  comparisonTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 4,
  },
  comparisonHelp: {
    color: MUTED,
    fontSize: 7.5,
    lineHeight: 1.5,
  },
  footer: {
    position: "absolute",
    left: 32,
    right: 32,
    bottom: 18,
    borderTopWidth: 1,
    borderTopColor: RULE,
    paddingTop: 6,
    alignItems: "center",
  },
  footerLine: {
    color: MUTED,
    fontSize: 7.5,
    textAlign: "center",
    lineHeight: 1.4,
  },
  thankYou: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: 700,
    color: NAVY,
    textAlign: "center",
  },
});

const money = (value: number, suffix: string) =>
  `${value.toLocaleString("ko-KR")}${suffix}`;

export async function renderQuotePdf(input: {
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
  logoDataUri?: string;
  sealDataUri?: string;
  documentContent?: QuoteDocumentContent;
}) {
  const comparisonUrl = quoteComparisonReportUrl({
    quote: input.quote,
    quoteRequest: input.quoteRequest,
  });
  const qrDataUri = await renderQuoteComparisonQrDataUri(comparisonUrl);
  return renderToBuffer(
    <QuotePdfDocument {...input} qrDataUri={qrDataUri} />,
  );
}

function QuotePdfDocument({
  quote,
  quoteRequest,
  logoDataUri,
  sealDataUri,
  qrDataUri,
  documentContent = quoteDocumentContentFromCms(),
}: {
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
  logoDataUri?: string;
  sealDataUri?: string;
  qrDataUri: string;
  documentContent?: QuoteDocumentContent;
}) {
  const { copy, style: cmsStyle } = documentContent;
  const documentTitle = quoteDocumentTitle(quote, quoteRequest, copy);
  const displayNumber = quoteDisplayNumber(quote, quoteRequest);
  const recipient = quoteRecipient(quoteRequest, copy);
  const conditionRows = quoteConditionRows(quote, copy);
  const credentialRows = quotePartnerCredentialRows(quote, copy);
  const evaluationFactRows = quotePartnerEvaluationFactRows(quote, copy);
  const capacityRows = quoteEvaluationCapacityRows(quote, copy);
  const issueDate = quoteIssueDate(quote) || copy.missingValue;
  const contactLine = [quote.supplierContactName, quote.supplierContactPhone, quote.supplierContactEmail]
    .filter(Boolean)
    .join(" · ");
  const titleStyle = cmsTitleStyle(cmsStyle);
  const bodyStyle = cmsBodyStyle(cmsStyle);
  const sectionStyle = cmsSectionStyle(cmsStyle);

  return (
    <Document
      title={documentTitle}
      author={quote.partnerName}
      subject={quoteRequest.subject}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.brandRow} wrap={false}>
          <View style={styles.brandBlock}>
            {logoDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
              <Image src={logoDataUri} style={styles.logo} />
            ) : (
              <Text style={styles.logoPlaceholder}>
                {copy.logoMissing || "제휴사 로고 미등록"}
              </Text>
            )}
            <Text style={[styles.companyName, titleStyle]}>
              {quote.supplierName}
            </Text>
            <Text style={styles.brandLine}>
              {copy.addressLabel}: {quote.supplierAddress || copy.missingValue}
            </Text>
            <Text style={styles.brandLine}>
              {copy.phoneLabel}: {quote.supplierContactPhone || copy.missingValue}
              {"  "}
              {copy.emailLabel}: {quote.supplierContactEmail || copy.missingValue}
            </Text>
          </View>
          <View style={styles.quoteMeta}>
            <Text style={styles.documentKind}>{copy.documentKindLabel}</Text>
            <View style={styles.metaTable}>
              <MetaRow label={copy.issueDateLabel} value={issueDate} />
              <MetaRow label={copy.quoteNumberLabel} value={displayNumber} />
              <MetaRow
                label={copy.customerRefLabel}
                value={
                  quoteRequest.cooperativeName ||
                  quoteRequest.customerName ||
                  copy.missingValue
                }
              />
              <MetaRow
                label={copy.validUntilLabel}
                value={quote.validUntil?.trim() || copy.missingValue}
                last
              />
            </View>
          </View>
        </View>

        <Text style={[styles.subject, titleStyle]}>{documentTitle}</Text>

        <SectionBar title={copy.recipientSectionTitle} />
        <View style={styles.panel} wrap={false}>
          <View style={styles.twoCol}>
            <View style={styles.col}>
              <FactList
                rows={[
                  [copy.customerRefLabel, recipient.name],
                  [copy.recipientEmailLabel, recipient.email],
                ]}
              />
            </View>
            <View style={styles.col}>
              <FactList
                rows={[
                  [
                    copy.phoneLabel,
                    quoteRequest.customerPhone || copy.missingValue,
                  ],
                  [
                    copy.documentVersionLabel,
                    formatQuoteVersionLabel(quote.version),
                  ],
                ]}
              />
            </View>
          </View>
          {quoteRequest.subject ? (
            <Text style={[styles.help, { marginBottom: 0, marginTop: 4 }, bodyStyle]}>
              {quoteRequest.subject}
            </Text>
          ) : null}
        </View>

        <SectionBar title={copy.credentialsTitle || copy.supplierSectionTitle} />
        <View style={styles.panel} wrap={false}>
          <View style={styles.supplierRow}>
            <View style={styles.supplierFacts}>
              <FactList rows={credentialRows} />
            </View>
            <View style={styles.sealBox}>
              {sealDataUri ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
                <Image src={sealDataUri} style={styles.seal} />
              ) : (
                <Text style={styles.sealPlaceholder}>{copy.sealMissing}</Text>
              )}
            </View>
          </View>
        </View>

        <View style={sectionStyle}>
          <Text style={styles.intro}>{copy.quoteIntro}</Text>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colName]}>{copy.itemHeader}</Text>
            <Text style={[styles.th, styles.colQty]}>{copy.quantityHeader}</Text>
            <Text style={[styles.th, styles.colMoney]}>{copy.unitPriceHeader}</Text>
            <Text style={[styles.th, styles.colMoney]}>{copy.supplyAmountHeader}</Text>
          </View>
          {quote.lineItems.map((item, index) => (
            <View
              key={item.id}
              style={[styles.tableRow, index % 2 === 1 ? styles.tableRowAlt : {}]}
            >
              <View style={[styles.td, styles.colName]}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.description ? (
                  <Text style={styles.itemDesc}>{item.description}</Text>
                ) : null}
              </View>
              <Text style={[styles.td, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.td, styles.colMoney]}>
                {money(item.unitPrice, copy.currencySuffix)}
              </Text>
              <Text style={[styles.td, styles.colMoney]}>
                {money(item.supplyAmount, copy.currencySuffix)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.bottomRow} wrap={false}>
          <View style={styles.termsCol}>
            <SectionBar title={copy.conditionsTitle} />
            <View style={styles.panel}>
              {conditionRows.length > 0 ? (
                conditionRows.map(([label, value], index) => (
                  <Text key={label} style={styles.termLine}>
                    {index + 1}. {label}: {value}
                  </Text>
                ))
              ) : (
                <Text style={styles.termLine}>
                  1. {copy.validUntilLabel}: {quote.validUntil?.trim() || copy.missingValue}
                </Text>
              )}
            </View>
            <View style={styles.comparison}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop. */}
              <Image src={qrDataUri} style={styles.qrImage} />
              <View style={styles.comparisonCopy}>
                <Text style={styles.comparisonTitle}>
                  {copy.comparisonQrTitle}
                </Text>
                <Text style={styles.comparisonHelp} wrap>
                  {copy.comparisonQrHelp}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text>{copy.subtotalLabel}</Text>
              <Text>{money(quote.subtotal, copy.currencySuffix)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>{copy.taxRateLabel}</Text>
              <Text>
                {quote.taxAmount > 0 ? copy.taxRateValue : copy.noneTypesLabel}
              </Text>
            </View>
            <View style={styles.totalRow}>
              <Text>{copy.vatLabel}</Text>
              <Text>{money(quote.taxAmount, copy.currencySuffix)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotal]}>
              <Text style={styles.grandTotalText}>{copy.totalLabel}</Text>
              <Text style={styles.grandTotalText}>
                {money(quote.totalAmount, copy.currencySuffix)}
              </Text>
            </View>
          </View>
        </View>

        <QuotePdfChrome
          supplierName={quote.supplierName}
          documentKindLabel={copy.documentKindLabel}
          displayNumber={displayNumber}
          questionsContactLabel={copy.questionsContactLabel}
          contactLine={contactLine || copy.missingValue}
          footerStatement={copy.footerStatement}
          thankYouStatement={copy.thankYouStatement}
        />
      </Page>

      {evaluationFactRows.length > 0 || quote.auditEvaluation ? (
        <Page size="A4" style={styles.page}>
          {evaluationFactRows.length > 0 ? (
            <View wrap={false}>
              <SectionBar title={copy.evaluationFactsTitle} />
              <View style={styles.panel}>
                {copy.evaluationFactsHelp ? (
                  <Text style={styles.help}>{copy.evaluationFactsHelp}</Text>
                ) : null}
                <FactList rows={evaluationFactRows} />
              </View>
            </View>
          ) : null}

          {quote.auditEvaluation ? (
            <View style={sectionStyle} wrap={false}>
              <SectionBar title={copy.evaluationTitle} />
              <View style={styles.panel}>
                <Text style={styles.termLine}>
                  {copy.evaluationConfigLabel}: {quote.auditEvaluation.configName} v
                  {quote.auditEvaluation.configVersion}
                </Text>
                <Text style={styles.termLine}>
                  {copy.evaluationScoreLabel}:{" "}
                  {(quote.auditEvaluation.score.totalScoreBasisPoints / 100).toFixed(2)}
                  {copy.scoreSuffix}
                </Text>
                {quote.auditEvaluation.criteria.map((criterion) => (
                  <View key={criterion.id} style={styles.tableRow}>
                    <Text style={[styles.td, styles.colName]}>{criterion.name}</Text>
                    <Text style={[styles.td, styles.colMoney]}>
                      {copy.criterionWeightLabel}{" "}
                      {(criterion.weightBasisPoints / 100).toFixed(2)}
                    </Text>
                    <Text style={[styles.td, styles.colMoney]}>
                      {copy.criterionScoreLabel}{" "}
                      {(criterion.scoreBasisPoints / 100).toFixed(2)}
                    </Text>
                  </View>
                ))}
                {capacityRows.map(([label, value]) => (
                  <Text key={label} style={styles.termLine}>
                    {label}: {value}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          <QuotePdfChrome
            supplierName={quote.supplierName}
            documentKindLabel={copy.documentKindLabel}
            displayNumber={displayNumber}
            questionsContactLabel={copy.questionsContactLabel}
            contactLine={contactLine || copy.missingValue}
            footerStatement={copy.footerStatement}
            thankYouStatement={copy.thankYouStatement}
          />
        </Page>
      ) : null}
    </Document>
  );
}

function QuotePdfChrome({
  supplierName,
  documentKindLabel,
  displayNumber,
  questionsContactLabel,
  contactLine,
  footerStatement,
  thankYouStatement,
}: {
  supplierName: string;
  documentKindLabel: string;
  displayNumber: string;
  questionsContactLabel: string;
  contactLine: string;
  footerStatement: string;
  thankYouStatement: string;
}) {
  return (
    <>
      <View style={styles.runningHeader} fixed>
        <Text style={styles.runningBrand}>{supplierName}</Text>
        <Text style={styles.runningMeta}>
          {documentKindLabel} · {displayNumber}
        </Text>
      </View>
      <View style={styles.footer} fixed>
        <Text style={styles.footerLine}>
          {questionsContactLabel}: {contactLine}
        </Text>
        <Text style={styles.footerLine}>{footerStatement}</Text>
        <Text style={styles.thankYou}>{thankYouStatement}</Text>
      </View>
    </>
  );
}

function SectionBar({ title }: { title: string }) {
  return (
    <View style={styles.sectionBar}>
      <Text style={styles.sectionBarText}>{title}</Text>
    </View>
  );
}

function MetaRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.metaRow, last ? { borderBottomWidth: 0 } : {}]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function FactList({ rows }: { rows: Array<[string, string]> }) {
  return (
    <View>
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={[
            styles.factRow,
            index === rows.length - 1 ? styles.factRowLast : {},
          ]}
        >
          <Text style={styles.factLabel} wrap={false}>
            {label}
          </Text>
          <Text style={styles.factValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const PDF_COLORS: Record<string, string> = {
  text: INK,
  muted: MUTED,
  primary: NAVY,
  accent: "#0f766e",
  surface: "#ffffff",
  subtle: NAVY_SOFT,
  inverse: "#ffffff",
};

function cmsTitleStyle(style: QuoteDocumentContent["style"]) {
  const presetSize = {
    small: 13,
    default: 15,
    large: 18,
  }[style.title.sizePreset];
  return {
    fontSize: Math.min(
      Math.max(style.title.customSizePx?.desktop ?? presetSize, 12),
      22,
    ),
    fontWeight: Number(style.title.fontWeight) as 400 | 500 | 600 | 700 | 800,
    textAlign: style.title.alignment,
    color: PDF_COLORS[style.title.color] ?? NAVY,
  };
}

function cmsBodyStyle(style: QuoteDocumentContent["style"]) {
  const presetSize = {
    small: 8,
    default: 9.5,
    large: 11,
  }[style.body.sizePreset];
  return {
    fontSize: Math.min(
      Math.max(style.body.customSizePx?.desktop ?? presetSize, 8),
      13,
    ),
    color: PDF_COLORS[style.body.color] ?? INK,
  };
}

function cmsSectionStyle(style: QuoteDocumentContent["style"]) {
  const marginTop = {
    compact: 8,
    default: 12,
    relaxed: 16,
  }[style.container.spacing];
  return { marginTop };
}
