import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  isAuthEnabled,
  logoutFromGoUserSystem,
  REFRESH_TOKEN_COOKIE,
} from "@/features/auth/go-user-system";
import { clearSessionCookies } from "@/features/auth/response";
import { bearerTokenFrom, isNativeClientRequest } from "@/features/auth/client-mode";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, data: null });
  if (!isAuthEnabled()) return response;

  // 原生客户端没有 Cookie：access token 来自 Authorization，refresh token 复用同一个头的 Bearer 值。
  const native = isNativeClientRequest(request);
  const bearer = bearerTokenFrom(request);
  const refreshToken = native
    ? bearer
    : (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value ?? null);
  const accessToken = native
    ? (bearer ?? undefined)
    : (request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? undefined);
  if (refreshToken) {
    const result = await logoutFromGoUserSystem({ accessToken, refreshToken });
    if (!result.ok) {
      const failed = NextResponse.json(
        { ok: false, error: { code: result.code, message: result.message } },
        { status: result.status },
      );
      if (!native) clearSessionCookies(failed);
      return failed;
    }
  }
  if (!native) clearSessionCookies(response);
  return response;
}
