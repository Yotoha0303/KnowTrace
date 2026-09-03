import { MAX_EVIDENCE_IMAGES } from "@/features/claims/image-validation";

import { type ImportIssue } from "./contracts";
import type { PortablePayloadV2 } from "./contracts-v2";
import {
  buildPortableV2SafeImportProjection,
  type PortableV2SafeImportProjection,
} from "./downgrade-v2";
import {
  analyzePortableV2Provenance,
  portableV2ProvenanceKey,
  type ExistingPortableV2ImportObject,
  type PortableV2ImportObjectType,
  type PortableV2ProvenanceConflict,
} from "./provenance-v2";

export type PortableV2ObjectPreview = {
  total: number;
  toCreate: number;
  toSkip: number;
  toRepair: number;
  conflicts: number;
};

export type PortableV2KnowledgePreviewSummary = {
  valid: boolean;
  claims: PortableV2ObjectPreview;
  evidence: PortableV2ObjectPreview;
  attachments: PortableV2ObjectPreview;
  historicalContext: PortableV2SafeImportProjection["historicalContext"];
  downgraded: PortableV2SafeImportProjection["downgraded"];
  issues: ImportIssue[];
};

function previewForType(
  payload: PortablePayloadV2,
  analysis: ReturnType<typeof analyzePortableV2Provenance>,
  objectType: PortableV2ImportObjectType,
): PortableV2ObjectPreview {
  const objects = analysis.objects.filter((object) => object.objectType === objectType);
  const keySet = new Set(objects.map((object) => portableV2ProvenanceKey(objectType, object.sourceKey)));
  const countMatching = (set: Set<string>) => {
    let count = 0;
    for (const key of set) {
      if (keySet.has(key)) count += 1;
    }
    return count;
  };

  return {
    total:
      objectType === "claim"
        ? payload.claims.length
        : objectType === "evidence"
          ? payload.evidence.length
          : payload.attachments.length,
    toCreate: countMatching(analysis.toCreate),
    toSkip: countMatching(analysis.toSkip),
    toRepair: countMatching(analysis.toRepair),
    conflicts: analysis.conflicts.filter((conflict) => conflict.objectType === objectType).length,
  };
}

export function portableV2ImportCompatibilityIssues(
  payload: PortablePayloadV2,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const recordByKey = new Map(payload.records.map((record) => [record.key, record]));
  for (const claim of payload.claims) {
    const record = recordByKey.get(claim.recordKey);
    if (record && !record.content.includes(claim.sourceExcerpt)) {
      issues.push({
        sheet: "主张",
        row: 0,
        field: claim.key,
        message:
          "来源摘录已无法在导出的当前记录正文中定位。当前 v2 不迁移完整 Revision 链，不能安全恢复该主张。",
      });
    }
  }

  const attachmentCountByEvidence = new Map<string, number>();
  for (const attachment of payload.attachments) {
    attachmentCountByEvidence.set(
      attachment.evidenceKey,
      (attachmentCountByEvidence.get(attachment.evidenceKey) ?? 0) + 1,
    );
  }
  for (const [evidenceKey, count] of attachmentCountByEvidence) {
    if (count > MAX_EVIDENCE_IMAGES) {
      issues.push({
        sheet: "图片清单",
        row: 0,
        field: evidenceKey,
        message: `同一证据最多允许 ${MAX_EVIDENCE_IMAGES} 张图片，当前为 ${count} 张。`,
      });
    }
  }
  return issues;
}

function conflictIssue(conflict: PortableV2ProvenanceConflict): ImportIssue {
  const sheet =
    conflict.objectType === "claim"
      ? "主张"
      : conflict.objectType === "evidence"
        ? "证据"
        : "图片清单";
  return {
    sheet,
    row: 0,
    field: conflict.sourceKey,
    message: "该来源标识已经导入过，但本次内容不同。请保留原内容或使用新的来源标识。",
  };
}

export function buildPortableV2KnowledgePreview(
  payload: PortablePayloadV2,
  existing: ExistingPortableV2ImportObject[],
): PortableV2KnowledgePreviewSummary {
  const analysis = analyzePortableV2Provenance(payload, existing);
  const projection = buildPortableV2SafeImportProjection(payload);
  const issues = [
    ...analysis.conflicts.map(conflictIssue),
    ...portableV2ImportCompatibilityIssues(payload),
  ].slice(0, 100);

  return {
    valid: issues.length === 0,
    claims: previewForType(payload, analysis, "claim"),
    evidence: previewForType(payload, analysis, "evidence"),
    attachments: previewForType(payload, analysis, "attachment"),
    historicalContext: projection.historicalContext,
    downgraded: projection.downgraded,
    issues,
  };
}
