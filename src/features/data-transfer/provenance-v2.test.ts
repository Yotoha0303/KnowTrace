import { describe, expect, it } from "vitest";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import {
  analyzePortableV2Provenance,
  listPortableV2ImportObjects,
  portableV2ProvenanceKey,
} from "./provenance-v2";

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
        occurredAt: "2026-08-23T00:00:00.000Z",
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
        originalStatus: "investigating",
      },
    ],
    evidence: [
      {
        key: "evidence-1",
        claimKey: "claim-1",
        sourceUrl: "https://example.com",
        sourceTitle: "来源",
        excerpt: "证据",
        stance: "supports",
        note: null,
        version: 1,
        originalReviewStatus: "unreviewed",
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
        byteSize: 10,
        sha256: "a".repeat(64),
      },
    ],
  };
}

describe("v2 import provenance", () => {
  it("uses separate object namespaces for stable source keys", () => {
    const objects = listPortableV2ImportObjects(payload());
    expect(objects.map((item) => item.objectType)).toEqual([
      "claim",
      "evidence",
      "attachment",
    ]);
    expect(portableV2ProvenanceKey("claim", "same-key")).not.toBe(
      portableV2ProvenanceKey("evidence", "same-key"),
    );
  });

  it("skips identical previously imported objects", () => {
    const source = payload();
    const objects = listPortableV2ImportObjects(source);
    const analysis = analyzePortableV2Provenance(
      source,
      objects.map((item, index) => ({ ...item, localId: `local-${index}` })),
    );

    expect(analysis.conflicts).toEqual([]);
    expect(analysis.toCreate.size).toBe(0);
    expect(analysis.toSkip.size).toBe(3);
  });

  it("repairs identical provenance when the mapped local object was deleted", () => {
    const source = payload();
    const [claim] = listPortableV2ImportObjects(source);
    const analysis = analyzePortableV2Provenance(source, [
      { ...claim!, localId: "deleted-local-claim", localExists: false },
    ]);

    expect(analysis.conflicts).toEqual([]);
    expect(analysis.toRepair).toContain(
      portableV2ProvenanceKey("claim", "claim-1"),
    );
    expect(analysis.toSkip).not.toContain(
      portableV2ProvenanceKey("claim", "claim-1"),
    );
  });

  it("reports same source identity with changed content as a conflict", () => {
    const original = payload();
    const [claim] = listPortableV2ImportObjects(original);
    const changed = payload();
    changed.claims[0]!.statement = "被修改的主张";

    const analysis = analyzePortableV2Provenance(changed, [
      { ...claim!, localId: "local-claim" },
    ]);

    expect(analysis.conflicts).toEqual([
      expect.objectContaining({
        objectType: "claim",
        sourceKey: "claim-1",
        existingHash: claim!.contentHash,
      }),
    ]);
    expect(analysis.conflicts[0]!.incomingHash).not.toBe(claim!.contentHash);
  });
});
