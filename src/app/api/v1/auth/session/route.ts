import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  getGoAuthorization,
  getGoUser,
  isAuthEnabled,
} from "@/features/auth/go-user-system";

export async function GET(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ ok: true, data: { enabled: false, user: null } });
  }
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_REQUIRED", message: "请先登录。" } },
      { status: 401 },
    );
  }
  const [user, authorization] = await Promise.all([
    getGoUser(accessToken),
    getGoAuthorization(accessToken),
  ]);
  if (!user.ok || !authorization.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_REQUIRED", message: "登录会话已失效。" } },
      { status: 401 },
    );
  }
  return NextResponse.json({
    ok: true,
    data: { enabled: true, user: user.data, authorization: authorization.data },
  });
}
