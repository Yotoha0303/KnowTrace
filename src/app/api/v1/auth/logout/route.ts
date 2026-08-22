import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  isAuthEnabled,
  logoutFromGoUserSystem,
  REFRESH_TOKEN_COOKIE,
} from "@/features/auth/go-user-system";
import { clearSessionCookies } from "@/features/auth/response";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true, data: null });
  if (!isAuthEnabled()) return response;

  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (refreshToken) {
    const result = await logoutFromGoUserSystem({ accessToken, refreshToken });
    if (!result.ok) {
      const failed = NextResponse.json(
        { ok: false, error: { code: result.code, message: result.message } },
        { status: result.status },
      );
      clearSessionCookies(failed);
      return failed;
    }
  }
  clearSessionCookies(response);
  return response;
}
