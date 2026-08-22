import { describe, expect, it } from "vitest";

import {
  assessmentHasRequiredStance,
  canTransitionClaim,
  hasConfirmedEvidenceSource,
  hasRequiredEvidenceForReview,
} from "./state";

describe("claim state machine", () => {
  it("allows only explicit forward, return, and withdrawal transitions", () => {
    expect(canTransitionClaim("candidate", "investigating")).toBe(true);
    expect(canTransitionClaim("investigating", "ready_for_review")).toBe(true);
    expect(canTransitionClaim("ready_for_review", "investigating")).toBe(true);
    expect(canTransitionClaim("concluded", "investigating")).toBe(true);
    expect(canTransitionClaim("candidate", "ready_for_review")).toBe(false);
    expect(canTransitionClaim("ready_for_review", "concluded")).toBe(false);
    expect(canTransitionClaim("withdrawn", "investigating")).toBe(false);
  });

  it("requires at least one accepted evidence item before review", () => {
    expect(hasRequiredEvidenceForReview(0)).toBe(false);
    expect(hasRequiredEvidenceForReview(1)).toBe(true);
    expect(hasRequiredEvidenceForReview(3)).toBe(true);
    expect(hasRequiredEvidenceForReview(-1)).toBe(false);
    expect(hasRequiredEvidenceForReview(1.5)).toBe(false);
  });

  it("accepts evidence only after a matched source check", () => {
    expect(
      hasConfirmedEvidenceSource({
        status: "passed",
        excerptMatch: true,
        latestCheckId: "check-id",
      }),
    ).toBe(true);
    expect(
      hasConfirmedEvidenceSource({
        status: "unchecked",
        excerptMatch: null,
        latestCheckId: null,
      }),
    ).toBe(false);
    expect(
      hasConfirmedEvidenceSource({
        status: "passed",
        excerptMatch: false,
        latestCheckId: "check-id",
      }),
    ).toBe(false);
  });

  it("requires an assessment-compatible evidence stance", () => {
    expect(assessmentHasRequiredStance("supported", ["supports"])).toBe(true);
    expect(assessmentHasRequiredStance("supported", ["context"])).toBe(false);
    expect(assessmentHasRequiredStance("refuted", ["contradicts"])).toBe(true);
    expect(assessmentHasRequiredStance("refuted", ["supports"])).toBe(false);
    expect(assessmentHasRequiredStance("inconclusive", ["context"])).toBe(true);
    expect(assessmentHasRequiredStance("inconclusive", [])).toBe(false);
  });
});
