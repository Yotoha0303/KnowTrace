import {
  AI_AUDIT_BOUNDARY_NOTICE,
  claimAIAuditPayloadSchema,
  type ClaimAIAuditPayload,
  type ClaimAIAuditEvidenceSnapshotItem,
} from "./schema";
import { sha256, stableStringify } from "@/shared/hash";

export type ClaimAuditEvidenceInput = ClaimAIAuditEvidenceSnapshotItem;

function sourceHost(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.toLocaleLowerCase("en-US");
  } catch {
    return sourceUrl;
  }
}

export function calculateEvidenceCoverage(
  evidence: ClaimAuditEvidenceInput[],
): ClaimAIAuditPayload["evidence_coverage"] {
  const hostCount = new Set(evidence.map((item) => sourceHost(item.finalUrl))).size;
  if (evidence.length >= 4 && hostCount >= 3) return "broad";
  if (evidence.length >= 2 && hostCount >= 2) return "moderate";
  return "limited";
}

export function calculateEvidenceBalance(
  evidence: ClaimAuditEvidenceInput[],
): ClaimAIAuditPayload["evidence_balance"] {
  const hasSupports = evidence.some((item) => item.stance === "supports");
  const hasContradicts = evidence.some((item) => item.stance === "contradicts");
  if (hasSupports && hasContradicts) return "mixed";
  if (hasSupports || hasContradicts) return "one_sided";
  return "insufficient";
}

export function claimAuditEvidenceFingerprint(
  evidence: ClaimAuditEvidenceInput[],
): string {
  return sha256(
    stableStringify(
      [...evidence]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((item) => ({
          id: item.id,
          stance: item.stance,
          sourceCheckId: item.sourceCheckId,
          finalUrl: item.finalUrl,
          contentHash: item.contentHash,
          sourceCheckedAt: item.sourceCheckedAt,
        })),
    ),
  );
}

export function sanitizeClaimAuditPayload(
  rawPayload: ClaimAIAuditPayload,
  evidence: ClaimAuditEvidenceInput[],
): ClaimAIAuditPayload {
  const payload = claimAIAuditPayloadSchema.parse(rawPayload);
  const allowedEvidenceIds = new Set(evidence.map((item) => item.id));

  return claimAIAuditPayloadSchema.parse({
    ...payload,
    evidence_coverage: calculateEvidenceCoverage(evidence),
    evidence_balance: calculateEvidenceBalance(evidence),
    findings: payload.findings.map((finding) => ({
      ...finding,
      evidence_ids: [
        ...new Set(
          finding.evidence_ids.filter((id) => allowedEvidenceIds.has(id)),
        ),
      ],
    })),
    missing_checks:
      evidence.length === 0
        ? [
            "至少收集并人工采纳一条来源可访问、摘录匹配的证据。",
            ...payload.missing_checks,
          ].slice(0, 5)
        : payload.missing_checks,
    recommended_assessment:
      evidence.length === 0
        ? "needs_more_evidence"
        : payload.recommended_assessment,
    boundary_notice: AI_AUDIT_BOUNDARY_NOTICE,
  });
}
