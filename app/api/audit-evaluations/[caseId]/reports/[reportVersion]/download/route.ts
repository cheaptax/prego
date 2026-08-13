import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticateAuditEvaluationCaseRequest } from "@/lib/audit-evaluation/customer-api-access";
import {
  AuditEvaluationReportService,
  ReportServiceError,
  reportServiceErrorStatus,
} from "@/lib/audit-evaluation/report-service";
import { buildAttachmentContentDisposition } from "@/lib/quotes/quote-pdf-filename";

export const runtime = "nodejs";

type Props = {
  params: Promise<{ caseId: string; reportVersion: string }>;
};

export async function GET(request: NextRequest, { params }: Props) {
  const { caseId, reportVersion: rawReportVersion } = await params;
  const access = await authenticateAuditEvaluationCaseRequest(
    request,
    caseId,
  );
  if (!access) {
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  }
  const reportVersion = Number(rawReportVersion);
  if (!Number.isInteger(reportVersion) || reportVersion <= 0) {
    return NextResponse.json(
      { ok: false, error: "report_not_found" },
      { status: 404 },
    );
  }
  const inline =
    request.nextUrl.searchParams.get("inline") === "1" ||
    request.nextUrl.searchParams.get("disposition") === "inline";
  try {
    const service = new AuditEvaluationReportService();
    const now = new Date().toISOString();
    if (inline) {
      const pdf = await service.readCustomerPdf({
        caseId,
        reportVersion,
        actor: access.actor,
        now,
      });
      return new NextResponse(Buffer.from(pdf.bytes), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": inlineContentDisposition(pdf.fileName),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const download = await service.createDownload({
      caseId,
      reportVersion,
      actor: access.actor,
      now,
    });
    return NextResponse.redirect(download.url, {
      status: 307,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": attachmentContentDisposition(
          download.fileName,
          reportVersion,
        ),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof ReportServiceError
          ? error.code
          : "report_download_unavailable",
      },
      { status: reportServiceErrorStatus(error) },
    );
  }
}

function attachmentContentDisposition(fileName: string, version: number) {
  const asciiFallback =
    `audit-evaluation-report-v${version}.pdf`;
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

function inlineContentDisposition(fileName: string) {
  return buildAttachmentContentDisposition(fileName).replace(
    /^attachment;/u,
    "inline;",
  );
}
