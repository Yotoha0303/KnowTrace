import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { z } from "zod";

import {
  ccSwitchHealthURL,
  ccSwitchModelsURL,
  ccSwitchStatusURL,
  firstCCSwitchModelId,
  normalizeCCSwitchBaseURL,
  parseCCSwitchProviderStatus,
  supportsCCSwitchDirectMessages,
  type CCSwitchProviderStatus,
} from "./connection";
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

export type CCSwitchResolvedRoute = {
  target: CCSwitchProviderStatus | null;
  protocol: "openai_responses" | "anthropic_messages";
  model: string;
};

export async function getCCSwitchActiveTarget(
  input: Pick<DetectInput, "baseURL">,
): Promise<CCSwitchProviderStatus | null> {
  try {
    const response = await fetch(ccSwitchStatusURL(input.baseURL), {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return parseCCSwitchProviderStatus(await response.json());
  } catch {
    return null;
  }
}

async function getCCSwitchCodexModel(baseURL: string): Promise<string | null> {
  try {
    const response = await fetch(ccSwitchModelsURL(baseURL), {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    return firstCCSwitchModelId(await response.json());
  } catch {
    return null;
  }
}

function defaultModelForCCSwitchProvider(providerName: string): string | null {
  return /deepseek/i.test(providerName) ? "deepseek-v4-flash" : null;
}

export async function resolveCCSwitchRoute(input: {
  baseURL: string;
  model: string;
}): Promise<CCSwitchResolvedRoute> {
  const target = await getCCSwitchActiveTarget(input);
  const requestedModel = input.model.trim();

  if (target?.appType === "codex") {
    const model =
      !requestedModel || requestedModel.startsWith("claude-")
        ? (await getCCSwitchCodexModel(input.baseURL)) ??
          defaultModelForCCSwitchProvider(target.providerName)
        : requestedModel;
    if (!model) {
      throw new AppError(
        "AI_CC_SWITCH_MODEL_UNRESOLVED",
        `已识别当前供应商为 ${target.providerName}，但 CC-Switch 未提供可用模型目录。请在 KnowTrace 高级设置中填写该供应商的模型 ID 后重试。`,
      );
    }
    return { target, protocol: "openai_responses", model };
  }

  if (target && !target.routeActive && supportsCCSwitchDirectMessages(target.providerName)) {
    const deepSeekDefault = defaultModelForCCSwitchProvider(target.providerName);
    return {
      target,
      protocol: "anthropic_messages",
      model:
        deepSeekDefault && (!requestedModel || requestedModel.startsWith("claude-"))
          ? deepSeekDefault
          : requestedModel || "claude-sonnet-4-5",
    };
  }

  if (target && !target.routeActive) {
    throw new AppError(
      "AI_CC_SWITCH_ROUTE_TARGET_INACTIVE",
      `已识别 CC-Switch 当前供应商为 ${target.providerName}，但尚未发现可安全使用的代理协议。请在 CC-Switch“路由”页启用对应应用路由，或在 KnowTrace 高级设置中明确配置模型后重试。`,
    );
  }

  return {
    target,
    protocol: "anthropic_messages",
    model: requestedModel || "claude-sonnet-4-5",
  };
}

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
    const dockerHint = healthURL.includes("host.docker.internal")
      ? " KnowTrace 当前通过 Docker 访问宿主机；CC-Switch 默认只监听 127.0.0.1，Docker 无法访问该回环地址。请在 CC-Switch 的“路由”页先停止路由总开关，将监听地址改为 0.0.0.0、端口保持 15721，保存后重新开启路由总开关。"
      : " 请确认 CC-Switch 已启动，并在设置中开启本地代理。";
    throw new AppError(
      "AI_CC_SWITCH_UNREACHABLE",
      `未检测到 CC-Switch。${dockerHint}`,
    );
  }

  if (!response.ok) {
    throw new AppError(
      "AI_CC_SWITCH_UNHEALTHY",
      `CC-Switch 已响应，但健康检查返回 ${response.status}。请重启 CC-Switch 后再试。`,
    );
  }

  const target = await getCCSwitchActiveTarget(input);
  return {
    reachable: true as const,
    latencyMs: Date.now() - startedAt,
    activeProvider: target?.providerName ?? null,
    activeAppType: target?.appType ?? null,
    routeActive: target?.routeActive ?? false,
    directMessagesCompatible:
      Boolean(
        target &&
          !target.routeActive &&
          supportsCCSwitchDirectMessages(target.providerName),
      ),
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
      "CC-Switch 已连接，但当前供应商无法识别该模型。请检查 CC-Switch 的模型映射后重试。",
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
  const route = await resolveCCSwitchRoute(input);

  try {
    const model =
      route.protocol === "openai_responses"
        ? createOpenAI({
            apiKey: input.apiKey || "cc-switch-local",
            baseURL,
          }).responses(route.model)
        : createAnthropic({
            apiKey: input.apiKey || "cc-switch-local",
            baseURL,
          }).messages(route.model);

    const disableDeepSeekThinking =
      route.protocol === "anthropic_messages" &&
      /deepseek/i.test(route.target?.providerName ?? "");
    const result = await generateText({
      model,
      maxOutputTokens: 128,
      timeout: 30_000,
      providerOptions: disableDeepSeekThinking
        ? {
            anthropic: {
              thinking: { type: "disabled" },
            },
          }
        : undefined,
      system: "只返回原始 JSON，不要使用 Markdown 代码块或补充说明。",
      prompt: '返回 {"ok":true}，字段和值必须完全一致。',
    });

    parseStructuredAIText(result.text, connectionResultSchema);

    return {
      connected: true as const,
      providerName: route.target?.providerName ?? null,
      appType: route.target?.appType ?? null,
      protocol: route.protocol,
      requestedModel: input.model,
      routedModel: route.model,
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
