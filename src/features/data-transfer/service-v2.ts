import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";

import {
  readEvidenceImage,
  removeEvidenceImage,
  writeEvidenceImage,
} from "@/features/claims/image-storage";
import { db } from "@/server/db/client";
import {
  captureCategories,
  captures,
  categories,
  claimEvidence,
  claimEvidenceRevisions,
  claimReviewEvidence,
  claimReviews,
  claims,
  dataImportObjects,
  dataImportRuns,
  evidenceAttachments,
  evidenceSourceChecks,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";
import { sha256, stableStringify } from "@/shared/hash";

import { currentTransferActor, type TransferActor } from "./auth";
import { portableV2ConfirmationSnapshotMatches } from "./confirmation-v2";
import {
  DATA_TRANSFER_FORMAT_VERSION,
  type ImportIssue,
  type ImportPreviewSummary,
  type PortablePayload,
} from "./contracts";
import {
  DATA_TRANSFER_V2_FORMAT_VERSION,
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortableAttachmentCheckV2,
  type PortablePayloadV2,
  type PortableWebSourceCheckV2,
  portablePayloadV2Schema,
} from "./contracts-v2";
import { buildPortableV2SafeImportProjection } from "./downgrade-v2";
import {
  createPortablePackageV2,
  parsePortablePackageV2,
} from "./package-v2";
import { buildPortableV2KnowledgePreview } from "./preview-v2";
import {
  analyzePortableV2Provenance,
  listPortableV2ImportObjects,
  portableV2ProvenanceKey,
  type ExistingPortableV2ImportObject,
  type PortableV2ImportObjectType,
} from "./provenance-v2";
import {
  analyzePortableBaseImport,
  applyPortableBaseImport,
} from "./service";
import {
  readPortablePackageV2Staging,
  removePortablePackageV2Staging,
  writePortablePackageV2Staging,
} from "./staging-v2";
import { createPortableWorkbookV2 } from "./workbook-v2";

function attachmentExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      throw new AppError(
        "EXPORT_ATTACHMENT_MIME_INVALID",
        `证据图片 MIME 类型不受支持：${mimeType}`,
      );
  }
}

function portableAttachmentPath(input: {
  evidenceId: string;
  attachmentId: string;
  mimeType: string;
}) {
  return `attachments/${input.evidenceId}/${input.attachmentId}.${attachmentExtension(input.mimeType)}`;
}

function isPortableV2ImportObjectType(value: string): value is PortableV2ImportObjectType {
  return value === "claim" || value === "evidence" || value === "attachment";
}

async function loadExistingPortableV2ImportObjects(
  payload: PortablePayloadV2,
  actor: TransferActor,
): Promise<ExistingPortableV2ImportObject[]> {
  const objects = listPortableV2ImportObjects(payload);
  if (objects.length === 0) return [];

  const expectedKeys = new Set(
    objects.map((object) => portableV2ProvenanceKey(object.objectType, object.sourceKey)),
  );
  const sourceKeys = [...new Set(objects.map((object) => object.sourceKey))];
  const rows = await db
    .select({
      objectType: dataImportObjects.objectType,
      sourceKey: dataImportObjects.sourceKey,
      localId: dataImportObjects.localId,
      contentHash: dataImportObjects.contentHash,
    })
    .from(dataImportObjects)
    .where(
      and(
        eq(dataImportObjects.workspaceId, actor.workspaceId),
        eq(dataImportObjects.actorId, actor.id),
        eq(dataImportObjects.formatVersion, DATA_TRANSFER_V2_FORMAT_VERSION),
        inArray(dataImportObjects.objectType, ["claim", "evidence", "attachment"]),
        inArray(dataImportObjects.sourceKey, sourceKeys),
      ),
    );

  const relevantRows = rows.filter(
    (row) =>
      isPortableV2ImportObjectType(row.objectType) &&
      expectedKeys.has(portableV2ProvenanceKey(row.objectType, row.sourceKey)),
  );
  const localIds = (objectType: PortableV2ImportObjectType) => [
    ...new Set(
      relevantRows
        .filter((row) => row.objectType === objectType)
        .map((row) => row.localId),
    ),
  ];
  const claimIds = localIds("claim");
  const evidenceIds = localIds("evidence");
  const attachmentIds = localIds("attachment");

  const [existingClaims, existingEvidence, existingAttachments] = await Promise.all([
    claimIds.length
      ? db
          .select({ id: claims.id })
          .from(claims)
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              inArray(claims.id, claimIds),
              eq(captures.workspaceId, actor.workspaceId),
            ),
          )
      : Promise.resolve([]),
    evidenceIds.length
      ? db
          .select({ id: claimEvidence.id })
          .from(claimEvidence)
          .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              inArray(claimEvidence.id, evidenceIds),
              eq(captures.workspaceId, actor.workspaceId),
            ),
          )
      : Promise.resolve([]),
    attachmentIds.length
      ? db
          .select({ id: evidenceAttachments.id })
          .from(evidenceAttachments)
          .innerJoin(
            claimEvidence,
            eq(evidenceAttachments.evidenceId, claimEvidence.id),
          )
          .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
          .innerJoin(captures, eq(claims.captureId, captures.id))
          .where(
            and(
              inArray(evidenceAttachments.id, attachmentIds),
              eq(captures.workspaceId, actor.workspaceId),
            ),
          )
      : Promise.resolve([]),
  ]);
  const existingLocalIds = {
    claim: new Set(existingClaims.map((row) => row.id)),
    evidence: new Set(existingEvidence.map((row) => row.id)),
    attachment: new Set(existingAttachments.map((row) => row.id)),
  } satisfies Record<PortableV2ImportObjectType, Set<string>>;

  return relevantRows.flatMap((row) => {
    if (!isPortableV2ImportObjectType(row.objectType)) return [];
    return [
      {
        objectType: row.objectType,
        sourceKey: row.sourceKey,
        localId: row.localId,
        contentHash: row.contentHash,
        localExists: existingLocalIds[row.objectType].has(row.localId),
      },
    ];
  });
}

