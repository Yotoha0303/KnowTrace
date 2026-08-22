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
