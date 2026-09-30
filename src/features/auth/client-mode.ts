/**
 * 原生客户端判定的**同构**工具。
 *
 * 这个文件被两侧共用：`src/proxy.ts`（服务端/代理）用它与路由处理器共用判定，
 * 客户端与浏览器侧也读 `X-Client`。因此它**不能**加 `"use client"` ——
 * 加了之后 Next 会把导出标记为 client reference，服务端调用会抛
 * 「Attempted to call ... from the server but ... is on the client」。
 *
 * 2026-09-30 踩过：一旦带上该指令，proxy 对**每一个请求**抛错，
 * 表现为 `/api/metrics` 返回 500、全部 `knowtrace_*` 业务指标消失，
 * 而 `/api/health/ready` 仍正常——监控整体静默失效。
 * 这里没有 React、没有浏览器 API、没有副作用，纯函数，不需要任何指令。
 */

export const ACCESS_TOKEN_HEADER = "x-knowtrace-access-token";
export const WORKSPACE_ID_HEADER = "x-knowtrace-workspace-id";

export function isNativeClientRequest(request: Request): boolean {
  return request.headers.get("x-client")?.trim().toLowerCase() === "native";
}

export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token.length ? token : null;
}
