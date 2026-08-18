import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { renderAuditEvaluationReportPdf } from "@/lib/audit-evaluation/report-pdf";
import {
  createSampleAuditReportViewModel,
  SAMPLE_AUDIT_REPORT_FILE_NAME,
} from "@/lib/audit-quote/sample-audit-report";
import { buildAttachmentContentDisposition } from "@/lib/quotes/quote-pdf-filename";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const viewModel = createSampleAuditReportViewModel();
    if (request.nextUrl.searchParams.get("format") === "json") {
      return NextResponse.json(
        { ok: true, viewModel },
        {
          headers: {
            "cache-control": "public, max-age=3600",
          },
        },
      );
    }
    const pdf = await renderAuditEvaluationReportPdf(viewModel);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": buildAttachmentContentDisposition(
          SAMPLE_AUDIT_REPORT_FILE_NAME,
        ),
        "cache-control": "public, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "sample_report_unavailable" },
      { status: 500 },
    );
  }
}
