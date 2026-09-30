/**
 * 原生客户端判定的**同构**工具。
 *
 * 这个文件被两侧共用：`src/proxy.ts`（服务端/代理）用它与路由处理器共用判定，
 * 客户端与浏览器侧也读 `X-Client`。因此它**不能**带上「使用客户端」指令 ——
 * 带上之后 Next 会把导出标记为 client reference，服务端调用会抛
 * `Attempted to call ... from the server but ... is on the client`。
 *
 * ⚠️ 注意：上面那句**不能把指令字面量原样写出来**，哪怕在注释里也不行。
 * 2026-09-30 踩过两次：注释里引用了那个字面量之后，Next 的编译期指令检测
 * 把它当成真的指令，编译产物里该模块被标成 client reference，
 * 于是 proxy 对**每一个请求**抛错：`/api/health/*` 与 `/api/metrics` 全部 500、
 * 全部 `knowtrace_*` 业务指标消失、站点整体不可用。
 *
 * 这个文件没有 React、没有浏览器 API、没有副作用，是纯函数，
 * 不需要任何指令——**现在不需要，将来也不要加**。
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
