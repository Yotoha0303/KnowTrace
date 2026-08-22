import { describe, expect, it } from "vitest";

import { evaluateReleaseReadiness, sourceIdentity, type ReliabilityInput } from "./readiness";

function validInput(): ReliabilityInput {
  return {
    authenticated: true,
    claimStatus: "concluded",
    review: { id: "review-1", reviewerId: "go-user:1" },
    evidence: [
      {
        id: "evidence-1",
        currentReviewStatus: "accepted",
        currentSourceCheckStatus: "passed",
        currentExcerptMatch: true,
        currentSourceCheckId: "check-1",
        snapshotSourceCheckId: "check-1",
        finalUrl: "https://official.example/report",
        authority: { level: "official", publisher: "官方机构" },
      },
      {
        id: "evidence-2",
        currentReviewStatus: "accepted",
        currentSourceCheckStatus: "passed",
        currentExcerptMatch: true,
        currentSourceCheckId: "check-2",
        snapshotSourceCheckId: "check-2",
        finalUrl: "https://research.example/paper",
        authority: { level: "expert", publisher: "研究机构" },
      },
    ],
    independentReviews: [
      { decision: "approved", reviewerId: "go-user:2", isStale: false },
    ],
  };
}

describe("reliable knowledge release gates", () => {
  it("passes only when identity, evidence, authority and independent review all pass", () => {
    const checks = evaluateReleaseReadiness(validInput());
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects self-review, one source and changed evidence snapshots", () => {
    const input = validInput();
    input.evidence[1].finalUrl = "https://official.example/other";
    input.evidence[0].currentSourceCheckId = "changed";
    input.independentReviews = [
      { decision: "approved", reviewerId: "go-user:1", isStale: false },
    ];
    const failed = new Set(
      evaluateReleaseReadiness(input)
        .filter((check) => !check.passed)
        .map((check) => check.code),
    );
    expect(failed).toEqual(
      new Set(["evidence_current", "independent_sources", "independent_review"]),
    );
  });

  it("uses normalized hostnames and offline publishers as source identities", () => {
    expect(sourceIdentity({ id: "1", finalUrl: "https://www.Example.com/a", authority: null })).toBe("web:example.com");
    expect(sourceIdentity({ id: "2", finalUrl: "attachment://snapshot/2", authority: { publisher: "某公司" } })).toBe("offline:某公司");
  });
});
