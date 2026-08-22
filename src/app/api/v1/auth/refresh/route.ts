import { NextRequest, NextResponse } from "next/server";

import {
  isAuthEnabled,
  refreshWithGoUserSystem,
  REFRESH_TOKEN_COOKIE,
} from "@/features/auth/go-user-system";
import { clearSessionCookies, setSessionCookies } from "@/features/auth/response";

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_DISABLED", message: "登录功能尚未启用。" } },
      { status: 404 },
    );
  }
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_REQUIRED", message: "没有可恢复的登录会话。" } },
      { status: 401 },
    );
  }

  const result = await refreshWithGoUserSystem(refreshToken);
  if (!result.ok || !result.refreshToken) {
    const response = NextResponse.json(
      {
        ok: false,
        error: {
          code: result.ok ? "AUTH_CONTRACT_INVALID" : result.code,
          message: result.ok ? "登录服务没有返回刷新会话。" : result.message,
        },
      },
      { status: result.ok ? 502 : result.status },
    );
    clearSessionCookies(response);
    return response;
  }

  const response = NextResponse.json({ ok: true, data: null });
  setSessionCookies(response, result.data, result.refreshToken);
  return response;
}
