import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";

import { ccSwitchHealthURL, normalizeCCSwitchBaseURL } from "./connection";
import type {
  detectCCSwitchSchema,
  testCCSwitchCurrentProviderSchema,
  testCCSwitchCodexOAuthSchema,
} from "./schema";
import { parseStructuredAIText } from "./structured-output";
import { AppError } from "@/shared/errors/app-error";

type DetectInput = z.infer<typeof detectCCSwitchSchema>;
type TestInput = z.infer<typeof testCCSwitchCodexOAuthSchema>;
type CurrentProviderTestInput = z.infer<typeof testCCSwitchCurrentProviderSchema>;

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
      "AI_CC_SWITCH_AUTH_INVALID",
      "CC-Switch 已启动，但当前供应商的凭据不可用。请在 CC-Switch 中重新登录或检查 API Key。",
    );
  }
  if (/model.+not supported|模型.+不支持|unsupported.+model/i.test(message)) {
    return new AppError(
      "AI_CC_SWITCH_MODEL_UNSUPPORTED",
      "CC-Switch 已连接，但当前供应商无法识别该模型路由名。请检查 CC-Switch 的模型映射后重试。",
    );
  }
  if (/base_url|base url/i.test(message)) {
    return new AppError(
      "AI_CC_SWITCH_ROUTE_MISCONFIGURED",
      "CC-Switch 当前供应商缺少上游地址。请在 CC-Switch 中检查该供应商的 API 地址和格式。",
    );
  }
  return new AppError(
    "AI_CC_SWITCH_TEST_FAILED",
    "已找到 CC-Switch，但当前供应商未通过结构化输出测试。请检查凭据、模型映射和 API 格式。",
  );
}

const connectionResultSchema = z.object({ ok: z.literal(true) });

export async function testCCSwitchCurrentProvider(input: CurrentProviderTestInput) {
  await detectCCSwitch(input);
  const startedAt = Date.now();
  const baseURL = normalizeCCSwitchBaseURL(input.baseURL);

  try {
    const result = await generateText({
      model: createAnthropic({
        apiKey: input.apiKey || "cc-switch-local",
        baseURL,
      }).messages(input.model),
      maxOutputTokens: 32,
      timeout: 30_000,
      system: "只返回原始 JSON，不要使用 Markdown 代码块或补充说明。",
      prompt: '返回 {"ok":true}，字段和值必须完全一致。',
    });

    parseStructuredAIText(result.text, connectionResultSchema);

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

export async function testCCSwitchCodexOAuth(input: TestInput) {
  return testCCSwitchCurrentProvider(input);
}
