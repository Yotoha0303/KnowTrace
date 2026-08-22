import { describe, expect, it } from "vitest";

import {
  addClaimEvidenceSchema,
  transitionClaimSchema,
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

  it("only accepts HTTP(S) evidence sources", () => {
    const base = {
      claimId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      sourceTitle: "来源标题",
      excerpt: "来源中的原始证据摘录",
      stance: "supports" as const,
    };

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
  });
});
