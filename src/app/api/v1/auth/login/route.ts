import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  isAuthEnabled,
  loginWithGoUserSystem,
} from "@/features/auth/go-user-system";
import { setSessionCookies } from "@/features/auth/response";
import { AUTH_ERROR_CODES, classifyAuthError } from "@/features/auth/auth-errors";
import { bearerTokenFrom, isNativeClientRequest } from "@/features/auth/client-mode";

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(72),
});

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "AUTH_DISABLED", message: "登录功能尚未启用。" },
      },
      { status: 404 },
    );
  }
  const parsed = credentialsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "请输入用户名和密码。",
        },
      },
      { status: 400 },
    );
  }

  // 把真实客户端 IP 传给认证服务，供其登录限流按来源计数。
  //
  // 为什么取 x-forwarded-for：nginx 会用 `$remote_addr` **覆盖**该头
  // （见 deploy/nginx/knowtrace-vps.conf），而 `$remote_addr` 已被 Caddy 的
  // real_ip_header 还原为真实客户端。所以到这里这个值是可采信的——
  // 外部伪造的 XFF 到不了这里。
  //
  // 不传的后果见 docs/19 D-08：认证服务只能看到应用容器地址，
  // 所有用户共用一个限流桶，任一来源失败 20 次会让全站登不进去。
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null;

  const result = await loginWithGoUserSystem(parsed.data, clientIp);
  if (!result.ok) {
    // 保留上游状态码，但把上游数字业务码翻译成客户端可区分的语义错误码。
    // 直接把上游码透传会让限流、停用和密码错误在客户端无法分辨（BUG-002）。
    const classified = classifyAuthError(
      result.code,
      result.status,
      result.retryAfterSeconds,
    );
    const headers = new Headers();
    // 把上游的 Retry-After 原样透传：浏览器/客户端可据此自行退避，
    // 而不是靠读我们拼出来的文案去猜。
    if (result.retryAfterSeconds && result.retryAfterSeconds > 0) {
      headers.set("Retry-After", String(result.retryAfterSeconds));
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: classified.code,
          message: classified.message,
          // 结构化地给出剩余秒数，前端做倒计时不必解析文案
          ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
        },
      },
      { status: result.status, headers },
    );
  }
  if (!result.refreshToken) {
    return NextResponse.json(
      { ok: false, error: { code: AUTH_ERROR_CODES.contractInvalid, message: "登录服务没有返回刷新会话。" } },
      { status: 502 },
    );
  }

  // 原生客户端带 X-Client: native 时改用 Bearer 令牌：原生 App 没有浏览器 Cookie 罐，
  // Set-Cookie 无法可靠持久化。已携带 Bearer 的请求按刷新语义处理，仍只发 Cookie。
  const useBearerTokens =
    isNativeClientRequest(request) && bearerTokenFrom(request) === null;

  const response = NextResponse.json({
    ok: true,
    data: useBearerTokens
      ? {
          user: result.data.user,
          tokenType: "Bearer" as const,
          accessToken: result.data.access_token,
          expiresIn: result.data.access_token_expires_in,
          refreshToken: result.refreshToken,
          refreshTokenExpiresIn: result.data.refresh_token_expires_in,
        }
      : { user: result.data.user },
  });
  setSessionCookies(response, result.data, result.refreshToken);
  return response;
}