export async function previewPortablePackageV2Knowledge(input: {
  actor: TransferActor;
  buffer: Buffer;
}) {
  const parsed = await parsePortablePackageV2(input.buffer);
  if (!parsed.payload) {
    return {
      valid: false,
      packageIssues: parsed.issues.slice(0, 100),
      knowledge: null,
    };
  }

  const existing = await loadExistingPortableV2ImportObjects(
    parsed.payload,
    input.actor,
  );
  const knowledge = buildPortableV2KnowledgePreview(parsed.payload, existing);
  return {
    valid: knowledge.valid,
    packageIssues: [] as const,
    knowledge,
  };
}

export type PortablePackageV2Preview = {
  valid: boolean;
  packageIssues: ImportIssue[];
  base: ImportPreviewSummary | null;
  knowledge: ReturnType<typeof buildPortableV2KnowledgePreview> | null;
  issues: ImportIssue[];
};

function portableV2BasePayload(payload: PortablePayloadV2): PortablePayload {
  return {
    formatVersion: DATA_TRANSFER_FORMAT_VERSION,
    records: payload.records,
    categories: payload.categories,
  };
}

async function analyzePortablePackageV2(input: {
  actor: TransferActor;
  buffer: Buffer;
}): Promise<{
  preview: PortablePackageV2Preview;
  payload: PortablePayloadV2 | null;
  attachments: Map<string, Buffer>;
  baseSkippedKeys: Set<string>;
  existingProvenance: ExistingPortableV2ImportObject[];
}> {
  const parsed = await parsePortablePackageV2(input.buffer);
  if (!parsed.payload) {
    const packageIssues = parsed.issues.slice(0, 100);
    return {
      payload: null,
      attachments: parsed.attachments,
      baseSkippedKeys: new Set(),
      existingProvenance: [],
      preview: {
        valid: false,
        packageIssues,
        base: null,
        knowledge: null,
        issues: packageIssues,
      },
    };
  }

  const [baseAnalysis, existing] = await Promise.all([
    analyzePortableBaseImport(portableV2BasePayload(parsed.payload), input.actor),
    loadExistingPortableV2ImportObjects(parsed.payload, input.actor),
  ]);
  const knowledge = buildPortableV2KnowledgePreview(parsed.payload, existing);
  const issues = [
    ...baseAnalysis.summary.issues,
    ...knowledge.issues,
  ].slice(0, 100);
  const base: ImportPreviewSummary = {
    ...baseAnalysis.summary,
    valid: baseAnalysis.summary.issues.length === 0,
    issues: baseAnalysis.summary.issues.slice(0, 100),
  };

  return {
    payload: parsed.payload,
    attachments: parsed.attachments,
    baseSkippedKeys: baseAnalysis.skippedKeys,
    existingProvenance: existing,
    preview: {
      valid: base.valid && knowledge.valid && issues.length === 0,
      packageIssues: [],
      base,
      knowledge,
      issues,
    },
  };
}

export async function previewPortablePackageV2(input: {
  actor: TransferActor;
  buffer: Buffer;
}): Promise<PortablePackageV2Preview> {
  return (await analyzePortablePackageV2(input)).preview;
}

