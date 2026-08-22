import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

import { ccSwitchHealthURL, normalizeCCSwitchBaseURL } from "./connection";
import type {
  detectCCSwitchSchema,
  testCCSwitchCodexOAuthSchema,
} from "./schema";
import { AppError } from "@/shared/errors/app-error";
import type { z } from "zod";

type DetectInput = z.infer<typeof detectCCSwitchSchema>;
type TestInput = z.infer<typeof testCCSwitchCodexOAuthSchema>;

export async function detectCCSwitch(input: DetectInput) {
  const startedAt = Date.now();
  const healthURL = ccSwitchHealthURL(input.baseURL);
  let response: Response;

  try {
    response = await fetch(healthURL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(
      "AI_CC_SWITCH_UNREACHABLE",
      "未检测到 CC-Switch。请先启动 CC-Switch，并在设置中开启本地代理。",
    );
  }

  if (!response.ok) {
    throw new AppError(
      "AI_CC_SWITCH_UNHEALTHY",
      `CC-Switch 已响应，但健康检查返回 ${response.status}。请重启 CC-Switch 后再试。`,
    );
  }

  return {
    reachable: true as const,
    latencyMs: Date.now() - startedAt,
  };
}

function connectionTestError(error: unknown): AppError {
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|unauthorized|forbidden|oauth|login|token/i.test(message)) {
    return new AppError(
      "AI_CC_SWITCH_CODEX_AUTH_INVALID",
      "CC-Switch 已启动，但 Codex 登录不可用。请在 CC-Switch 中重新登录 Codex。",
    );
  }
  if (/model.+not supported|模型.+不支持|unsupported.+model/i.test(message)) {
    return new AppError(
      "AI_CC_SWITCH_MODEL_UNSUPPORTED",
      "CC-Switch 已连接，但模型映射不可用。请恢复默认 Claude 路由模型后重试。",
    );
  }
  if (/base_url|base url/i.test(message)) {
    return new AppError(
      "AI_CC_SWITCH_ROUTE_MISCONFIGURED",
      "CC-Switch 路由缺少上游地址。请选择 Codex OAuth（Claude 路由），不要选择 OpenAI Responses 路由。",
    );
  }
  return new AppError(
    "AI_CC_SWITCH_TEST_FAILED",
    "已找到 CC-Switch，但 AI 测试失败。请检查 CC-Switch 中的 Codex 登录和当前提供方。",
  );
}

export async function testCCSwitchCodexOAuth(input: TestInput) {
  await detectCCSwitch(input);
  const startedAt = Date.now();
  const baseURL = normalizeCCSwitchBaseURL(input.baseURL);

  try {
    const result = await generateText({
      model: createAnthropic({
        apiKey: input.apiKey || "cc-switch-local",
        baseURL,
      }).messages(input.model),
      maxOutputTokens: 8,
      timeout: 30_000,
      prompt: "Reply with exactly OK.",
    });

    if (!result.text.trim()) {
      throw new Error("CC-Switch returned an empty model response.");
    }

    return {
      connected: true as const,
      requestedModel: input.model,
      actualModel: result.response.modelId,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw connectionTestError(error);
  }
}
