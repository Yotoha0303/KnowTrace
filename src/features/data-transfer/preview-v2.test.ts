import { describe, expect, it } from "vitest";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import { buildPortableV2KnowledgePreview } from "./preview-v2";
import { listPortableV2ImportObjects } from "./provenance-v2";

function payload(): PortablePayloadV2 {
  return {
    formatVersion: "2",
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    records: [
      {
        key: "record-1",
        title: null,
        content: "原文",
        contentType: "observation",
        subject: null,
        occurredAt: "2026-08-27T00:00:00.000Z",
        status: "active",
        categoryKeys: [],
      },
    ],
    categories: [],
    claims: [
      {
        key: "claim-1",
        recordKey: "record-1",
        sourceCaptureVersion: 1,
        statement: "主张",
        sourceExcerpt: "原文",
        falsificationCriteria: "出现反例",
        originalStatus: "concluded",
      },
    ],
    evidence: [
      {
        key: "evidence-1",
        claimKey: "claim-1",
        sourceUrl: "",
        sourceTitle: "图片来源",
        excerpt: "证据",
        stance: "supports",
        note: null,
        version: 1,
        originalReviewStatus: "accepted",
        originalSourceCheckStatus: "unchecked",
        originalSourceExcerptMatch: null,
        latestCheckKey: null,
      },
    ],
    sourceChecks: [],
    attachmentChecks: [],
    attachmentCheckImages: [],
    reviews: [],
    reviewEvidence: [],
    attachments: [
      {
        key: "attachment-1",
        evidenceKey: "evidence-1",
        relativePath: "attachments/evidence-1/attachment-1.png",
        originalName: "证据.png",
        mimeType: "image/png",
        byteSize: 12,
        sha256: "a".repeat(64),
      },
    ],
  };
}

describe("v2 knowledge import preview", () => {
  it("reports new objects and trust-state downgrades", () => {
    const summary = buildPortableV2KnowledgePreview(payload(), []);

    expect(summary.valid).toBe(true);
    expect(summary.claims).toEqual({
      total: 1,
      toCreate: 1,
      toSkip: 0,
      toRepair: 0,
      conflicts: 0,
    });
    expect(summary.evidence.toCreate).toBe(1);
    expect(summary.attachments.toCreate).toBe(1);
    expect(summary.downgraded.claimTrustStates).toBe(1);
    expect(summary.downgraded.evidenceReviewStates).toBe(1);
  });

  it("distinguishes identical skips from stale mappings that need repair", () => {
    const source = payload();
    const objects = listPortableV2ImportObjects(source);
    const existing = objects.map((object, index) => ({
      ...object,
      localId: `local-${index}`,
      localExists: object.objectType !== "claim",
    }));
    const summary = buildPortableV2KnowledgePreview(source, existing);

    expect(summary.valid).toBe(true);
    expect(summary.claims.toRepair).toBe(1);
    expect(summary.claims.toSkip).toBe(0);
    expect(summary.evidence.toSkip).toBe(1);
    expect(summary.attachments.toSkip).toBe(1);
  });

  it("blocks a claim whose source excerpt is no longer present in the exported current record", () => {
    const source = payload();
    source.claims[0]!.sourceExcerpt = "旧版本中的原文";

    const summary = buildPortableV2KnowledgePreview(source, []);

    expect(summary.valid).toBe(false);
    expect(summary.issues).toContainEqual(
      expect.objectContaining({
        sheet: "主张",
        field: "claim-1",
        message: expect.stringContaining("不迁移完整 Revision 链"),
      }),
    );
  });

  it("blocks more attachments than the normal per-evidence upload limit", () => {
    const source = payload();
    source.attachments = Array.from({ length: 6 }, (_, index) => ({
      ...source.attachments[0]!,
      key: `attachment-${index + 1}`,
      relativePath: `attachments/evidence-1/attachment-${index + 1}.png`,
      sha256: `${index}`.repeat(64),
    }));

    const summary = buildPortableV2KnowledgePreview(source, []);

    expect(summary.valid).toBe(false);
    expect(summary.issues).toContainEqual(
      expect.objectContaining({
        sheet: "图片清单",
        field: "evidence-1",
        message: expect.stringContaining("最多允许 5 张图片"),
      }),
    );
  });

  it("turns changed content under the same source identity into a blocking conflict", () => {
    const original = payload();
    const [claim] = listPortableV2ImportObjects(original);
    const changed = payload();
    changed.claims[0]!.statement = "内容已变化";

    const summary = buildPortableV2KnowledgePreview(changed, [
      { ...claim!, localId: "local-claim", localExists: true },
    ]);

    expect(summary.valid).toBe(false);
    expect(summary.claims.conflicts).toBe(1);
    expect(summary.issues).toContainEqual(
      expect.objectContaining({
        sheet: "主张",
        field: "claim-1",
        message: expect.stringContaining("本次内容不同"),
      }),
    );
  });
});
