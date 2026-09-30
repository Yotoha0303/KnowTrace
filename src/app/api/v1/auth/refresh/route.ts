import { NextRequest, NextResponse } from "next/server";

import {
  isAuthEnabled,
  refreshWithGoUserSystem,
  REFRESH_TOKEN_COOKIE,
} from "@/features/auth/go-user-system";
import { clearSessionCookies, setSessionCookies } from "@/features/auth/response";
import { AUTH_ERROR_CODES, classifyAuthError } from "@/features/auth/auth-errors";
import { bearerTokenFrom, isNativeClientRequest } from "@/features/auth/client-mode";

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

  const native = isNativeClientRequest(request);
  const accessToken = bearerTokenFrom(request);
  const refreshToken = native
    ? accessToken
    : (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value ?? null);
  if (!refreshToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          native && accessToken
            ? {
                code: AUTH_ERROR_CODES.sessionExpired,
                message: "登录会话已过期，请重新登录。",
              }
            : {
                code: AUTH_ERROR_CODES.required,
                message: "没有可恢复的登录会话。",
              },
      },
      { status: 401 },
    );
  }

  const result = await refreshWithGoUserSystem(refreshToken);
  if (!result.ok || !result.refreshToken) {
    // `result.code` 是上游业务码；refresh 场景统一翻译为会话失效/服务不可用，不再原样透传。
    const classified = classifyAuthError(result.ok ? null : result.code, result.ok ? 502 : result.status);
    const response = NextResponse.json(
      {
        ok: false,
        error: {
          code: result.ok ? AUTH_ERROR_CODES.contractInvalid : classified.code,
          message: result.ok ? "登录服务没有返回刷新会话。" : classified.message,
        },
      },
      { status: result.ok ? 502 : result.status },
    );
    if (!native) clearSessionCookies(response);
    return response;
  }

  // 原生客户端只携带 refresh token 且不接收 Cookie；cookie 流程仍返回 Set-Cookie。
  const rotate = !native || accessToken !== null;
  const response = NextResponse.json({
    ok: true,
    data: rotate
      ? {
          tokenType: "Bearer" as const,
          accessToken: result.data.access_token,
          expiresIn: result.data.access_token_expires_in,
          refreshToken: result.refreshToken,
          refreshTokenExpiresIn: result.data.refresh_token_expires_in,
        }
      : null,
  });
  setSessionCookies(
    response,
    result.data,
    native && accessToken === null ? undefined : result.refreshToken,
  );
  return response;
}
