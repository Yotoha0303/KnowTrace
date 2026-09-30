import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  getGoAuthorization,
  getGoUser,
  isAuthEnabled,
} from "@/features/auth/go-user-system";
import { AUTH_ERROR_CODES } from "@/features/auth/auth-errors";
import { bearerTokenFrom, isNativeClientRequest } from "@/features/auth/client-mode";

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, data: { enabled: false, user: null } });
  }
  const accessToken = isNativeClientRequest(request)
    ? bearerTokenFrom(request)
    : (request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null);
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: { code: AUTH_ERROR_CODES.required, message: "请先登录。" } },
      { status: 401 },
    );
  }
  const [user, authorization] = await Promise.all([
    getGoUser(accessToken),
    getGoAuthorization(accessToken),
  ]);
  if (!user.ok || !authorization.ok) {
    return NextResponse.json(
      { ok: false, error: { code: AUTH_ERROR_CODES.sessionExpired, message: "登录会话已失效。" } },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    data: { enabled: true, user: user.data, authorization: authorization.data },
  });
}