export async function stagePortablePackageV2Preview(input: {
  actor: TransferActor;
  fileName: string;
  buffer: Buffer;
}) {
  const analysis = await analyzePortablePackageV2({
    actor: input.actor,
    buffer: input.buffer,
  });
  if (!analysis.payload) {
    return {
      runId: null,
      status: "failed" as const,
      summary: analysis.preview,
    };
  }

  const fileSha256 = createHash("sha256").update(input.buffer).digest("hex");
  const [run] = await db
    .insert(dataImportRuns)
    .values({
      workspaceId: input.actor.workspaceId,
      actorId: input.actor.id,
      actorName: input.actor.name,
      fileName: input.fileName.slice(0, 255),
      fileSha256,
      formatVersion: DATA_TRANSFER_V2_FORMAT_VERSION,
      status: analysis.preview.valid ? "previewed" : "failed",
      stagedPayload: analysis.payload,
      previewSummary: analysis.preview,
      errorCode: analysis.preview.valid ? null : "IMPORT_VALIDATION_FAILED",
      errorMessage: analysis.preview.valid
        ? null
        : "v2 交换包预检未通过，请修正冲突后重新上传。",
      completedAt: analysis.preview.valid ? null : new Date(),
    })
    .returning({ id: dataImportRuns.id, status: dataImportRuns.status });

  if (!analysis.preview.valid) {
    return {
      runId: run.id,
      status: "failed" as const,
      summary: analysis.preview,
    };
  }

  try {
    await writePortablePackageV2Staging(run.id, input.buffer);
  } catch (error) {
    await db
      .update(dataImportRuns)
      .set({
        status: "failed",
        errorCode: "IMPORT_STAGING_FAILED",
        errorMessage: "v2 交换包暂存失败，请重新上传预检。",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(dataImportRuns.id, run.id),
          eq(dataImportRuns.workspaceId, input.actor.workspaceId),
          eq(dataImportRuns.actorId, input.actor.id),
        ),
      );
    throw new AppError(
      "IMPORT_STAGING_FAILED",
      "v2 交换包暂存失败，请重新上传预检。",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  return {
    runId: run.id,
    status: "previewed" as const,
    summary: analysis.preview,
  };
}

async function failPortablePackageV2Run(input: {
  runId: string;
  actor: TransferActor;
  errorCode: string;
  errorMessage: string;
}) {
  await db
    .update(dataImportRuns)
    .set({
      status: "failed",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(dataImportRuns.id, input.runId),
        eq(dataImportRuns.workspaceId, input.actor.workspaceId),
        eq(dataImportRuns.actorId, input.actor.id),
        eq(dataImportRuns.status, "previewed"),
      ),
    );
  await removePortablePackageV2Staging(input.runId).catch(() => undefined);
}

export type PreparedPortablePackageV2Import = {
  runId: string;
  payload: PortablePayloadV2;
  attachments: Map<string, Buffer>;
  preview: PortablePackageV2Preview;
  baseSkippedKeys: Set<string>;
  existingProvenance: ExistingPortableV2ImportObject[];
};

export async function preparePortablePackageV2Confirm(
  runId: string,
  actor: TransferActor,
): Promise<PreparedPortablePackageV2Import> {
  const [run] = await db
    .select({
      id: dataImportRuns.id,
      status: dataImportRuns.status,
      formatVersion: dataImportRuns.formatVersion,
      fileSha256: dataImportRuns.fileSha256,
      stagedPayload: dataImportRuns.stagedPayload,
      previewSummary: dataImportRuns.previewSummary,
    })
    .from(dataImportRuns)
    .where(
      and(
        eq(dataImportRuns.id, runId),
        eq(dataImportRuns.workspaceId, actor.workspaceId),
        eq(dataImportRuns.actorId, actor.id),
      ),
    )
    .limit(1);
  if (!run) {
    throw new AppError("IMPORT_RUN_NOT_FOUND", "找不到这次 v2 导入预检记录。");
  }
  if (run.formatVersion !== DATA_TRANSFER_V2_FORMAT_VERSION) {
    throw new AppError(
      "IMPORT_RUN_FORMAT_MISMATCH",
      "这次预检不是 v2 交换包，请重新上传正确格式。",
    );
  }
  if (run.status !== "previewed") {
    throw new AppError(
      "IMPORT_RUN_NOT_READY",
      "只有预检通过且尚未导入的 v2 交换包才能确认导入。",
    );
  }

  let stagedPackage: Buffer;
  try {
    stagedPackage = await readPortablePackageV2Staging(run.id);
  } catch (error) {
    await failPortablePackageV2Run({
      runId: run.id,
      actor,
      errorCode: "IMPORT_STAGING_INVALID",
      errorMessage: "v2 导入暂存文件不可用，请重新上传预检。",
    });
    throw error;
  }

  const stagedSha256 = createHash("sha256").update(stagedPackage).digest("hex");
  if (stagedSha256 !== run.fileSha256) {
    await failPortablePackageV2Run({
      runId: run.id,
      actor,
      errorCode: "IMPORT_STAGED_PACKAGE_CHANGED",
      errorMessage: "v2 导入暂存文件与预检时不一致，请重新上传预检。",
    });
    throw new AppError(
      "IMPORT_STAGED_PACKAGE_CHANGED",
      "v2 导入暂存文件与预检时不一致，请重新上传预检。",
    );
  }

  const analysis = await analyzePortablePackageV2({
    actor,
    buffer: stagedPackage,
  });
  if (!analysis.payload || !analysis.preview.valid) {
    await failPortablePackageV2Run({
      runId: run.id,
      actor,
      errorCode: "IMPORT_STATE_CHANGED",
      errorMessage: "v2 交换包或数据库状态已变化，请重新上传预检。",
    });
    throw new AppError(
      "IMPORT_STATE_CHANGED",
      "v2 交换包或数据库状态已变化，请重新上传预检。",
    );
  }

  if (
    !portableV2ConfirmationSnapshotMatches({
      stagedPayload: run.stagedPayload,
      stagedPreview: run.previewSummary,
      parsedPayload: analysis.payload,
      currentPreview: analysis.preview,
    })
  ) {
    await failPortablePackageV2Run({
      runId: run.id,
      actor,
      errorCode: "IMPORT_STATE_CHANGED",
      errorMessage: "预检计划已经变化，请重新上传文件并再次确认。",
    });
    throw new AppError(
      "IMPORT_STATE_CHANGED",
      "预检计划已经变化，请重新上传文件并再次确认。",
    );
  }

  const [claimedRun] = await db
    .update(dataImportRuns)
    .set({
      status: "importing",
      startedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      completedAt: null,
    })
    .where(
      and(
        eq(dataImportRuns.id, run.id),
        eq(dataImportRuns.workspaceId, actor.workspaceId),
        eq(dataImportRuns.actorId, actor.id),
        eq(dataImportRuns.status, "previewed"),
      ),
    )
    .returning({ id: dataImportRuns.id });
  if (!claimedRun) {
    throw new AppError(
      "IMPORT_RUN_NOT_READY",
      "这次 v2 导入已经被其他请求处理，请重新上传预检。",
    );
  }

  return {
    runId: run.id,
    payload: analysis.payload,
    attachments: analysis.attachments,
    preview: analysis.preview,
    baseSkippedKeys: analysis.baseSkippedKeys,
    existingProvenance: analysis.existingProvenance,
  };
}

export type PortablePackageV2ImportResult = {
  recordsCreated: number;
  recordsSkipped: number;
  categoriesCreated: number;
  categoriesReused: number;
  relationshipsCreated: number;
  claimsCreated: number;
  claimsSkipped: number;
  claimsRepaired: number;
  evidenceCreated: number;
  evidenceSkipped: number;
  evidenceRepaired: number;
  attachmentsCreated: number;
  attachmentsSkipped: number;
  attachmentsRepaired: number;
  historicalContext: ReturnType<typeof buildPortableV2SafeImportProjection>["historicalContext"];
  downgraded: ReturnType<typeof buildPortableV2SafeImportProjection>["downgraded"];
};

async function applyPreparedPortablePackageV2Import(
  prepared: PreparedPortablePackageV2Import,
  actor: TransferActor,
): Promise<PortablePackageV2ImportResult> {
  const provenance = analyzePortableV2Provenance(
    prepared.payload,
    prepared.existingProvenance,
  );
  if (provenance.conflicts.length > 0) {
    throw new AppError(
      "IMPORT_STATE_CHANGED",
      "v2 知识对象来源映射已经变化，请重新上传预检。",
    );
  }
  const projection = buildPortableV2SafeImportProjection(prepared.payload);
  const projectionClaimByKey = new Map(
    projection.claims.map((claim) => [claim.key, claim]),
  );
  const projectionEvidenceByKey = new Map(
    projection.evidence.map((evidence) => [evidence.key, evidence]),
  );
  const incomingObjectByKey = new Map(
    provenance.objects.map((object) => [
      portableV2ProvenanceKey(object.objectType, object.sourceKey),
      object,
    ]),
  );
  const existingByKey = new Map(
    prepared.existingProvenance.map((object) => [
      portableV2ProvenanceKey(object.objectType, object.sourceKey),
      object,
    ]),
  );
  const writtenStoragePaths: string[] = [];

  try {
    const result = await db.transaction(async (transaction) => {
      const baseResult = await applyPortableBaseImport(
        transaction,
        portableV2BasePayload(prepared.payload),
        prepared.baseSkippedKeys,
        actor,
      );
      const localCaptureIds = [...new Set(baseResult.captureIdByKey.values())];
      const localCaptures = localCaptureIds.length
        ? await transaction
            .select({ id: captures.id, version: captures.version, content: captures.content })
            .from(captures)
            .where(
              and(
                inArray(captures.id, localCaptureIds),
                eq(captures.workspaceId, actor.workspaceId),
              ),
            )
        : [];
      const localCaptureById = new Map(localCaptures.map((capture) => [capture.id, capture]));

      const writeProvenance = async (
        objectType: PortableV2ImportObjectType,
        sourceKey: string,
        localId: string,
      ) => {
        const key = portableV2ProvenanceKey(objectType, sourceKey);
        const incoming = incomingObjectByKey.get(key);
        if (!incoming) {
          throw new AppError(
            "IMPORT_PROVENANCE_INVALID",
            `找不到 ${objectType}:${sourceKey} 的来源哈希。`,
          );
        }
        if (provenance.toCreate.has(key)) {
          await transaction.insert(dataImportObjects).values({
            workspaceId: actor.workspaceId,
            actorId: actor.id,
            formatVersion: DATA_TRANSFER_V2_FORMAT_VERSION,
            objectType,
            sourceKey,
            localId,
            contentHash: incoming.contentHash,
            importRunId: prepared.runId,
          });
          return;
        }
        if (provenance.toRepair.has(key)) {
          const [updated] = await transaction
            .update(dataImportObjects)
            .set({
              localId,
              contentHash: incoming.contentHash,
              importRunId: prepared.runId,
            })
            .where(
              and(
                eq(dataImportObjects.workspaceId, actor.workspaceId),
                eq(dataImportObjects.actorId, actor.id),
                eq(dataImportObjects.formatVersion, DATA_TRANSFER_V2_FORMAT_VERSION),
                eq(dataImportObjects.objectType, objectType),
                eq(dataImportObjects.sourceKey, sourceKey),
                eq(dataImportObjects.contentHash, incoming.contentHash),
              ),
            )
            .returning({ id: dataImportObjects.id });
          if (!updated) {
            throw new AppError(
              "IMPORT_STATE_CHANGED",
              "待修复的来源映射已经变化，请重新上传预检。",
            );
          }
          return;
        }
        if (!provenance.toSkip.has(key)) {
          throw new AppError(
            "IMPORT_PROVENANCE_INVALID",
            `来源对象 ${objectType}:${sourceKey} 没有可执行的导入计划。`,
          );
        }
      };

      const claimIdByKey = new Map<string, string>();
      for (const claim of prepared.payload.claims) {
        const key = portableV2ProvenanceKey("claim", claim.key);
        if (provenance.toSkip.has(key)) {
          const existing = existingByKey.get(key);
          if (!existing?.localExists) {
            throw new AppError(
              "IMPORT_STATE_CHANGED",
              "预检后已有主张被删除，请重新上传预检。",
            );
          }
          claimIdByKey.set(claim.key, existing.localId);
          continue;
        }

        const captureId = baseResult.captureIdByKey.get(claim.recordKey);
        const localCapture = captureId ? localCaptureById.get(captureId) : null;
        if (!captureId || !localCapture) {
          throw new AppError(
            "IMPORT_CLAIM_CAPTURE_MISSING",
            `主张 ${claim.key} 找不到导入后的来源记录。`,
          );
        }
        if (!localCapture.content.includes(claim.sourceExcerpt)) {
          throw new AppError(
            "IMPORT_CLAIM_SOURCE_UNAVAILABLE",
            `主张 ${claim.key} 的来源摘录无法在本地记录中定位，请重新预检。`,
          );
        }
        const target = projectionClaimByKey.get(claim.key);
        if (!target) {
          throw new AppError(
            "IMPORT_PROJECTION_INVALID",
            `主张 ${claim.key} 缺少安全降级计划。`,
          );
        }
        const statementHash = sha256(
          stableStringify({
            captureId,
            sourceCaptureVersion: localCapture.version,
            statement: claim.statement.trim().toLocaleLowerCase("zh-CN"),
          }),
        );
        const [localConflict] = await transaction
          .select({ id: claims.id })
          .from(claims)
          .where(eq(claims.statementHash, statementHash))
          .limit(1);
        if (localConflict) {
          throw new AppError(
            "IMPORT_CLAIM_LOCAL_CONFLICT",
            `主张 ${claim.key} 与本地已有主张冲突，未自动复用可信状态。`,
          );
        }
        const [created] = await transaction
          .insert(claims)
          .values({
            captureId,
            sourceSuggestionId: null,
            sourceCaptureVersion: localCapture.version,
            statement: claim.statement,
            statementHash,
            sourceExcerpt: claim.sourceExcerpt,
            falsificationCriteria: claim.falsificationCriteria,
            status: target.targetStatus,
          })
          .returning({ id: claims.id });
        claimIdByKey.set(claim.key, created.id);
        await writeProvenance("claim", claim.key, created.id);
      }

      const evidenceIdByKey = new Map<string, string>();
      for (const evidence of prepared.payload.evidence) {
        const key = portableV2ProvenanceKey("evidence", evidence.key);
        if (provenance.toSkip.has(key)) {
          const existing = existingByKey.get(key);
          if (!existing?.localExists) {
            throw new AppError(
              "IMPORT_STATE_CHANGED",
              "预检后已有证据被删除，请重新上传预检。",
            );
          }
          evidenceIdByKey.set(evidence.key, existing.localId);
          continue;
        }

        const claimId = claimIdByKey.get(evidence.claimKey);
        const target = projectionEvidenceByKey.get(evidence.key);
        if (!claimId || !target) {
          throw new AppError(
            "IMPORT_EVIDENCE_PARENT_MISSING",
            `证据 ${evidence.key} 找不到导入后的主张或安全降级计划。`,
          );
        }
        const [created] = await transaction
          .insert(claimEvidence)
          .values({
            claimId,
            sourceUrl: evidence.sourceUrl,
            sourceTitle: evidence.sourceTitle,
            excerpt: evidence.excerpt,
            stance: evidence.stance,
            note: evidence.note,
            version: target.targetVersion,
            reviewStatus: target.targetReviewStatus,
            reviewedAt: null,
            sourceCheckStatus: target.targetSourceCheckStatus,
            sourceExcerptMatch: target.targetSourceExcerptMatch,
            sourceCheckedAt: null,
            latestSourceCheckId: null,
          })
          .returning({ id: claimEvidence.id });
        evidenceIdByKey.set(evidence.key, created.id);
        await writeProvenance("evidence", evidence.key, created.id);
      }

      for (const attachment of prepared.payload.attachments) {
        const key = portableV2ProvenanceKey("attachment", attachment.key);
        const localEvidenceId = evidenceIdByKey.get(attachment.evidenceKey);
        if (!localEvidenceId) {
          throw new AppError(
            "IMPORT_ATTACHMENT_PARENT_MISSING",
            `图片 ${attachment.key} 找不到导入后的证据。`,
          );
        }

        if (provenance.toSkip.has(key)) {
          const existing = existingByKey.get(key);
          if (!existing?.localExists) {
            throw new AppError(
              "IMPORT_STATE_CHANGED",
              "预检后已有图片记录被删除，请重新上传预检。",
            );
          }
          const [row] = await transaction
            .select({
              id: evidenceAttachments.id,
              evidenceId: evidenceAttachments.evidenceId,
              originalName: evidenceAttachments.originalName,
              storagePath: evidenceAttachments.storagePath,
              mimeType: evidenceAttachments.mimeType,
              byteSize: evidenceAttachments.byteSize,
              sha256: evidenceAttachments.sha256,
            })
            .from(evidenceAttachments)
            .where(eq(evidenceAttachments.id, existing.localId))
            .limit(1);
          if (
            !row ||
            row.evidenceId !== localEvidenceId ||
            row.originalName !== attachment.originalName ||
            row.mimeType !== attachment.mimeType ||
            row.byteSize !== attachment.byteSize ||
            row.sha256 !== attachment.sha256
          ) {
            throw new AppError(
              "IMPORT_ATTACHMENT_LOCAL_CONFLICT",
              `图片 ${attachment.key} 的本地记录已经变化，请重新预检。`,
            );
          }
          let localBytes: Buffer;
          try {
            localBytes = await readEvidenceImage(row.storagePath);
          } catch {
            throw new AppError(
              "IMPORT_ATTACHMENT_LOCAL_FILE_INVALID",
              `图片 ${attachment.key} 的本地文件缺失或无法读取。`,
            );
          }
          if (
            localBytes.byteLength !== attachment.byteSize ||
            createHash("sha256").update(localBytes).digest("hex") !== attachment.sha256
          ) {
            throw new AppError(
              "IMPORT_ATTACHMENT_LOCAL_FILE_INVALID",
              `图片 ${attachment.key} 的本地文件与原导入包不一致。`,
            );
          }
          continue;
        }

        const bytes = prepared.attachments.get(attachment.key);
        if (!bytes) {
          throw new AppError(
            "IMPORT_ATTACHMENT_BYTES_MISSING",
            `交换包中的图片 ${attachment.key} 字节缺失。`,
          );
        }
        const localAttachmentId = randomUUID();
        const storagePath = `${localAttachmentId}.${attachmentExtension(attachment.mimeType)}`;
        await writeEvidenceImage(storagePath, bytes);
        writtenStoragePaths.push(storagePath);
        await transaction.insert(evidenceAttachments).values({
          id: localAttachmentId,
          evidenceId: localEvidenceId,
          originalName: attachment.originalName,
          storagePath,
          mimeType: attachment.mimeType,
          byteSize: attachment.byteSize,
          sha256: attachment.sha256,
        });
        await writeProvenance("attachment", attachment.key, localAttachmentId);
      }

      const {
        captureIdByKey: _captureIdByKey,
        categoryIdByKey: _categoryIdByKey,
        ...baseSummary
      } = baseResult;
      const knowledge = prepared.preview.knowledge;
      if (!knowledge) {
        throw new AppError(
          "IMPORT_PREVIEW_INVALID",
          "v2 导入缺少知识链预检摘要。",
        );
      }
      const importResult: PortablePackageV2ImportResult = {
        ...baseSummary,
        claimsCreated: knowledge.claims.toCreate,
        claimsSkipped: knowledge.claims.toSkip,
        claimsRepaired: knowledge.claims.toRepair,
        evidenceCreated: knowledge.evidence.toCreate,
        evidenceSkipped: knowledge.evidence.toSkip,
        evidenceRepaired: knowledge.evidence.toRepair,
        attachmentsCreated: knowledge.attachments.toCreate,
        attachmentsSkipped: knowledge.attachments.toSkip,
        attachmentsRepaired: knowledge.attachments.toRepair,
        historicalContext: projection.historicalContext,
        downgraded: projection.downgraded,
      };
      const [completed] = await transaction
        .update(dataImportRuns)
        .set({
          status: "completed",
          resultSummary: importResult,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(dataImportRuns.id, prepared.runId),
            eq(dataImportRuns.workspaceId, actor.workspaceId),
            eq(dataImportRuns.actorId, actor.id),
            eq(dataImportRuns.status, "importing"),
          ),
        )
        .returning({ id: dataImportRuns.id });
      if (!completed) {
        throw new AppError(
          "IMPORT_RUN_NOT_READY",
          "v2 导入状态已经变化，本次事务已停止。",
        );
      }
      return importResult;
    });

    await removePortablePackageV2Staging(prepared.runId).catch(() => undefined);
    return result;
  } catch (error) {
    await Promise.all(
      writtenStoragePaths.map((storagePath) =>
        removeEvidenceImage(storagePath).catch(() => undefined),
      ),
    );
    await db
      .update(dataImportRuns)
      .set({
        status: "failed",
        errorCode: "IMPORT_TRANSACTION_FAILED",
        errorMessage: "v2 导入事务失败，数据库未提交部分知识链数据。",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(dataImportRuns.id, prepared.runId),
          eq(dataImportRuns.workspaceId, actor.workspaceId),
          eq(dataImportRuns.actorId, actor.id),
          eq(dataImportRuns.status, "importing"),
        ),
      );
    await removePortablePackageV2Staging(prepared.runId).catch(() => undefined);
    throw error;
  }
}

export async function confirmPortablePackageV2Import(
  runId: string,
  actor: TransferActor,
) {
  const prepared = await preparePortablePackageV2Confirm(runId, actor);
  const result = await applyPreparedPortablePackageV2Import(prepared, actor);
  return {
    runId,
    status: "completed" as const,
    result,
  };
}

export async function buildPortablePayloadV2(): Promise<PortablePayloadV2> {
  const actor = await currentTransferActor();
  if (!actor) throw new AppError("AUTH_REQUIRED", "请先登录。");

  const captureFilter = and(
    eq(captures.workspaceId, actor.workspaceId),
    actor.isAdmin
      ? undefined
      : or(
          eq(captures.createdById, actor.id),
          eq(captures.visibility, "shared"),
        ),
  );
  const captureRows = await db
    .select()
    .from(captures)
    .where(captureFilter)
    .orderBy(asc(captures.createdAt), asc(captures.id));
  const captureIds = captureRows.map((capture) => capture.id);

  const relationshipRows = captureIds.length
    ? await db
        .select()
        .from(captureCategories)
        .where(inArray(captureCategories.captureId, captureIds))
        .orderBy(
          asc(captureCategories.captureId),
          asc(captureCategories.categoryId),
        )
    : [];
  const relatedCategoryIds = [
    ...new Set(relationshipRows.map((relationship) => relationship.categoryId)),
  ];
  const categoryRows = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, actor.workspaceId),
        actor.isAdmin
          ? undefined
          : or(
              eq(categories.createdById, actor.id),
              relatedCategoryIds.length
                ? inArray(categories.id, relatedCategoryIds)
                : undefined,
            ),
      ),
    )
    .orderBy(asc(categories.createdAt), asc(categories.id));

  const claimRows = captureIds.length
    ? await db
        .select()
        .from(claims)
        .where(inArray(claims.captureId, captureIds))
        .orderBy(asc(claims.createdAt), asc(claims.id))
    : [];
  const claimIds = claimRows.map((claim) => claim.id);

  const evidenceRows = claimIds.length
    ? await db
        .select()
        .from(claimEvidence)
        .where(inArray(claimEvidence.claimId, claimIds))
        .orderBy(asc(claimEvidence.createdAt), asc(claimEvidence.id))
    : [];
  const evidenceIds = evidenceRows.map((evidence) => evidence.id);

  const reviewRows = claimIds.length
    ? await db
        .select()
        .from(claimReviews)
        .where(inArray(claimReviews.claimId, claimIds))
        .orderBy(
          asc(claimReviews.claimId),
          asc(claimReviews.reviewNumber),
          asc(claimReviews.id),
        )
    : [];
  const reviewIds = reviewRows.map((review) => review.id);

  const reviewEvidenceRows = reviewIds.length
    ? await db
        .select()
        .from(claimReviewEvidence)
        .where(inArray(claimReviewEvidence.reviewId, reviewIds))
        .orderBy(
          asc(claimReviewEvidence.reviewId),
          asc(claimReviewEvidence.evidenceId),
        )
    : [];

  const checkIds = [
    ...new Set(
      [
        ...evidenceRows.map((evidence) => evidence.latestSourceCheckId),
        ...reviewEvidenceRows.map((relationship) => relationship.sourceCheckId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const checkRows = checkIds.length
    ? await db
        .select()
        .from(evidenceSourceChecks)
        .where(inArray(evidenceSourceChecks.id, checkIds))
        .orderBy(asc(evidenceSourceChecks.checkedAt), asc(evidenceSourceChecks.id))
    : [];

  const evidenceRevisionRows = evidenceIds.length
    ? await db
        .select({
          evidenceId: claimEvidenceRevisions.evidenceId,
          version: claimEvidenceRevisions.version,
          latestSourceCheckId: claimEvidenceRevisions.latestSourceCheckId,
        })
        .from(claimEvidenceRevisions)
        .where(inArray(claimEvidenceRevisions.evidenceId, evidenceIds))
        .orderBy(
          asc(claimEvidenceRevisions.evidenceId),
          asc(claimEvidenceRevisions.version),
        )
    : [];

  const attachmentRows = evidenceIds.length
    ? await db
        .select()
        .from(evidenceAttachments)
        .where(inArray(evidenceAttachments.evidenceId, evidenceIds))
        .orderBy(
          asc(evidenceAttachments.evidenceId),
          asc(evidenceAttachments.createdAt),
          asc(evidenceAttachments.id),
        )
    : [];

  const categoryKeysByCapture = new Map<string, string[]>();
  for (const relationship of relationshipRows) {
    const values = categoryKeysByCapture.get(relationship.captureId) ?? [];
    values.push(relationship.categoryId);
    categoryKeysByCapture.set(relationship.captureId, values);
  }

  const checkVersionById = new Map<string, number>();
  for (const evidence of evidenceRows) {
    if (evidence.latestSourceCheckId) {
      checkVersionById.set(evidence.latestSourceCheckId, evidence.version);
    }
  }
  for (const revision of evidenceRevisionRows) {
    if (revision.latestSourceCheckId && !checkVersionById.has(revision.latestSourceCheckId)) {
      checkVersionById.set(revision.latestSourceCheckId, revision.version);
    }
  }

  const attachmentIds = new Set(attachmentRows.map((attachment) => attachment.id));
  const sourceChecks: PortableWebSourceCheckV2[] = [];
  const attachmentChecks: PortableAttachmentCheckV2[] = [];
  const attachmentCheckImages: PortablePayloadV2["attachmentCheckImages"] = [];

  for (const check of checkRows) {
    const evidenceVersion = checkVersionById.get(check.id) ?? null;
    if (check.verificationMethod === "web") {
      sourceChecks.push({
        key: check.id,
        evidenceKey: check.evidenceId,
        evidenceVersion,
        requestedUrl: check.requestedUrl,
        finalUrl: check.finalUrl,
        status: check.status,
        httpStatus: check.httpStatus,
        contentType: check.contentType,
        contentHash: check.contentHash,
        fetchedTitle: check.fetchedTitle,
        excerptMatch: check.excerptMatch,
        responseBytes: check.responseBytes,
        errorCode: check.errorCode,
        checkedAt: check.checkedAt.toISOString(),
      });
      continue;
    }

    if (
      check.status !== "passed" ||
      !check.contentHash ||
      check.responseBytes === null ||
      !check.verificationNote ||
      !Array.isArray(check.attachmentSnapshot) ||
      check.attachmentSnapshot.length === 0
    ) {
      throw new AppError(
        "EXPORT_ATTACHMENT_CHECK_INVALID",
        `附件核验 ${check.id} 的冻结快照不完整，无法生成 v2 交换包。`,
      );
    }
    attachmentChecks.push({
      key: check.id,
      evidenceKey: check.evidenceId,
      evidenceVersion,
      contentHash: check.contentHash,
      responseBytes: check.responseBytes,
      verificationNote: check.verificationNote,
      checkedAt: check.checkedAt.toISOString(),
    });
    for (const attachment of check.attachmentSnapshot) {
      if (!attachmentIds.has(attachment.id)) {
        throw new AppError(
          "EXPORT_ATTACHMENT_SNAPSHOT_MISSING",
          `附件核验 ${check.id} 引用的图片 ${attachment.id} 已不存在，无法生成可恢复的 v2 交换包。`,
        );
      }
      attachmentCheckImages.push({
        checkKey: check.id,
        attachmentKey: attachment.id,
      });
    }
  }

  const payload: PortablePayloadV2 = {
    formatVersion: DATA_TRANSFER_V2_FORMAT_VERSION,
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    records: captureRows.map((capture) => ({
      key: capture.id,
      title: capture.title,
      content: capture.content,
      contentType: capture.contentType,
      subject: capture.subject,
      occurredAt: capture.occurredAt.toISOString(),
      status: capture.status,
      categoryKeys: categoryKeysByCapture.get(capture.id) ?? [],
    })),
    categories: categoryRows.map((category) => ({
      key: category.id,
      name: category.name,
      description: category.description,
      status: category.status,
    })),
    claims: claimRows.map((claim) => ({
      key: claim.id,
      recordKey: claim.captureId,
      sourceCaptureVersion: claim.sourceCaptureVersion,
      statement: claim.statement,
      sourceExcerpt: claim.sourceExcerpt,
      falsificationCriteria: claim.falsificationCriteria,
      originalStatus: claim.status,
    })),
    evidence: evidenceRows.map((evidence) => ({
      key: evidence.id,
      claimKey: evidence.claimId,
      sourceUrl: evidence.sourceUrl,
      sourceTitle: evidence.sourceTitle,
      excerpt: evidence.excerpt,
      stance: evidence.stance,
      note: evidence.note,
      version: evidence.version,
      originalReviewStatus: evidence.reviewStatus,
      originalSourceCheckStatus: evidence.sourceCheckStatus,
      originalSourceExcerptMatch: evidence.sourceExcerptMatch,
      latestCheckKey: evidence.latestSourceCheckId,
    })),
    sourceChecks,
    attachmentChecks,
    attachmentCheckImages,
    reviews: reviewRows.map((review) => ({
      key: review.id,
      claimKey: review.claimId,
      reviewNumber: review.reviewNumber,
      assessment: review.assessment,
      rationale: review.rationale,
      limitations: review.limitations,
      reviewerId: review.reviewerId,
      reviewerName: review.reviewerName,
      createdAt: review.createdAt.toISOString(),
    })),
    reviewEvidence: reviewEvidenceRows.map((relationship) => ({
      reviewKey: relationship.reviewId,
      evidenceKey: relationship.evidenceId,
      checkKey: relationship.sourceCheckId,
      stance: relationship.stance,
      sourceUrl: relationship.sourceUrl,
      sourceTitle: relationship.sourceTitle,
      excerpt: relationship.excerpt,
      finalUrl: relationship.finalUrl,
      sourceContentHash: relationship.sourceContentHash,
      sourceCheckedAt: relationship.sourceCheckedAt.toISOString(),
    })),
    attachments: attachmentRows.map((attachment) => ({
      key: attachment.id,
      evidenceKey: attachment.evidenceId,
      relativePath: portableAttachmentPath({
        evidenceId: attachment.evidenceId,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
      }),
      originalName: attachment.originalName,
      mimeType: attachment.mimeType as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "image/gif",
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
    })),
  };

  return portablePayloadV2Schema.parse(payload);
}

export async function exportPortableWorkbookV2(): Promise<Buffer> {
  return createPortableWorkbookV2(await buildPortablePayloadV2());
}

export async function exportPortablePackageV2(): Promise<Buffer> {
  const payload = await buildPortablePayloadV2();
  if (payload.attachments.length === 0) {
    return createPortablePackageV2(payload, new Map());
  }

  const attachmentIds = payload.attachments.map((attachment) => attachment.key);
  const storageRows = await db
    .select({
      id: evidenceAttachments.id,
      storagePath: evidenceAttachments.storagePath,
    })
    .from(evidenceAttachments)
    .where(inArray(evidenceAttachments.id, attachmentIds));
  const storagePathById = new Map(
    storageRows.map((attachment) => [attachment.id, attachment.storagePath]),
  );

  const attachmentBytes = new Map<string, Buffer>();
  for (const attachment of payload.attachments) {
    const storagePath = storagePathById.get(attachment.key);
    if (!storagePath) {
      throw new AppError(
        "EXPORT_ATTACHMENT_STORAGE_MISSING",
        `证据图片 ${attachment.key} 的存储记录不存在，无法生成可恢复的 v2 交换包。`,
      );
    }

    try {
      attachmentBytes.set(attachment.key, await readEvidenceImage(storagePath));
    } catch (error) {
      throw new AppError(
        "EXPORT_ATTACHMENT_FILE_UNREADABLE",
        `证据图片 ${attachment.key} 的文件无法读取，无法生成可恢复的 v2 交换包。`,
        {
          attachmentId: attachment.key,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  return createPortablePackageV2(payload, attachmentBytes);
}
