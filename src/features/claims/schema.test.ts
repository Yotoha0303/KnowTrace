import { describe, expect, it } from "vitest";

import {
  addClaimEvidenceSchema,
  checkClaimEvidenceSourceSchema,
  createManualClaimSchema,
  transitionClaimSchema,
  updateClaimEvidenceSchema,
  uploadEvidenceImageSchema,
} from "./schema";

describe("claim workflow schemas", () => {
  it("accepts a local transition request", () => {
    expect(
      transitionClaimSchema.safeParse({
        claimId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        expectedStatus: "candidate",
        targetStatus: "investigating",
      }).success,
    ).toBe(true);
  });

  it("requires a complete manually entered falsifiable claim", () => {
    const valid = {
      captureId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      expectedCaptureVersion: 2,
      statement: "每天复盘能够提高问题处理效率",
      sourceExcerpt: "我通过每天复盘改进了处理方式",
      falsificationCriteria: "若长期对照记录显示处理效率没有提升，则应修正该主张",
    };
    expect(createManualClaimSchema.safeParse(valid).success).toBe(true);
    expect(createManualClaimSchema.safeParse({
      ...valid,
      falsificationCriteria: "无法证伪",
    }).success).toBe(false);
  });

  it("accepts an empty evidence source URL or a valid HTTP(S) URL", () => {
    const base = {
      claimId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      sourceTitle: "来源标题",
      excerpt: "来源中的原始证据摘录",
      stance: "supports" as const,
    };

    expect(
      addClaimEvidenceSchema.safeParse({
        ...base,
        sourceUrl: "",
      }).success,
    ).toBe(true);
    expect(
      addClaimEvidenceSchema.safeParse({
        ...base,
        sourceUrl: "https://example.com/source",
      }).success,
    ).toBe(true);
    expect(
      addClaimEvidenceSchema.safeParse({
        ...base,
        sourceUrl: "file:///tmp/source",
      }).success,
    ).toBe(false);
    expect(
      addClaimEvidenceSchema.safeParse({
        ...base,
        sourceUrl: "微信",
      }).success,
    ).toBe(false);
  });

  it("requires an evidence version when editing", () => {
    expect(
      updateClaimEvidenceSchema.safeParse({
        evidenceId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        expectedVersion: 2,
        sourceTitle: "修订后的来源",
        sourceUrl: "https://example.com/revised",
        excerpt: "修订后的原始摘录",
        stance: "context",
      }).success,
    ).toBe(true);
    expect(
      updateClaimEvidenceSchema.safeParse({
        evidenceId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        expectedVersion: 0,
        sourceTitle: "来源",
        sourceUrl: "https://example.com",
        excerpt: "摘录",
        stance: "supports",
      }).success,
    ).toBe(false);
  });

  it("accepts an explicit manual attachment confirmation", () => {
    expect(
      checkClaimEvidenceSourceSchema.safeParse({
        evidenceId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        manualConfirmation: true,
      }).success,
    ).toBe(true);
  });

  it("limits evidence uploads to supported images under 10 MB", () => {
    const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], "proof.jpg", {
      type: "image/jpeg",
    });
    const text = new File(["not an image"], "proof.txt", { type: "text/plain" });
    expect(
      uploadEvidenceImageSchema.safeParse({
        evidenceId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        file: image,
      }).success,
    ).toBe(true);
    expect(
      uploadEvidenceImageSchema.safeParse({
        evidenceId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        file: text,
      }).success,
    ).toBe(false);
  });
});
