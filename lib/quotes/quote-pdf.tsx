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
  quoteRecipient,
} from "@/lib/quotes/quote-presentation";
import {
  quoteDocumentContentFromCms,
  type QuoteDocumentContent,
  type QuoteDocumentCopy,
} from "@/lib/quotes/quote-document-content";

const FONT_FAMILY = "NH-Pretendard-Quote";
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
    padding: 36,
    paddingBottom: 64,
    fontFamily: FONT_FAMILY,
    fontSize: 10,
    color: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
  },
  logo: { width: 96, height: 40, objectFit: "contain" },
  title: {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.35,
    marginBottom: 8,
  },
  muted: { color: "#6b7280" },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginBottom: 8 },
  supplierBox: {
    border: "1px solid #d1d5db",
    flexDirection: "row",
    minHeight: 96,
  },
  supplierDetails: { flexGrow: 1, padding: 12 },
  supplierName: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  supplierLine: { lineHeight: 1.55 },
  sealBox: {
    width: 104,
    borderLeft: "1px solid #d1d5db",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  seal: { width: 72, height: 72, objectFit: "contain" },
  sealPlaceholder: { color: "#9ca3af", fontSize: 9 },
  quoteIntro: { marginTop: 24, marginBottom: 10, fontSize: 11 },
  row: { flexDirection: "row", borderBottom: "1px solid #e5e7eb" },
  th: { padding: 7, fontWeight: 700, backgroundColor: "#f9fafb" },
  td: { padding: 7 },
  colName: { width: "42%" },
  colQty: { width: "14%", textAlign: "right" },
  colMoney: { width: "22%", textAlign: "right" },
  totalBox: { marginTop: 12, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 4 },
  grandTotal: { fontSize: 14, fontWeight: 700 },
  note: { lineHeight: 1.5 },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    borderTop: "1px solid #d1d5db",
    paddingTop: 8,
    textAlign: "center",
    color: "#4b5563",
    fontSize: 8.5,
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
  return renderToBuffer(<QuotePdfDocument {...input} />);
}

