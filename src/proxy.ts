import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  getGoUser,
  isAuthEnabled,
} from "@/features/auth/go-user-system";
import { clearSessionCookies } from "@/features/auth/response";

const publicPath = (pathname: string) =>
  pathname.startsWith("/api/v1/auth/") ||
  pathname.startsWith("/api/health") ||
  pathname === "/favicon.ico";

function loginRedirect(request: NextRequest) {
  const url = new URL("/login", request.url);
  if (request.method === "GET" && request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isAuthEnabled()) {
    return pathname === "/login"
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (publicPath(pathname)) return NextResponse.next();

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const user = accessToken ? await getGoUser(accessToken) : null;

  if (pathname === "/login") {
    if (user?.ok) return NextResponse.redirect(new URL("/", request.url));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-knowtrace-user-id");
    requestHeaders.delete("x-knowtrace-username");
    requestHeaders.delete("x-knowtrace-nickname");
    requestHeaders.set("x-knowtrace-login-page", "1");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  if (!user?.ok) {
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { ok: false, error: { code: "AUTH_REQUIRED", message: "请先登录。" } },
        { status: 401 },
      );
      if (accessToken) clearSessionCookies(response);
      return response;
    }
    const response = loginRedirect(request);
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-knowtrace-user-id", String(user.data.id));
  requestHeaders.set("x-knowtrace-username", encodeURIComponent(user.data.username));
  requestHeaders.set("x-knowtrace-nickname", encodeURIComponent(user.data.nickname));
  requestHeaders.delete("x-knowtrace-login-page");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
