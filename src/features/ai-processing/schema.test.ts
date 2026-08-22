import { describe, expect, it } from "vitest";

import {
  auditClaimSchema,
  claimAIAuditPayloadSchema,
  aiSuggestionPayloadSchema,
  organizeCaptureSchema,
  testCCSwitchCodexOAuthSchema,
} from "./schema";

describe("claimAIAuditPayloadSchema", () => {
  it("accepts a bounded evidence audit instead of a truth verdict", () => {
    const result = claimAIAuditPayloadSchema.safeParse({
      summary: "现有证据覆盖有限，需要交叉核对。",
      evidence_coverage: "limited",
      evidence_balance: "one_sided",
      findings: [
        {
          category: "coverage_gap",
          severity: "medium",
          message: "只有一个来源。",
          evidence_ids: ["d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a"],
        },
      ],
      missing_checks: ["补充独立来源。"],
      recommended_assessment: "needs_more_evidence",
      boundary_notice: "这不是事实裁决。",
    });

    expect(result.success).toBe(true);
  });

  it("applies the same provider boundary to claim audits", () => {
    const result = auditClaimSchema.safeParse({
      claimId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      provider: "deepseek",
      connection: {
        mode: "ccswitch_codex_oauth",
        baseURL: "http://host.docker.internal:15721/v1",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("aiSuggestionPayloadSchema", () => {
  it("accepts a traceable structured suggestion", () => {
    const result = aiSuggestionPayloadSchema.safeParse({
      suggested_title: "AI 知识库",
      summary: "整理散碎知识输入。",
      content_type: "thought_fragment",
      existing_category_candidates: [],
      new_category_candidates: [
        { name: "知识管理", reason: "原文主题", confidence: 0.8 },
      ],
      semantic_units: [
        {
          type: "goal",
          content: "整理散碎知识输入",
          source_excerpt: "整理散碎知识输入",
          confidence: 0.9,
        },
      ],
      open_questions: ["如何确认可靠性？"],
      quality_flags: [],
    });

    expect(result.success).toBe(true);
  });

  it("rejects out-of-range confidence", () => {
    const result = aiSuggestionPayloadSchema.safeParse({
      suggested_title: "标题",
      summary: "摘要",
      content_type: "unknown",
      existing_category_candidates: [],
      new_category_candidates: [],
      semantic_units: [
        {
          type: "claim",
          content: "内容",
          source_excerpt: "内容",
          confidence: 1.2,
        },
      ],
      open_questions: [],
      quality_flags: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts UI-provided API credentials without persisting them in the suggestion schema", () => {
    const result = organizeCaptureSchema.safeParse({
      captureId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      expectedCaptureVersion: 1,
      provider: "deepseek",
      connection: {
        mode: "api_key",
        apiKey: "sk-test-only-credential",
        model: "deepseek-v4-flash",
      },
    });

    expect(result.success).toBe(true);
  });

  it("only allows CC-Switch for the OpenAI provider", () => {
    const result = organizeCaptureSchema.safeParse({
      captureId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      expectedCaptureVersion: 1,
      provider: "deepseek",
      connection: {
        mode: "ccswitch",
        baseURL: "http://host.docker.internal:15721/v1",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts the CC-Switch Claude to Codex OAuth route", () => {
    const result = organizeCaptureSchema.safeParse({
      captureId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      expectedCaptureVersion: 1,
      provider: "openai",
      connection: {
        mode: "ccswitch_codex_oauth",
        baseURL: "http://host.docker.internal:15721/v1",
        model: "claude-sonnet-4-5",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a GPT model ID on the Claude to Codex OAuth route", () => {
    const result = organizeCaptureSchema.safeParse({
      captureId: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      expectedCaptureVersion: 1,
      provider: "openai",
      connection: {
        mode: "ccswitch_codex_oauth",
        baseURL: "http://host.docker.internal:15721/v1",
        model: "gpt-5.6-sol",
      },
    });

    expect(result.success).toBe(false);
  });

  it("validates the lightweight CC-Switch connection test", () => {
    expect(
      testCCSwitchCodexOAuthSchema.safeParse({
        baseURL: "http://host.docker.internal:15721/v1",
        model: "claude-sonnet-4-5",
      }).success,
    ).toBe(true);
    expect(
      testCCSwitchCodexOAuthSchema.safeParse({
        baseURL: "http://host.docker.internal:15721/v1",
        model: "gpt-5.6-sol",
      }).success,
    ).toBe(false);
  });
});
