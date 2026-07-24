import { buildPurgeManifest } from "@/lib/test-data/purge-manifest";
import type {
  PurgeManifest,
  PurgeScanDataSource,
  PurgeScanRequest,
} from "@/lib/test-data/purge-types";

export class PurgeScanService {
  private readonly dataSource: PurgeScanDataSource;

  constructor(dataSource: PurgeScanDataSource) {
    this.dataSource = dataSource;
  }

  async scan(request: PurgeScanRequest): Promise<PurgeManifest> {
    if (request.mode !== "SCAN" && request.mode !== "DRY_RUN") {
      throw new PurgeScanError("apply_not_implemented", 405);
    }
    if (!/^(?:coop-\d{3,4}|demo-[a-z0-9-]+)$/.test(request.institutionId)) {
      throw new PurgeScanError("invalid_institution_id", 400);
    }
    if (!request.generatedBy.trim()) {
      throw new PurgeScanError("missing_generated_by", 400);
    }
    const snapshot = await this.dataSource.loadSnapshot(request.institutionId);
    return buildPurgeManifest(request, snapshot);
  }
}

export class PurgeScanError extends Error {
  readonly code:
    | "apply_not_implemented"
    | "invalid_institution_id"
    | "missing_generated_by";
  readonly status: number;

  constructor(
    code:
      | "apply_not_implemented"
      | "invalid_institution_id"
      | "missing_generated_by",
    status: number,
  ) {
    super(code);
    this.name = "PurgeScanError";
    this.code = code;
    this.status = status;
  }
}
