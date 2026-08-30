import { describe, expect, it } from "vitest";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import { buildPortableV2SafeImportProjection } from "./downgrade-v2";

const payload: PortablePayloadV2 = {
  formatVersion: "2",
  trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
  records: [
    {
      key: "record-1",
      title: null,
      content: "测试原文",
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
      key: "claim-concluded",
      recordKey: "record-1",
      sourceCaptureVersion: 1,
      statement: "已形成结论的主张",
      sourceExcerpt: "测试原文",
      falsificationCriteria: "出现反例",
      originalStatus: "concluded",
    },
    {
      key: "claim-empty",
      recordKey: "record-1",
      sourceCaptureVersion: 1,
      statement: "尚无证据的主张",
      sourceExcerpt: "测试原文",
      falsificationCriteria: "出现反例",
      originalStatus: "ready_for_review",
    },
    {
      key: "claim-withdrawn",
      recordKey: "record-1",
      sourceCaptureVersion: 1,
      statement: "已撤回主张",
      sourceExcerpt: "测试原文",
      falsificationCriteria: "出现反例",
      originalStatus: "withdrawn",
    },
  ],
  evidence: [
    {
      key: "evidence-1",
      claimKey: "claim-concluded",
      sourceUrl: "https://example.com",
      sourceTitle: "来源",
      excerpt: "证据摘录",
      stance: "supports",
      note: null,
      version: 1,
      originalReviewStatus: "accepted",
      originalSourceCheckStatus: "passed",
      originalSourceExcerptMatch: true,
      latestCheckKey: "check-1",
    },
  ],
  sourceChecks: [
    {
      key: "check-1",
      evidenceKey: "evidence-1",
      evidenceVersion: 1,
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com",
      status: "passed",
      httpStatus: 200,
      contentType: "text/html",
      contentHash: "a".repeat(64),
      fetchedTitle: "来源",
      excerptMatch: true,
      responseBytes: 10,
      errorCode: null,
      checkedAt: "2026-08-23T00:10:00.000Z",
    },
  ],
  attachmentChecks: [],
  attachmentCheckImages: [],
  reviews: [
    {
      key: "review-1",
      claimKey: "claim-concluded",
      reviewNumber: 1,
      assessment: "supported",
      rationale: "已有证据支持",
      limitations: null,
      reviewerId: "user-1",
      reviewerName: "审核者",
      createdAt: "2026-08-23T00:20:00.000Z",
    },
  ],
  reviewEvidence: [],
  attachments: [],
};

describe("v2 editable-package safe downgrade", () => {
  it("removes trust-bearing workflow states while keeping investigation context", () => {
    const projection = buildPortableV2SafeImportProjection(payload);

    expect(projection.trustPolicy).toBe(DATA_TRANSFER_V2_TRUST_POLICY);
    expect(projection.claims).toEqual([
      {
        key: "claim-concluded",
        originalStatus: "concluded",
        originalSourceCaptureVersion: 1,
        targetStatus: "investigating",
        targetSourceCaptureVersion: "local_current",
      },
      {
        key: "claim-empty",
        originalStatus: "ready_for_review",
        originalSourceCaptureVersion: 1,
        targetStatus: "candidate",
        targetSourceCaptureVersion: "local_current",
      },
      {
        key: "claim-withdrawn",
        originalStatus: "withdrawn",
        originalSourceCaptureVersion: 1,
        targetStatus: "withdrawn",
        targetSourceCaptureVersion: "local_current",
      },
    ]);
    expect(projection.evidence).toEqual([
      {
        key: "evidence-1",
        originalVersion: 1,
        originalReviewStatus: "accepted",
        originalSourceCheckStatus: "passed",
        targetVersion: 1,
        targetReviewStatus: "unreviewed",
        targetSourceCheckStatus: "unchecked",
        targetSourceExcerptMatch: null,
        restoreLatestCheck: false,
      },
    ]);
    expect(projection.historicalContext.reviews).toBe(1);
    expect(projection.downgraded).toEqual({
      claimTrustStates: 2,
      claimSourceVersions: 3,
      evidenceVersions: 0,
      evidenceReviewStates: 1,
      evidenceCheckStates: 1,
      reviews: 1,
    });
  });
});
