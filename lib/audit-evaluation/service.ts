import {
  assertAuditEvaluationCapabilityEnabled,
  getServerFeatureFlags,
  type AuditEvaluationFeatureFlags,
} from "@/lib/audit-evaluation/feature-flags";
import type {
  AuditEvaluationRepository,
  ArchiveConfigInput,
  PublishConfigInput,
  SaveDraftConfigInput,
} from "@/lib/audit-evaluation/repository";
import { evaluationConfigSchema } from "@/lib/audit-evaluation/schemas";
import { assertAuditEvaluationStatusTransition } from "@/lib/audit-evaluation/status";
import type {
  AuditEvaluationCase,
  AuditEvaluationCaseStatus,
  AuditEvaluationInstant,
  EvaluationConfig,
} from "@/lib/audit-evaluation/types";

export class AuditEvaluationServiceError extends Error {
  readonly code:
    | "case_not_found"
    | "config_not_found"
    | "config_not_draft"
    | "config_not_published";

  constructor(code: AuditEvaluationServiceError["code"]) {
    super(code);
    this.name = "AuditEvaluationServiceError";
    this.code = code;
  }
}

export class AuditEvaluationService {
  private readonly repository: AuditEvaluationRepository;
  private readonly flags: AuditEvaluationFeatureFlags;

  constructor(
    repository: AuditEvaluationRepository,
    flags: AuditEvaluationFeatureFlags =
      getServerFeatureFlags().auditEvaluation,
  ) {
    this.repository = repository;
    this.flags = flags;
  }

  async getCase(caseId: string) {
    assertAuditEvaluationCapabilityEnabled("enabled", this.flags);
    return this.repository.getCase(caseId);
  }

  async transitionCaseStatus(
    caseId: string,
    nextStatus: AuditEvaluationCaseStatus,
    now: AuditEvaluationInstant,
  ): Promise<AuditEvaluationCase> {
    assertAuditEvaluationCapabilityEnabled("enabled", this.flags);
    const current = await this.repository.getCase(caseId);
    if (!current) throw new AuditEvaluationServiceError("case_not_found");

    assertAuditEvaluationStatusTransition(current.status, nextStatus);
    return this.repository.transitionCaseStatus({
      caseId,
      expectedStatus: current.status,
      nextStatus,
      updatedAt: now,
      completedAt: resolveCompletedAt(current, nextStatus, now),
    });
  }

  async saveDraftConfig(
    input: SaveDraftConfigInput,
  ): Promise<EvaluationConfig> {
    assertAuditEvaluationCapabilityEnabled("adminEnabled", this.flags);
    const config = evaluationConfigSchema.parse(input.config);
    if (config.status !== "DRAFT") {
      throw new AuditEvaluationServiceError("config_not_draft");
    }
    return this.repository.saveDraftConfig({
      config: config as EvaluationConfig & { status: "DRAFT" },
      expectedVersion: input.expectedVersion,
    });
  }

  async publishConfig(
    input: PublishConfigInput,
  ): Promise<EvaluationConfig> {
    assertAuditEvaluationCapabilityEnabled("adminEnabled", this.flags);
    const config = await this.repository.getConfigVersion(
      input.configId,
      input.version,
    );
    if (!config) throw new AuditEvaluationServiceError("config_not_found");
    evaluationConfigSchema.parse(config);
    if (config.status !== "DRAFT") {
      throw new AuditEvaluationServiceError("config_not_draft");
    }
    return this.repository.publishConfig(input);
  }

  async archiveConfig(
    input: ArchiveConfigInput,
  ): Promise<EvaluationConfig> {
    assertAuditEvaluationCapabilityEnabled("adminEnabled", this.flags);
    const config = await this.repository.getConfigVersion(
      input.configId,
      input.version,
    );
    if (!config) throw new AuditEvaluationServiceError("config_not_found");
    evaluationConfigSchema.parse(config);
    if (config.status !== "PUBLISHED") {
      throw new AuditEvaluationServiceError("config_not_published");
    }
    return this.repository.archiveConfig(input);
  }
}

function resolveCompletedAt(
  current: AuditEvaluationCase,
  nextStatus: AuditEvaluationCaseStatus,
  now: AuditEvaluationInstant,
) {
  if (nextStatus === "COMPLETED") return now;
  if (current.status === "COMPLETED" && nextStatus === "READY") return null;
  return current.completedAt;
}
