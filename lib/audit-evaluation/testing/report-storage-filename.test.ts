import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeReportDownloadFilename } from "@/lib/audit-evaluation/report-view-model";
import { buildAttachmentContentDisposition } from "@/lib/quotes/quote-pdf-filename";

describe("report download signed URL filename", () => {
  it("accepts Korean cooperative report filenames used by createDownload", () => {
    const fileName = safeReportDownloadFilename(
      2027,
      1,
      "FISCAL_YEAR_VERSION",
      "aec_M-svGOWlsIoGY-QdgX6hVMwP",
      "테스트농협",
    );
    assert.equal(fileName, "테스트농협_FY2027 감사인견적평가보고서.pdf");
    assert.match(
      buildAttachmentContentDisposition(fileName),
      /filename\*=UTF-8''.*%EC%8A%A4%ED%8A%B8/u,
    );
  });

  it("uses RFC5987 disposition instead of ASCII-only filename gate", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/audit-evaluation/report-storage.ts"),
      "utf8",
    );
    assert.match(source, /buildAttachmentContentDisposition/);
    assert.doesNotMatch(
      source,
      /\/\^\[a-zA-Z0-9\._-\]\{1,120\}\\\.pdf\$\//,
    );
  });
});
