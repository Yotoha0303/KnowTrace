import { describe, expect, it } from "vitest";

import {
  calculateEvidenceBalance,
  calculateEvidenceCoverage,
  claimAuditEvidenceFingerprint,
  sanitizeClaimAuditPayload,
  type ClaimAuditEvidenceInput,
} from "./claim-audit";

function evidence(
  id: string,
  stance: ClaimAuditEvidenceInput["stance"],
  host: string,
): ClaimAuditEvidenceInput {
  return {
    id,
    stance,
    sourceUrl: `https://${host}/source`,
    sourceTitle: "来源",
    excerpt: "可追溯摘录",
    note: null,
    sourceCheckId: id.replace(/.$/, "f"),
    finalUrl: `https://${host}/source`,
    contentHash: "a".repeat(64),
    sourceCheckedAt: "2026-08-15T00:00:00.000Z",
  };
}

const first = evidence(
  "11111111-1111-4111-8111-111111111111",
  "supports",
  "one.example",
);
const second = evidence(
  "22222222-2222-4222-8222-222222222222",
  "contradicts",
  "two.example",
);

describe("claim AI audit invariants", () => {
  it("calculates coverage and balance from evidence rather than model claims", () => {
    expect(calculateEvidenceCoverage([first])).toBe("limited");
    expect(calculateEvidenceCoverage([first, second])).toBe("moderate");
    expect(calculateEvidenceBalance([first])).toBe("one_sided");
    expect(calculateEvidenceBalance([first, second])).toBe("mixed");
  });

  it("removes hallucinated evidence ids and enforces the boundary notice", () => {
    const payload = sanitizeClaimAuditPayload(
      {
        summary: "测试审查",
        evidence_coverage: "broad",
        evidence_balance: "mixed",
        findings: [
          {
            category: "source_quality",
            severity: "medium",
            message: "需要核对。",
            evidence_ids: [
              first.id,
              "33333333-3333-4333-8333-333333333333",
            ],
          },
        ],
        missing_checks: [],
        recommended_assessment: "supported",
        boundary_notice: "模型试图越权。",
      },
      [first],
    );

    expect(payload.evidence_coverage).toBe("limited");
    expect(payload.evidence_balance).toBe("one_sided");
    expect(payload.findings[0]?.evidence_ids).toEqual([first.id]);
    expect(payload.boundary_notice).toContain("不能替代人工判断");
  });

  it("produces a stable fingerprint regardless of evidence order", () => {
    expect(claimAuditEvidenceFingerprint([first, second])).toBe(
      claimAuditEvidenceFingerprint([second, first]),
    );
  });
});
