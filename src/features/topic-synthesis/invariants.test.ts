import { describe, expect, it } from "vitest";

import {
  sanitizeTopicSynthesisPayload,
  topicSourceHash,
  type TopicSourceSnapshot,
} from "./invariants";

const captureId = "11111111-1111-4111-8111-111111111111";
const claimId = "22222222-2222-4222-8222-222222222222";
const unknownId = "33333333-3333-4333-8333-333333333333";

const snapshot: TopicSourceSnapshot = {
  captures: [{
    id: captureId,
    title: "记录",
    subject: "对象",
    content: "内容",
    contentType: "observation",
    occurredAt: "2026-08-20T00:00:00.000Z",
    version: 2,
  }],
  claims: [{
    id: claimId,
    captureId,
    statement: "可证伪主张",
    status: "concluded",
    falsificationCriteria: "出现反例",
    latestReview: {
      assessment: "supported",
      rationale: "当前证据支持",
      limitations: "样本有限",
      reviewNumber: 1,
    },
    trustedEvidenceCount: 2,
  }],
  truncated: false,
};

describe("topic synthesis invariants", () => {
  it("removes invented source ids and derives support level from project data", () => {
    const result = sanitizeTopicSynthesisPayload({
      overview: "概览",
      established_points: [{
        text: "要点",
        source_capture_ids: [captureId, unknownId],
        claim_ids: [claimId, unknownId],
        support_basis: "raw_record",
      }],
      tensions: [{
        text: "伪造引用应被删除",
        source_capture_ids: [unknownId],
        claim_ids: [],
      }],
      chronology: [{
        occurred_at: "2030-01-01T00:00:00.000Z",
        text: "时间必须来自记录",
        source_capture_ids: [captureId],
      }],
      open_questions: [],
      next_steps: [],
      boundary_notice: "模型越权文本",
    }, snapshot);

    expect(result.established_points[0]).toMatchObject({
      source_capture_ids: [captureId],
      claim_ids: [claimId],
      support_basis: "human_review",
    });
    expect(result.tensions).toEqual([]);
    expect(result.chronology[0]?.occurred_at).toBe(snapshot.captures[0].occurredAt);
    expect(result.boundary_notice).toContain("不会联网补证");
  });

  it("changes the source hash when a source version changes", () => {
    const changed = structuredClone(snapshot);
    changed.captures[0].version += 1;
    expect(topicSourceHash(changed)).not.toBe(topicSourceHash(snapshot));
    expect(topicSourceHash(snapshot)).toBe(topicSourceHash(structuredClone(snapshot)));
  });
});
