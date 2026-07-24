import {
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import {
  REPORT_PDF_RENDERER_ID,
  REPORT_PDF_RENDERER_VERSION,
  renderAuditEvaluationReportPdf,
} from "@/lib/audit-evaluation/report-pdf";
import {
  applyOptionalReportNarrative,
  type ReportNarrativeAdapter,
} from "@/lib/audit-evaluation/report-narrative";
import {
  FirestoreAuditEvaluationReportRepository,
  type AuditEvaluationReportRepository,
} from "@/lib/audit-evaluation/report-repository";
import {
  FirebaseAuditEvaluationReportStorage,
  type AuditEvaluationReportStorage,
} from "@/lib/audit-evaluation/report-storage";
import {
  buildDeterministicReportViewModel,
  parseAuditEvaluationReportViewModel,
} from "@/lib/audit-evaluation/report-view-model";
import {
  reportPayloadStoragePath,
  reportStoragePath,
} from "@/lib/audit-evaluation/upload-identity";
import type { EvaluationReportRun } from "@/lib/audit-evaluation/types";
import { CMS_COLLECTIONS } from "@/lib/cms/constants";
import { cmsAssetSchema } from "@/lib/cms/schemas";
import { adminDb, adminStorage } from "@/lib/firebase/admin";

const MAX_VIEW_MODEL_BYTES = 10 * 1024 * 1024;
const MAX_REPORT_LOGO_BYTES = 2 * 1024 * 1024;

export type ReportLogoResolver = (
  logoAssetId: string,
) => Promise<string | null>;
export type ReportPdfRenderer = typeof renderAuditEvaluationReportPdf;

export type ReportGenerationResult = {
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  report: EvaluationReportRun | null;
};

export class AuditEvaluationReportGenerationService {
  private readonly repository: AuditEvaluationReportRepository;
  private readonly storage: AuditEvaluationReportStorage;
  private readonly flags: AuditEvaluationFeatureFlags;
  private readonly narrativeAdapter?: ReportNarrativeAdapter;
  private readonly logoResolver: ReportLogoResolver;
  private readonly pdfRenderer: ReportPdfRenderer;

  constructor(input: {
    repository?: AuditEvaluationReportRepository;
    storage?: AuditEvaluationReportStorage;
    flags?: AuditEvaluationFeatureFlags;
    narrativeAdapter?: ReportNarrativeAdapter;
    logoResolver?: ReportLogoResolver;
    pdfRenderer?: ReportPdfRenderer;
  } = {}) {
    this.repository =
      input.repository ?? new FirestoreAuditEvaluationReportRepository();
    this.storage =
      input.storage ?? new FirebaseAuditEvaluationReportStorage();
    this.flags =
      input.flags ?? getServerFeatureFlags().auditEvaluation;
    this.narrativeAdapter = input.narrativeAdapter;
    this.logoResolver =
      input.logoResolver ?? resolvePublishedReportLogoDataUri;
    this.pdfRenderer =
      input.pdfRenderer ?? renderAuditEvaluationReportPdf;
  }

  async generate(input: {
    caseId: string;
    reportVersion: number;
    now: string;
  }): Promise<ReportGenerationResult> {
    const claim = await this.repository.claimGeneration(input);
    if (!claim.claimed) {
      return {
        status: claim.report.status === "COMPLETED"
          ? "COMPLETED"
          : "SKIPPED",
        report: claim.report,
      };
    }
    try {
      const corrections = await this.repository.listCorrections(input.caseId);
      const logoDataUri = await this.resolveLogoDataUri(
        claim.report.evaluationConfigSnapshot.reportRenderingPolicy
          ?.logoAssetId,
      );
      const templateViewModel = buildDeterministicReportViewModel({
        reportRun: claim.report,
        evaluationCase: claim.evaluationCase,
        corrections,
        generatedAt: input.now,
        resolvedLogoDataUri: logoDataUri,
      });
      const narrative = await applyOptionalReportNarrative({
        viewModel: templateViewModel,
        enabled:
          this.flags.enabled && this.flags.aiNarrativeEnabled,
        adapter: this.narrativeAdapter,
      });
      let viewModel = parseAuditEvaluationReportViewModel(
        narrative.viewModel,
      );
      let pdfBytes: Uint8Array;
      try {
        pdfBytes = await this.pdfRenderer(viewModel);
      } catch (error) {
        if (!viewModel.metadata.branding.logoDataUri) throw error;
        viewModel = parseAuditEvaluationReportViewModel({
          ...viewModel,
          metadata: {
            ...viewModel.metadata,
            branding: {
              ...viewModel.metadata.branding,
              logoDataUri: null,
            },
          },
        });
        pdfBytes = await this.pdfRenderer(viewModel);
      }
      const viewModelBytes = new TextEncoder().encode(
        JSON.stringify(viewModel),
      );
      if (viewModelBytes.byteLength > MAX_VIEW_MODEL_BYTES) {
        throw new Error("REPORT_VIEW_MODEL_TOO_LARGE");
      }
      const payloadPath = reportPayloadStoragePath(
        input.caseId,
        input.reportVersion,
        claim.attempt,
      );
      const pdfPath = reportStoragePath(
        input.caseId,
        input.reportVersion,
        claim.attempt,
      );
      await this.storage.save({
        storagePath: payloadPath,
        bytes: viewModelBytes,
        contentType: "application/json",
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        classification: "report-view-model",
      });
      await this.storage.save({
        storagePath: pdfPath,
        bytes: pdfBytes,
        contentType: "application/pdf",
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        classification: "report-pdf",
      });
      const report = await this.repository.completeGeneration({
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        attempt: claim.attempt,
        generatedAt: input.now,
        renderingReference: {
          rendererId: REPORT_PDF_RENDERER_ID,
          rendererVersion: REPORT_PDF_RENDERER_VERSION,
          payloadStoragePath: payloadPath,
        },
        pdfStoragePath: pdfPath,
        narrativeData: narrative.narrativeData,
      });
      return { status: "COMPLETED", report };
    } catch (error) {
      await this.repository.failGeneration({
        caseId: input.caseId,
        reportVersion: input.reportVersion,
        attempt: claim.attempt,
        failedAt: input.now,
        failureCode: generationFailureCode(error),
      });
      return { status: "FAILED", report: null };
    }
  }

  async loadViewModel(report: EvaluationReportRun) {
    if (
      report.status !== "COMPLETED" ||
      !report.renderingReference?.payloadStoragePath
    ) {
      return null;
    }
    const bytes = await this.storage.read(
      report.renderingReference.payloadStoragePath,
      MAX_VIEW_MODEL_BYTES,
    );
    if (!bytes) return null;
    try {
      return parseAuditEvaluationReportViewModel(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
    } catch {
      return null;
    }
  }

  private async resolveLogoDataUri(
    logoAssetId: string | null | undefined,
  ) {
    if (!logoAssetId) return null;
    try {
      return await this.logoResolver(logoAssetId);
    } catch {
      return null;
    }
  }
}

export async function resolvePublishedReportLogoDataUri(
  logoAssetId: string,
): Promise<string | null> {
  try {
    const snapshot = await adminDb()
      .collection(CMS_COLLECTIONS.assets)
      .doc(logoAssetId)
      .get();
    if (!snapshot.exists) return null;
    const parsed = cmsAssetSchema.safeParse(snapshot.data());
    if (!parsed.success || parsed.data.status !== "published") return null;
    const asset = parsed.data;
    if (
      !["image/png", "image/jpeg"].includes(asset.mimeType) ||
      asset.byteSize > MAX_REPORT_LOGO_BYTES
    ) {
      return null;
    }
    const file = adminStorage().bucket().file(asset.storagePath);
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size);
    if (
      !Number.isSafeInteger(storedSize) ||
      storedSize <= 0 ||
      storedSize > MAX_REPORT_LOGO_BYTES
    ) {
      return null;
    }
    const [buffer] = await file.download();
    if (
      buffer.byteLength <= 0 ||
      buffer.byteLength > MAX_REPORT_LOGO_BYTES ||
      !matchesImageSignature(buffer, asset.mimeType)
    ) {
      return null;
    }
    return `data:${asset.mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function matchesImageSignature(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg" | string,
) {
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => bytes[index] === value);
  }
  return mimeType === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9;
}

function generationFailureCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    const normalized = error.code
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 100);
    if (/^[A-Z][A-Z0-9_]{0,99}$/.test(normalized)) return normalized;
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)) {
    return error.message;
  }
  return "REPORT_GENERATION_FAILED";
}
