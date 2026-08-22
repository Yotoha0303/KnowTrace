import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  isAuthEnabled,
  loginWithGoUserSystem,
} from "@/features/auth/go-user-system";
import { setSessionCookies } from "@/features/auth/response";

const credentialsSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(72),
});

export async function POST(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_DISABLED", message: "登录功能尚未启用。" } },
      { status: 404 },
    );
  }
  const parsed = credentialsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "请输入用户名和密码。" } },
      { status: 400 },
    );
  }

  const result = await loginWithGoUserSystem(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }
  if (!result.refreshToken) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_CONTRACT_INVALID", message: "登录服务没有返回刷新会话。" } },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ ok: true, data: { user: result.data.user } });
  setSessionCookies(response, result.data, result.refreshToken);
  return response;
}
