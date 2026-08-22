import type { ClaimStatus } from "./schema";

const ALLOWED_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  candidate: ["investigating", "withdrawn"],
  investigating: ["ready_for_review", "withdrawn"],
  ready_for_review: ["investigating", "withdrawn"],
  concluded: ["investigating", "withdrawn"],
  withdrawn: [],
};

export function canTransitionClaim(
  current: ClaimStatus,
  target: ClaimStatus,
): boolean {
  return ALLOWED_TRANSITIONS[current].includes(target);
}

export function hasRequiredEvidenceForReview(
  acceptedEvidenceCount: number,
): boolean {
  return Number.isInteger(acceptedEvidenceCount) && acceptedEvidenceCount > 0;
}

export function hasConfirmedEvidenceSource(input: {
  status: "unchecked" | "passed" | "failed";
  excerptMatch: boolean | null;
  latestCheckId: string | null;
}): boolean {
  return (
    input.status === "passed" &&
    input.excerptMatch === true &&
    Boolean(input.latestCheckId)
  );
}

export function assessmentHasRequiredStance(
  assessment: "supported" | "refuted" | "inconclusive",
  stances: ReadonlyArray<"supports" | "contradicts" | "context">,
): boolean {
  if (!stances.length) return false;
  if (assessment === "supported") return stances.includes("supports");
  if (assessment === "refuted") return stances.includes("contradicts");
  return true;
}