function QuotePdfDocument({
  quote,
  quoteRequest,
  logoDataUri,
  sealDataUri,
  documentContent = quoteDocumentContentFromCms(),
}: {
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
  logoDataUri?: string;
  sealDataUri?: string;
  documentContent?: QuoteDocumentContent;
}) {
  const { copy, style: cmsStyle } = documentContent;
  const documentTitle = quoteDocumentTitle(quote, quoteRequest, copy);
  const displayNumber = quoteDisplayNumber(quote, quoteRequest);
  const recipient = quoteRecipient(quoteRequest, copy);
  const conditionRows = quoteConditionRows(quote, copy);
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
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, titleStyle]}>{documentTitle}</Text>
            <Text style={styles.muted}>
              {copy.quoteNumberLabel}: {displayNumber} /{" "}
              {copy.documentVersionLabel}: {quote.version}
            </Text>
          </View>
          {logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
            <Image src={logoDataUri} style={styles.logo} />
          ) : null}
        </View>

        <View style={[styles.section, sectionStyle]}>
          <Text style={styles.sectionTitle}>{copy.recipientSectionTitle}</Text>
          <Text style={bodyStyle}>{recipient.name}</Text>
          <Text style={styles.muted}>
            {copy.recipientEmailLabel}: {recipient.email}
          </Text>
          <Text style={styles.muted}>{quoteRequest.subject}</Text>
        </View>

        <View style={[styles.section, sectionStyle]}>
          <Text style={styles.sectionTitle}>{copy.supplierSectionTitle}</Text>
          <View style={styles.supplierBox} wrap={false}>
            <View style={styles.supplierDetails}>
              <Text style={styles.supplierName}>{quote.supplierName}</Text>
              <Text style={styles.supplierLine}>
                {copy.businessNumberLabel}:{" "}
                {quote.supplierBusinessRegistrationNumber || copy.missingValue}
              </Text>
              <Text style={styles.supplierLine}>
                {copy.addressLabel}: {quote.supplierAddress || copy.missingValue}
              </Text>
              <Text style={styles.supplierLine}>
                {copy.supplierContactLabel}:{" "}
                {quote.supplierContactName || copy.missingValue}
              </Text>
              <Text style={styles.supplierLine}>
                {copy.contactLabel}:{" "}
                {[quote.supplierContactPhone, quote.supplierContactEmail]
                  .filter(Boolean)
                  .join(" / ") || copy.missingValue}
              </Text>
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

        <View style={[styles.section, sectionStyle]}>
          <Text style={styles.quoteIntro}>{copy.quoteIntro}</Text>
          <View style={styles.row}>
            <Text style={[styles.th, styles.colName]}>{copy.itemHeader}</Text>
            <Text style={[styles.th, styles.colQty]}>{copy.quantityHeader}</Text>
            <Text style={[styles.th, styles.colMoney]}>{copy.unitPriceHeader}</Text>
            <Text style={[styles.th, styles.colMoney]}>{copy.supplyAmountHeader}</Text>
          </View>
          {quote.lineItems.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={[styles.td, styles.colName]}>{item.name}</Text>
              <Text style={[styles.td, styles.colQty]}>{item.quantity}</Text>
              <Text style={[styles.td, styles.colMoney]}>
                {money(item.unitPrice, copy.currencySuffix)}
              </Text>
              <Text style={[styles.td, styles.colMoney]}>
                {money(item.supplyAmount, copy.currencySuffix)}
              </Text>
            </View>
          ))}
          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <Text>{copy.subtotalLabel}</Text>
              <Text>{money(quote.subtotal, copy.currencySuffix)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>{copy.vatLabel}</Text>
              <Text>{money(quote.taxAmount, copy.currencySuffix)}</Text>
            </View>
            <View style={[styles.totalRow, styles.grandTotal]}>
              <Text>{copy.totalLabel}</Text>
              <Text>{money(quote.totalAmount, copy.currencySuffix)}</Text>
            </View>
          </View>
        </View>

        {conditionRows.length > 0 ? (
          <View style={[styles.section, sectionStyle]}>
            <Text style={styles.sectionTitle}>{copy.conditionsTitle}</Text>
            {conditionRows.map(([label, value]) => (
              <Text key={label} style={styles.note}>
                {label}: {value}
              </Text>
            ))}
          </View>
        ) : null}

        {quote.auditEvaluation ? (
          <View style={[styles.section, sectionStyle]}>
            <Text style={styles.sectionTitle}>{copy.evaluationTitle}</Text>
            <Text style={styles.note}>
              {copy.evaluationConfigLabel}: {quote.auditEvaluation.configName} v
              {quote.auditEvaluation.configVersion}
            </Text>
            <Text style={styles.note}>
              {copy.evaluationScoreLabel}:{" "}
              {(quote.auditEvaluation.score.totalScoreBasisPoints / 100).toFixed(2)}
              {copy.scoreSuffix}
            </Text>
            {quote.auditEvaluation.criteria.map((criterion) => (
              <View key={criterion.id} style={styles.row}>
                <Text style={[styles.td, styles.colName]}>
                  {criterion.name}
                </Text>
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
            {auditEvaluationSummary(quote, copy).map(([label, value]) => (
              <Text key={label} style={styles.note}>
                {label}: {value}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.footer} fixed>
          <Text>
            {copy.footerStatement}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function auditEvaluationSummary(
  quote: QuoteRecord,
  copy: QuoteDocumentCopy,
): Array<[string, string]> {
  const audit = quote.auditEvaluation?.normalizedQuote;
  if (!audit) return [];
  return [
    [
      copy.revenueLabel,
      audit.accountingFirmRevenue
        ? `${Number(audit.accountingFirmRevenue).toLocaleString("ko-KR")}${copy.currencySuffix}`
        : "-",
    ],
    [
      copy.recentAuditCountLabel,
      `${audit.recentNonghyupAuditCount ?? 0}${copy.countSuffix}`,
    ],
    [copy.auditedTypesLabel, audit.auditedNonghyupTypes.join(", ") || "-"],
    [
      copy.taxExperienceLabel,
      audit.taxAgencyExperience.hasExperience ? copy.yesLabel : copy.noLabel,
    ],
    [
      copy.subsidyExperienceLabel,
      audit.subsidySettlementExperience.hasExperience
        ? copy.yesLabel
        : copy.noLabel,
    ],
    [copy.totalHoursLabel, `${audit.totalPlannedHours ?? 0}${copy.hourSuffix}`],
    [copy.partnerHoursLabel, `${audit.partnerHours ?? 0}${copy.hourSuffix}`],
    [copy.teamCountLabel, `${audit.engagementTeam.length}${copy.peopleSuffix}`],
  ];
}

const PDF_COLORS: Record<string, string> = {
  text: "#111827",
  muted: "#6b7280",
  primary: "#166534",
  accent: "#0f766e",
  surface: "#ffffff",
  subtle: "#f9fafb",
  inverse: "#ffffff",
};

function cmsTitleStyle(style: QuoteDocumentContent["style"]) {
  const presetSize = {
    small: 16,
    default: 18,
    large: 22,
  }[style.title.sizePreset];
  return {
    fontSize: Math.min(
      Math.max(style.title.customSizePx?.desktop ?? presetSize, 14),
      28,
    ),
    fontWeight: Number(style.title.fontWeight) as 400 | 500 | 600 | 700 | 800,
    textAlign: style.title.alignment,
    color: PDF_COLORS[style.title.color] ?? PDF_COLORS.text,
  };
}

function cmsBodyStyle(style: QuoteDocumentContent["style"]) {
  const presetSize = {
    small: 9,
    default: 10,
    large: 12,
  }[style.body.sizePreset];
  return {
    fontSize: Math.min(
      Math.max(style.body.customSizePx?.desktop ?? presetSize, 8),
      14,
    ),
    color: PDF_COLORS[style.body.color] ?? PDF_COLORS.text,
  };
}

function cmsSectionStyle(style: QuoteDocumentContent["style"]) {
  const marginTop = {
    compact: 12,
    default: 18,
    relaxed: 24,
  }[style.container.spacing];
  return { marginTop };
}
