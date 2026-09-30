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

  const result = await loginWithGoUserSystem(parsed.data);
  if (!result.ok) {
    // 保留上游状态码，但把上游数字业务码翻译成客户端可区分的语义错误码。
    // 直接把上游码透传会让限流、停用和密码错误在客户端无法分辨（BUG-002）。
    const classified = classifyAuthError(result.code, result.status);
    return NextResponse.json(
      { ok: false, error: { code: classified.code, message: classified.message } },
      { status: result.status },
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
