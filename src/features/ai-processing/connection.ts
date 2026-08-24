import { AppError } from "@/shared/errors/app-error";

const LOCAL_CC_SWITCH_HOSTS = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
  "host.docker.internal",
]);

export const DEFAULT_CC_SWITCH_BASE_URL =
  "http://host.docker.internal:15721/v1";

export function normalizeCCSwitchBaseURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "AI_CC_SWITCH_URL_INVALID",
      "CC-Switch 地址格式无效。",
    );
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !LOCAL_CC_SWITCH_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      "AI_CC_SWITCH_URL_NOT_ALLOWED",
      "CC-Switch 仅允许使用本机 HTTP(S) 地址，且不能包含账号、查询参数或锚点。",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "/v1") {
    throw new AppError(
      "AI_CC_SWITCH_PATH_INVALID",
      "CC-Switch 地址应填写服务根地址或 /v1 地址。",
    );
  }

  url.pathname = "/v1";
  return url.toString().replace(/\/$/, "");
}

export function ccSwitchHealthURL(value: string): string {
  const url = new URL(normalizeCCSwitchBaseURL(value));
  url.pathname = "/health";
  return url.toString();
}

export function ccSwitchStatusURL(value: string): string {
  const url = new URL(normalizeCCSwitchBaseURL(value));
  url.pathname = "/status";
  return url.toString();
}

export function ccSwitchModelsURL(value: string): string {
  const url = new URL(normalizeCCSwitchBaseURL(value));
  url.pathname = "/v1/models";
  return url.toString();
}

export type CCSwitchProviderStatus = {
  appType: "codex" | "claude" | null;
  providerId: string;
  providerName: string;
  routeActive: boolean;
};

export function supportsCCSwitchDirectMessages(providerName: string): boolean {
  return /deepseek|codex/i.test(providerName.trim());
}

export function parseCCSwitchProviderStatus(
  value: unknown,
): CCSwitchProviderStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const activeTargets = Array.isArray(record.active_targets)
    ? record.active_targets
    : [];

  for (const preferredType of ["codex", "claude"] as const) {
    const target = activeTargets.find((item) => {
      if (!item || typeof item !== "object") return false;
      return (item as Record<string, unknown>).app_type === preferredType;
    });
    if (!target || typeof target !== "object") continue;
    const targetRecord = target as Record<string, unknown>;
    const providerName =
      typeof targetRecord.provider_name === "string"
        ? targetRecord.provider_name.trim()
        : "";
    if (!providerName) continue;
    return {
      appType: preferredType,
      providerId:
        typeof targetRecord.provider_id === "string"
          ? targetRecord.provider_id.trim()
          : "",
      providerName,
      routeActive: true,
    };
  }

  const providerName =
    typeof record.current_provider === "string"
      ? record.current_provider.trim()
      : "";
  if (!providerName) return null;
  return {
    appType: null,
    providerId:
      typeof record.current_provider_id === "string"
        ? record.current_provider_id.trim()
        : "",
    providerName,
    routeActive: false,
  };
}

export function firstCCSwitchModelId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const models = Array.isArray(record.models) ? record.models : [];
  for (const item of models) {
    if (!item || typeof item !== "object") continue;
    const model = item as Record<string, unknown>;
    if (typeof model.model === "string" && model.model.trim()) {
      return model.model.trim();
    }
    if (typeof model.slug === "string" && model.slug.trim()) {
      return model.slug.trim();
    }
  }

  const data = Array.isArray(record.data) ? record.data : [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const model = item as Record<string, unknown>;
    if (typeof model.id === "string" && model.id.trim()) {
      return model.id.trim();
    }
  }

  return null;
}
