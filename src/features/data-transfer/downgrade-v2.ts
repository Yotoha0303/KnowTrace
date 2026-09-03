import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";

export type PortableV2SafeClaimState = "candidate" | "investigating" | "withdrawn";

export type PortableV2SafeImportProjection = {
  trustPolicy: typeof DATA_TRANSFER_V2_TRUST_POLICY;
  claims: Array<{
    key: string;
    originalStatus: PortablePayloadV2["claims"][number]["originalStatus"];
    originalSourceCaptureVersion: number;
    targetStatus: PortableV2SafeClaimState;
    targetSourceCaptureVersion: "local_current";
  }>;
  evidence: Array<{
    key: string;
    originalVersion: number;
    originalReviewStatus: PortablePayloadV2["evidence"][number]["originalReviewStatus"];
    originalSourceCheckStatus: PortablePayloadV2["evidence"][number]["originalSourceCheckStatus"];
    targetVersion: 1;
    targetReviewStatus: "unreviewed";
    targetSourceCheckStatus: "unchecked";
    targetSourceExcerptMatch: null;
    restoreLatestCheck: false;
  }>;
  historicalContext: {
    sourceChecks: number;
    attachmentChecks: number;
    reviews: number;
    reviewEvidenceRelationships: number;
  };
  downgraded: {
    claimTrustStates: number;
    claimSourceVersions: number;
    evidenceVersions: number;
    evidenceReviewStates: number;
    evidenceCheckStates: number;
    reviews: number;
  };
};

/**
 * Projects an editable v2 exchange payload onto states that are safe to persist.
 *
 * The workbook intentionally carries original review/check/conclusion metadata so a
 * user can understand the migrated investigation. Those cells are editable and are
 * therefore not an integrity boundary. Database import must use this projection
 * instead of restoring trust-bearing states directly from the workbook.
 */
export function buildPortableV2SafeImportProjection(
  payload: PortablePayloadV2,
): PortableV2SafeImportProjection {
  const evidenceCountByClaim = new Map<string, number>();
  for (const evidence of payload.evidence) {
    evidenceCountByClaim.set(
      evidence.claimKey,
      (evidenceCountByClaim.get(evidence.claimKey) ?? 0) + 1,
    );
  }

  const claims = payload.claims.map((claim) => {
    const targetStatus: PortableV2SafeClaimState =
      claim.originalStatus === "withdrawn"
        ? "withdrawn"
        : (evidenceCountByClaim.get(claim.key) ?? 0) > 0
          ? "investigating"
          : "candidate";
    return {
      key: claim.key,
      originalStatus: claim.originalStatus,
      originalSourceCaptureVersion: claim.sourceCaptureVersion,
      targetStatus,
      targetSourceCaptureVersion: "local_current" as const,
    };
  });

  const evidence = payload.evidence.map((item) => ({
    key: item.key,
    originalVersion: item.version,
    originalReviewStatus: item.originalReviewStatus,
    originalSourceCheckStatus: item.originalSourceCheckStatus,
    targetVersion: 1 as const,
    targetReviewStatus: "unreviewed" as const,
    targetSourceCheckStatus: "unchecked" as const,
    targetSourceExcerptMatch: null,
    restoreLatestCheck: false as const,
  }));

  return {
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    claims,
    evidence,
    historicalContext: {
      sourceChecks: payload.sourceChecks.length,
      attachmentChecks: payload.attachmentChecks.length,
      reviews: payload.reviews.length,
      reviewEvidenceRelationships: payload.reviewEvidence.length,
    },
    downgraded: {
      claimTrustStates: claims.filter(
        (claim) => claim.originalStatus !== claim.targetStatus,
      ).length,
      claimSourceVersions: claims.length,
      evidenceVersions: evidence.filter(
        (item) => item.originalVersion !== item.targetVersion,
      ).length,
      evidenceReviewStates: payload.evidence.filter(
        (item) => item.originalReviewStatus !== "unreviewed",
      ).length,
      evidenceCheckStates: payload.evidence.filter(
        (item) => item.originalSourceCheckStatus !== "unchecked",
      ).length,
      reviews: payload.reviews.length,
    },
  };
}
