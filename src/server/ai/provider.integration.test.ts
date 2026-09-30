import "server-only";

import { describe, expect, it } from "vitest";

import { organizeWithAI } from "./provider";
import { aiSuggestionPayloadSchema } from "@/features/ai-processing/schema";
import type { CaptureRow, CategoryRow } from "@/server/db/schema";

/**
 * 真实提供方集成测试。
 *
 * 默认跳过；只有显式提供 DEEPSEEK_API_KEY 时才执行。用于回答一个自动化单测
 * 无法回答的问题：真实模型在 `supportsStructuredOutputs: false` 的
 * createOpenAICompatible + `Output.object` 组合下，能否稳定返回满足 schema 的 JSON。
 *
 * 这不是理论问题——2026-09-30 的线上数据里，真实模型 16 次调用只成功 2 次，
 * 而 mock 3 次全成功。本地单测永远发现不了这一类失败。
 *
 * 运行：
 *   $env:DEEPSEEK_API_KEY='sk-...'; pnpm exec vitest run src/server/ai/provider.integration.test.ts
 *
 * 成本：单次调用约 500–1500 token，可忽略。
 */

const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";

const capture = {
  id: "00000000-0000-4000-8000-000000000000",
  title: null,
  content:
    "今天下午跟某公司的采购聊了半小时，他们说下季度的预算可能会砍掉一半，因为总部在压缩成本。" +
    "这跟上个月他们技术负责人说的完全不一样，那次他说预算会增加。我怀疑其中一方信息滞后，但没法确认。",
  contentType: "observation",
} as unknown as CaptureRow;

const categories: CategoryRow[] = [];

describe.skipIf(!apiKey)("real AI provider integration", () => {
  it("returns schema-valid structured output from the configured provider", async () => {
    const startedAt = Date.now();
    const result = await organizeWithAI({
      capture,
      categories,
      provider: "deepseek",
      connection: { mode: "server", model },
    });
    const latencyMs = Date.now() - startedAt;

    // 1. 返回值必须通过同一个 schema，provider.ts 内部已校验；这里再断言一次语义字段。
    const parsed = aiSuggestionPayloadSchema.safeParse(result.payload);
    expect(parsed.success).toBe(true);

    // 2. source_excerpt 必须逐字出现在原文中，这是系统的核心约束
    //    （"semantic_units.source_excerpt 必须逐字出现在原文中，不能编造事实"）。
    for (const unit of result.payload.semantic_units) {
      expect(capture.content).toContain(unit.source_excerpt);
    }
    for (const suggestion of result.payload.content_suggestions) {
      expect(capture.content).toContain(suggestion.source_excerpt);
    }

    // 3. 应当产出可读的标题与摘要，而不是空串或原文截断。
    expect(result.payload.suggested_title.length).toBeGreaterThan(0);
    expect(result.payload.summary.length).toBeGreaterThan(0);

    // 4. 记录真实耗时与用量，用于和线上 ai_processing_runs 对比。
    console.log(
      `[integration] provider=${result.provider} model=${result.model} ` +
        `latency=${latencyMs}ms in=${result.inputTokens} out=${result.outputTokens} ` +
        `title=${JSON.stringify(result.payload.suggested_title)}`,
    );

    // 移动端与 Web 都依赖这个上限；真实模型常见失败是超时或返回非 JSON。
    expect(latencyMs).toBeLessThan(90_000);
  }, 120_000);
});
