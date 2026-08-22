import { sha256, stableStringify } from "@/shared/hash";

import {
  TOPIC_SYNTHESIS_BOUNDARY_NOTICE,
  topicSynthesisPayloadSchema,
  type TopicSynthesisPayload,
} from "./schema";

export type TopicSourceSnapshot = {
  captures: Array<{
    id: string;
    title: string | null;
    subject: string | null;
    content: string;
    contentType: string;
    occurredAt: string;
    version: number;
  }>;
  claims: Array<{
    id: string;
    captureId: string;
    statement: string;
    status: string;
    falsificationCriteria: string;
    latestReview: null | {
      assessment: "supported" | "refuted" | "inconclusive";
      rationale: string;
      limitations: string | null;
      reviewNumber: number;
    };
    trustedEvidenceCount: number;
  }>;
  truncated: boolean;
};

export function topicSourceHash(snapshot: TopicSourceSnapshot): string {
  return sha256(stableStringify(snapshot));
}

export function sanitizeTopicSynthesisPayload(
  payload: TopicSynthesisPayload,
  snapshot: TopicSourceSnapshot,
): TopicSynthesisPayload {
  const captureById = new Map(snapshot.captures.map((capture) => [capture.id, capture]));
  const claimById = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
  const safeCaptureIds = (ids: string[]) => ids.filter((id) => captureById.has(id));
  const safeClaimIds = (ids: string[]) => ids.filter((id) => claimById.has(id));

  return topicSynthesisPayloadSchema.parse({
    ...payload,
    established_points: payload.established_points.flatMap((point) => {
      const source_capture_ids = safeCaptureIds(point.source_capture_ids);
      const claim_ids = safeClaimIds(point.claim_ids);
      if (!source_capture_ids.length && !claim_ids.length) return [];
      const support_basis = claim_ids.some((id) => claimById.get(id)?.latestReview)
        ? "human_review"
        : claim_ids.length
          ? "candidate_claim"
          : "raw_record";
      return [{ ...point, source_capture_ids, claim_ids, support_basis }];
    }),
    tensions: payload.tensions.flatMap((tension) => {
      const source_capture_ids = safeCaptureIds(tension.source_capture_ids);
      const claim_ids = safeClaimIds(tension.claim_ids);
      return source_capture_ids.length || claim_ids.length
        ? [{ ...tension, source_capture_ids, claim_ids }]
        : [];
    }),
    chronology: payload.chronology.flatMap((item) => {
      const source_capture_ids = safeCaptureIds(item.source_capture_ids);
      if (!source_capture_ids.length) return [];
      const occurredAt = captureById.get(source_capture_ids[0])!.occurredAt;
      return [{ ...item, occurred_at: occurredAt, source_capture_ids }];
    }).sort((left, right) => left.occurred_at.localeCompare(right.occurred_at)),
    boundary_notice: TOPIC_SYNTHESIS_BOUNDARY_NOTICE,
  });
}
