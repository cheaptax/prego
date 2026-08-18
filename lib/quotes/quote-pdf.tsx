import path from "node:path";
import type { ReactNode } from "react";
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
  quoteEvaluationFactsFootnote,
  quoteEvaluationFactsHelp,
  quotePartnerCredentialRows,
  quotePartnerEvaluationFactRows,
  quoteRecipient,
  withStandardQuoteConditions,
} from "@/lib/quotes/quote-presentation";
import { formatQuoteVersionLabel } from "@/lib/quotes/quote-revision";
import { quoteComparisonReportUrl } from "@/lib/quotes/quote-comparison-link";
import {
  quoteDocumentContentFromCms,
  type QuoteDocumentContent,
} from "@/lib/quotes/quote-document-content";
import { resolveQuoteLogoTheme } from "@/lib/quotes/quote-logo-theme";
import {
  prepareQuoteImageDataUri,
  usableQuoteImageDataUri,
} from "@/lib/quotes/quote-pdf-assets";
import {
  normalizePdfSections,
  type QuotePdfLayout,
  quotePdfLayoutFor,
  quotePdfTheme,
} from "@/lib/quotes/quote-pdf-layouts";
import {
  DEFAULT_QUOTE_SCREEN_THEME,
  type QuoteScreenSectionId,
  type QuoteScreenTheme,
} from "@/lib/quotes/quote-screen-profile";
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
    marginBottom: 8,
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
    marginBottom: 8,
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
  evaluationFootnote: {
    color: MUTED,
    fontSize: 6.6,
    lineHeight: 1.35,
    marginTop: 6,
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

type RenderQuotePdfInput = {
  quote: QuoteRecord;
  quoteRequest: QuoteRequestRecord;
  logoDataUri?: string;
  sealDataUri?: string;
  qrDataUri?: string;
  documentContent?: QuoteDocumentContent;
};

async function renderQuotePdfOnce(
  input: RenderQuotePdfInput & { skipLogoTheme?: boolean },
) {
  const [logoDataUri, sealDataUri] = await Promise.all([
    prepareQuoteImageDataUri(input.logoDataUri),
    prepareQuoteImageDataUri(input.sealDataUri),
  ]);
  const baseDocumentContent =
    input.documentContent ?? quoteDocumentContentFromCms();
  let resolvedTheme = {
    ...DEFAULT_QUOTE_SCREEN_THEME,
    ...(baseDocumentContent.theme ?? {}),
  };
  if (!input.skipLogoTheme) {
    resolvedTheme = await resolveQuoteLogoTheme({
      theme: baseDocumentContent.theme,
      layoutFamily: baseDocumentContent.layoutFamily,
      logoDataUri,
    });
  }
  const documentContent = {
    ...baseDocumentContent,
    theme: resolvedTheme,
  };
  const comparisonUrl = quoteComparisonReportUrl({
    quote: input.quote,
    quoteRequest: input.quoteRequest,
  });
  let qrDataUri = usableQuoteImageDataUri(input.qrDataUri);
  if (!qrDataUri) {
    try {
      qrDataUri = await renderQuoteComparisonQrDataUri(comparisonUrl);
    } catch (error) {
      console.error("quote-pdf-qr-failed", error);
    }
  }
  return renderToBuffer(
    <QuotePdfDocument
      {...input}
      logoDataUri={logoDataUri}
      sealDataUri={sealDataUri}
      qrDataUri={qrDataUri}
      documentContent={documentContent}
    />,
  );
}

export async function renderQuotePdf(input: RenderQuotePdfInput) {
  try {
    return await renderQuotePdfOnce(input);
  } catch (error) {
    console.error("quote-pdf-render-failed", error);
    if (input.logoDataUri || input.sealDataUri) {
      try {
        return await renderQuotePdfOnce({
          ...input,
          logoDataUri: undefined,
          sealDataUri: undefined,
        });
      } catch (retryError) {
        console.error("quote-pdf-render-retry-without-images-failed", retryError);
      }
    }
    return renderQuotePdfOnce({
      ...input,
      logoDataUri: undefined,
      sealDataUri: undefined,
      skipLogoTheme: true,
      documentContent: {
        ...(input.documentContent ?? quoteDocumentContentFromCms()),
        layoutFamily: "classicNavy",
        theme: DEFAULT_QUOTE_SCREEN_THEME,
      },
    });
  }
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
  qrDataUri?: string;
  documentContent?: QuoteDocumentContent;
}) {
  const { copy, style: cmsStyle } = documentContent;
  const documentTitle = quoteDocumentTitle(quote, quoteRequest, copy);
  const displayNumber = quoteDisplayNumber(quote, quoteRequest);
  const recipient = quoteRecipient(quoteRequest, copy);
  const conditionRows = quoteConditionRows(quote, copy);
  const standardConditions = withStandardQuoteConditions(quote);
  const credentialRows = quotePartnerCredentialRows(quote, copy);
  const evaluationFactRows = quotePartnerEvaluationFactRows(quote, copy);
  const capacityRows = quoteEvaluationCapacityRows(quote, copy);
  const issueDate = quoteIssueDate(quote) || copy.missingValue;
  const contactLine = [quote.supplierContactName, quote.supplierContactPhone, quote.supplierContactEmail]
    .filter(Boolean)
    .join(" · ");
  const layout = quotePdfLayoutFor(documentContent.layoutFamily);
  const theme = quotePdfTheme(documentContent.theme);
  const chrome = layout.tableChrome;
  const sections = normalizePdfSections(documentContent.sections);
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  const isVisible = (id: QuoteScreenSectionId) =>
    sectionById.get(id)?.visible !== false;
  const sectionTitle = (id: QuoteScreenSectionId, fallback: string) =>
    sectionById.get(id)?.titleOverride || fallback;
  const titleStyle = cmsTitleStyle(cmsStyle, theme);
  const bodyStyle = cmsBodyStyle(cmsStyle, theme);
  const sectionStyle = cmsSectionStyle(cmsStyle);
  const pageStyle = [
    styles.page,
    {
      paddingTop: layout.pagePaddingTop,
      paddingHorizontal: layout.pagePaddingHorizontal,
      color: theme.ink,
      fontSize: layout.dense ? 8.7 : 9.5,
    },
  ];
  const sectionIds = (ids: QuoteScreenSectionId[]) =>
    sections
      .filter((section) => ids.includes(section.id) && isVisible(section.id))
      .map((section) => section.id);
  const renderSupplierHeader = () => (
    <View
      key="supplierHeader"
      style={[
        styles.brandRow,
        layout.brandDirection === "column"
          ? { flexDirection: "column", gap: 10 }
          : {},
      ]}
      wrap={false}
    >
      <View
        style={[
          styles.brandBlock,
          layout.brandDirection === "column" ? { maxWidth: "100%" } : {},
        ]}
      >
        {logoDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
          <Image src={logoDataUri} style={styles.logo} />
        ) : (
          <Text style={[styles.logoPlaceholder, { color: theme.muted }]}>
            {copy.logoMissing || "제휴사 로고 미등록"}
          </Text>
        )}
        <Text style={[styles.companyName, titleStyle, { color: theme.primary }]}>
          {quote.supplierName}
        </Text>
        <Text style={[styles.brandLine, { color: theme.muted }]}>
          {copy.addressLabel}: {quote.supplierAddress || copy.missingValue}
        </Text>
        <Text style={[styles.brandLine, { color: theme.muted }]}>
          {copy.phoneLabel}: {quote.supplierContactPhone || copy.missingValue}
          {"  "}
          {copy.emailLabel}: {quote.supplierContactEmail || copy.missingValue}
        </Text>
      </View>
      <View
        style={[
          styles.quoteMeta,
          layout.metaSide === "left" ? { alignItems: "flex-start" } : {},
        ]}
      >
        <Text style={[styles.documentKind, { color: theme.accent }]}>
          {copy.documentKindLabel}
        </Text>
        <View style={[styles.metaTable, { borderColor: theme.subtle }]}>
          <MetaRow
            label={copy.issueDateLabel}
            value={issueDate}
            colors={theme}
          />
          <MetaRow
            label={copy.quoteNumberLabel}
            value={displayNumber}
            colors={theme}
          />
          <MetaRow
            label={copy.customerRefLabel}
            value={
              quoteRequest.cooperativeName ||
              quoteRequest.customerName ||
              copy.missingValue
            }
            colors={theme}
          />
          <MetaRow
            label={copy.validUntilLabel}
            value={standardConditions.validUntil}
            colors={theme}
            last
          />
        </View>
      </View>
    </View>
  );
  const renderRecipient = () => (
    <View key="recipient" wrap={false}>
      <SectionBar
        title={sectionTitle("recipient", copy.recipientSectionTitle)}
        colors={theme}
        chrome={chrome}
      />
      <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
        <View style={styles.twoCol}>
          <View style={styles.col}>
            <FactList
              rows={[
                [copy.customerRefLabel, recipient.name],
                [copy.recipientEmailLabel, recipient.email],
              ]}
              colors={theme}
              chrome={chrome}
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
              colors={theme}
              chrome={chrome}
            />
          </View>
        </View>
        {quoteRequest.subject ? (
          <Text style={[styles.help, bodyStyle, { marginBottom: 0, marginTop: 4, color: theme.muted }]}>
            {quoteRequest.subject}
          </Text>
        ) : null}
      </View>
    </View>
  );
  const renderCredentials = () => (
    <View key="credentials" wrap={false}>
      <SectionBar
        title={sectionTitle("credentials", copy.credentialsTitle || copy.supplierSectionTitle)}
        colors={theme}
        chrome={chrome}
      />
      <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
        <View style={styles.supplierRow}>
          <View style={styles.supplierFacts}>
            <FactList rows={credentialRows} colors={theme} chrome={chrome} />
          </View>
          <View style={styles.sealBox}>
            {sealDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
              <Image src={sealDataUri} style={styles.seal} />
            ) : (
              <Text style={[styles.sealPlaceholder, { color: theme.muted }]}>
                {copy.sealMissing}
              </Text>
            )}
          </View>
        </View>
      </View>
    </View>
  );
  const renderQuoteItems = () => (
    <View key="quoteItems" style={sectionStyle}>
      <Text style={[styles.intro, { color: theme.ink }]}>{copy.quoteIntro}</Text>
      <View style={[styles.tableHeader, tableHeaderChromeStyle(chrome, theme)]}>
        <Text style={[styles.th, styles.colName, tableHeaderTextChromeStyle(chrome, theme)]}>
          {copy.itemHeader}
        </Text>
        <Text style={[styles.th, styles.colQty, tableHeaderTextChromeStyle(chrome, theme)]}>
          {copy.quantityHeader}
        </Text>
        <Text style={[styles.th, styles.colMoney, tableHeaderTextChromeStyle(chrome, theme)]}>
          {copy.unitPriceHeader}
        </Text>
        <Text style={[styles.th, styles.colMoney, tableHeaderTextChromeStyle(chrome, theme)]}>
          {copy.supplyAmountHeader}
        </Text>
      </View>
      {quote.lineItems.map((item, index) => (
        <View
          key={item.id}
          style={[
            styles.tableRow,
            tableRowChromeStyle(chrome, theme, index),
          ]}
        >
          <View style={[styles.td, styles.colName]}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.description ? (
              <Text style={[styles.itemDesc, { color: theme.muted }]}>
                {item.description}
              </Text>
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
  );
  const renderConditions = () => (
    <View key="conditions" style={styles.bottomRow} wrap={false}>
      <View style={styles.termsCol}>
        <SectionBar
          title={sectionTitle("conditions", copy.conditionsTitle)}
          colors={theme}
          chrome={chrome}
        />
        <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
          {conditionRows.map(([label, value], index) => (
            <Text key={label} style={styles.termLine}>
              {index + 1}. {label}: {value}
            </Text>
          ))}
        </View>
      </View>
      <View style={[styles.totals, totalsChromeStyle(chrome, theme)]}>
        <View style={[styles.totalRow, { borderBottomColor: theme.subtle }]}>
          <Text>{copy.subtotalLabel}</Text>
          <Text>{money(quote.subtotal, copy.currencySuffix)}</Text>
        </View>
        <View style={[styles.totalRow, { borderBottomColor: theme.subtle }]}>
          <Text>{copy.taxRateLabel}</Text>
          <Text>
            {quote.taxAmount > 0 ? copy.taxRateValue : copy.noneTypesLabel}
          </Text>
        </View>
        <View style={[styles.totalRow, { borderBottomColor: theme.subtle }]}>
          <Text>{copy.vatLabel}</Text>
          <Text>{money(quote.taxAmount, copy.currencySuffix)}</Text>
        </View>
        <View style={[styles.totalRow, styles.grandTotal, grandTotalChromeStyle(chrome, theme)]}>
          <Text style={[styles.grandTotalText, { color: theme.primary }]}>
            {copy.totalLabel}
          </Text>
          <Text style={[styles.grandTotalText, { color: theme.primary }]}>
            {money(quote.totalAmount, copy.currencySuffix)}
          </Text>
        </View>
      </View>
    </View>
  );
  const renderEvaluationFacts = () =>
    evaluationFactRows.length > 0 ? (
      <View key="evaluationFacts" wrap={false}>
        <SectionBar
          title={sectionTitle("evaluationFacts", copy.evaluationFactsTitle)}
          colors={theme}
          chrome={chrome}
        />
        <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
          <Text style={[styles.help, { color: theme.muted }]}>
            {quoteEvaluationFactsHelp(copy)}
          </Text>
          <FactList rows={evaluationFactRows} colors={theme} chrome={chrome} />
          {[quoteEvaluationFactsFootnote(copy), copy.evaluationFactsFootnoteAssociationDef]
            .filter(Boolean)
            .map((footnote) => (
              <Text
                key={footnote}
                style={[styles.evaluationFootnote, { color: theme.muted }]}
              >
                {footnote}
              </Text>
            ))}
        </View>
      </View>
    ) : null;
  const renderQuantitativeEvaluation = () =>
    quote.auditEvaluation ? (
      <View key="quantitativeEvaluation" style={sectionStyle} wrap={false}>
        <SectionBar
          title={sectionTitle("quantitativeEvaluation", copy.evaluationTitle)}
          colors={theme}
          chrome={chrome}
        />
        <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
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
            <View
              key={criterion.id}
              style={[styles.tableRow, tableRowChromeStyle(chrome, theme, 0)]}
            >
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
    ) : null;
  const sectionRenderers: Record<QuoteScreenSectionId, () => ReactNode> = {
    supplierHeader: renderSupplierHeader,
    recipient: renderRecipient,
    credentials: renderCredentials,
    quoteItems: renderQuoteItems,
    conditions: renderConditions,
    comparisonQr: () =>
      isVisible("comparisonQr") ? (
        <View key="comparisonQr" wrap={false}>
          <View style={[styles.comparison, panelChromeStyle(chrome, theme)]}>
            {qrDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not expose an alt prop.
              <Image src={qrDataUri} style={styles.qrImage} />
            ) : null}
            <View style={styles.comparisonCopy}>
              <Text style={[styles.comparisonTitle, { color: theme.primary }]}>
                {sectionTitle("comparisonQr", copy.comparisonQrTitle)}
              </Text>
              <Text style={[styles.comparisonHelp, { color: theme.muted }]} wrap>
                {copy.comparisonQrHelp}
              </Text>
            </View>
          </View>
        </View>
      ) : null,
    evaluationFacts: renderEvaluationFacts,
    quantitativeEvaluation: renderQuantitativeEvaluation,
    acceptance: () =>
      isVisible("acceptance") ? (
        <View key="acceptance" wrap={false}>
          <SectionBar
            title={sectionTitle("acceptance", copy.acceptanceTitle)}
            colors={theme}
            chrome={chrome}
          />
          <View style={[styles.panel, panelChromeStyle(chrome, theme)]}>
            <Text style={[styles.help, { color: theme.muted }]}>
              {copy.acceptanceHint}
            </Text>
            <Text style={styles.termLine}>{copy.printNameLabel}: </Text>
          </View>
        </View>
      ) : null,
    footer: () => null,
  };
  const renderSections = (ids: QuoteScreenSectionId[]) =>
    sectionIds(ids).map((id) => sectionRenderers[id]());
  const identityPageIds: QuoteScreenSectionId[] = [
    "supplierHeader",
    "recipient",
    "credentials",
    "quoteItems",
    "conditions",
  ];
  const evaluationPageIds: QuoteScreenSectionId[] = [
    "evaluationFacts",
    "quantitativeEvaluation",
    "comparisonQr",
    "acceptance",
  ];
  const chromeProps = {
    supplierName: quote.supplierName,
    documentKindLabel: copy.documentKindLabel,
    displayNumber,
    questionsContactLabel: copy.questionsContactLabel,
    contactLine: contactLine || copy.missingValue,
    footerStatement: copy.footerStatement,
    thankYouStatement: copy.thankYouStatement,
    colors: theme,
  };
  const renderDocumentPage = (ids: QuoteScreenSectionId[], key: string) => (
    <Page key={key} size="A4" style={pageStyle}>
      <Text
        style={[
          styles.subject,
          titleStyle,
          { color: theme.primary, textAlign: layout.subjectAlign },
        ]}
      >
        {documentTitle}
      </Text>
      {renderSections(ids)}
      <QuotePdfChrome {...chromeProps} />
    </Page>
  );

  return (
    <Document
      title={documentTitle}
      author={quote.partnerName}
      subject={quoteRequest.subject}
    >
      {renderDocumentPage(identityPageIds, "identity")}
      {renderDocumentPage(evaluationPageIds, "evaluation")}
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
  colors,
}: {
  supplierName: string;
  documentKindLabel: string;
  displayNumber: string;
  questionsContactLabel: string;
  contactLine: string;
  footerStatement: string;
  thankYouStatement: string;
  colors: QuoteScreenTheme;
}) {
  return (
    <>
      <View
        style={[styles.runningHeader, { borderBottomColor: colors.primary }]}
        fixed
      >
        <Text style={[styles.runningBrand, { color: colors.primary }]}>
          {supplierName}
        </Text>
        <Text style={[styles.runningMeta, { color: colors.muted }]}>
          {documentKindLabel} · {displayNumber}
        </Text>
      </View>
      <View style={[styles.footer, { borderTopColor: colors.subtle }]} fixed>
        <Text style={[styles.footerLine, { color: colors.muted }]}>
          {questionsContactLabel}: {contactLine}
        </Text>
        <Text style={[styles.footerLine, { color: colors.muted }]}>
          {footerStatement}
        </Text>
        <Text style={[styles.thankYou, { color: colors.primary }]}>
          {thankYouStatement}
        </Text>
      </View>
    </>
  );
}

function SectionBar({
  title,
  colors,
  chrome = "banded",
}: {
  title: string;
  colors: QuoteScreenTheme;
  chrome?: QuotePdfLayout["tableChrome"];
}) {
  return (
    <View style={[styles.sectionBar, sectionBarChromeStyle(chrome, colors)]}>
      <Text
        style={[
          styles.sectionBarText,
          chrome === "formal" || chrome === "card" ? { color: colors.primary } : {},
        ]}
      >
        {title}
      </Text>
    </View>
  );
}

function MetaRow({
  label,
  value,
  colors,
  last = false,
}: {
  label: string;
  value: string;
  colors: QuoteScreenTheme;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.metaRow,
        { borderBottomColor: colors.subtle },
        last ? { borderBottomWidth: 0 } : {},
      ]}
    >
      <Text
        style={[
          styles.metaLabel,
          { backgroundColor: colors.subtle, color: colors.primary },
        ]}
      >
        {label}
      </Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function FactList({
  rows,
  colors,
  chrome = "banded",
}: {
  rows: Array<[string, string]>;
  colors: QuoteScreenTheme;
  chrome?: QuotePdfLayout["tableChrome"];
}) {
  return (
    <View>
      {rows.map(([label, value], index) => (
        <View
          key={label}
          style={[
            styles.factRow,
            index === rows.length - 1 ? styles.factRowLast : {},
            factRowChromeStyle(chrome, colors, index),
          ]}
        >
          <Text
            style={[styles.factLabel, factLabelChromeStyle(chrome, colors)]}
            wrap={false}
          >
            {label}
          </Text>
          <Text style={[styles.factValue, { color: colors.ink }]}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function sectionBarChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "formal") {
    return {
      backgroundColor: "#ffffff",
      borderWidth: 0.8,
      borderColor: colors.subtle,
      borderBottomWidth: 1.4,
      borderBottomColor: colors.primary,
    };
  }
  if (chrome === "card") {
    return {
      backgroundColor: colors.subtle,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    };
  }
  if (chrome === "letterhead") {
    return {
      backgroundColor: "#ffffff",
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
      borderBottomWidth: 0.8,
      borderBottomColor: colors.subtle,
    };
  }
  return { backgroundColor: colors.primary };
}

function panelChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "ledger") {
    return { borderColor: colors.muted, borderTopWidth: 1, padding: 6 };
  }
  if (chrome === "formal") {
    return { borderColor: colors.subtle, borderTopWidth: 0.6, padding: 10 };
  }
  if (chrome === "letterhead") {
    return {
      borderColor: colors.subtle,
      borderTopWidth: 0,
      borderLeftWidth: 4,
      borderLeftColor: colors.primary,
    };
  }
  if (chrome === "card") {
    return {
      borderColor: colors.subtle,
      borderTopWidth: 0,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
      backgroundColor: "#ffffff",
    };
  }
  return { borderColor: colors.subtle };
}

function factRowChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
  index: number,
) {
  if (chrome === "ledger") {
    return {
      borderBottomColor: colors.subtle,
      borderBottomWidth: 0.8,
      backgroundColor: index % 2 === 1 ? colors.surface : "#ffffff",
    };
  }
  if (chrome === "card") {
    return {
      borderBottomColor: "#ffffff",
      backgroundColor: index % 2 === 1 ? colors.surface : "#ffffff",
      paddingHorizontal: 4,
    };
  }
  if (chrome === "formal") {
    return { borderBottomColor: colors.subtle, paddingVertical: 5 };
  }
  return { borderBottomColor: colors.subtle };
}

function factLabelChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "letterhead") return { color: colors.primary, fontWeight: 700 };
  if (chrome === "ledger") return { color: colors.ink, fontWeight: 700 };
  return { color: colors.muted };
}

function tableHeaderChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "formal") {
    return {
      backgroundColor: colors.subtle,
      borderWidth: 0.8,
      borderColor: colors.subtle,
    };
  }
  if (chrome === "letterhead") {
    return {
      backgroundColor: "#ffffff",
      borderTopWidth: 1.4,
      borderTopColor: colors.primary,
      borderBottomWidth: 0.8,
      borderBottomColor: colors.subtle,
    };
  }
  if (chrome === "card") {
    return {
      backgroundColor: colors.subtle,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
    };
  }
  return { backgroundColor: colors.primary };
}

function tableHeaderTextChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "formal" || chrome === "letterhead" || chrome === "card") {
    return { color: colors.primary };
  }
  return { color: "#ffffff" };
}

function tableRowChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
  index: number,
) {
  if (chrome === "ledger") {
    return {
      borderBottomColor: colors.muted,
      borderBottomWidth: 0.8,
      backgroundColor: index % 2 === 1 ? colors.surface : "#ffffff",
    };
  }
  if (chrome === "card") {
    return {
      borderBottomColor: "#ffffff",
      backgroundColor: index % 2 === 1 ? colors.surface : "#ffffff",
    };
  }
  if (chrome === "formal" || chrome === "letterhead") {
    return { borderBottomColor: colors.subtle };
  }
  return {
    borderBottomColor: colors.subtle,
    backgroundColor: index % 2 === 1 ? colors.surface : "#ffffff",
  };
}

function totalsChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "letterhead") {
    return { borderColor: colors.subtle, borderTopWidth: 3, borderTopColor: colors.primary };
  }
  if (chrome === "card") {
    return { borderColor: colors.subtle, borderRadius: 8 };
  }
  if (chrome === "ledger") return { borderColor: colors.muted };
  return { borderColor: colors.subtle };
}

function grandTotalChromeStyle(
  chrome: QuotePdfLayout["tableChrome"],
  colors: QuoteScreenTheme,
) {
  if (chrome === "formal") return { backgroundColor: "#ffffff", borderTopColor: colors.primary };
  if (chrome === "letterhead") return { backgroundColor: "#ffffff" };
  return { backgroundColor: colors.subtle };
}

function tokenColor(token: string, theme: QuoteScreenTheme) {
  return (
    {
      text: theme.ink,
      muted: theme.muted,
      primary: theme.primary,
      accent: theme.accent,
      surface: theme.surface,
      subtle: theme.subtle,
      inverse: "#ffffff",
    }[token] ?? theme.primary
  );
}

function cmsTitleStyle(
  style: QuoteDocumentContent["style"],
  theme: QuoteScreenTheme,
) {
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
    color: tokenColor(style.title.color, theme),
  };
}

function cmsBodyStyle(
  style: QuoteDocumentContent["style"],
  theme: QuoteScreenTheme,
) {
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
    color: tokenColor(style.body.color, theme),
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
