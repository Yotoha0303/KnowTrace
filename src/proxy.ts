import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  getGoAuthorization,
  getGoUser,
  isAuthEnabled,
  isRegistrationEnabled,
} from "@/features/auth/go-user-system";
import { clearSessionCookies } from "@/features/auth/response";
import {
  ACCESS_TOKEN_HEADER,
  isNativeClientRequest,
  WORKSPACE_ID_HEADER,
} from "@/features/auth/client-mode";

const PUBLIC_PATHS = (pathname: string) =>
  pathname.startsWith("/api/v1/auth/") ||
  pathname.startsWith("/api/health") ||
  pathname === "/api/metrics" ||
  pathname === "/favicon.ico";

function loginRedirect(request: NextRequest) {
  const url = new URL("/login", request.url);
  if (request.method === "GET" && request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return NextResponse.redirect(url);
}

function authRequired(request: NextRequest, message: string) {
  // 原生客户端不发送 Cookie，也不该收到 302 登录页；统一返回 JSON 401。
  if (isNativeClientRequest(request) || request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: "AUTH_REQUIRED", message } },
      { status: 401 },
    );
  }
  return loginRedirect(request);
}

/**
 * 原生客户端（`X-Client: native`）不走 Cookie，而是用 `Authorization: Bearer <access token>`。
 * 令牌可能已过期，而 /api/v1/auth/* 是公开路径、不会经过下面的鉴权分支，
 * 因此这里先做一次校验：有效就把令牌转发给下游（下游仍会重新校验并重新取角色），
 * 无效则明确返回 401 让客户端去调用 refresh，而不是在业务分支里被当成没有身份。
 */
async function nativeRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const authPage = pathname === "/login" || pathname === "/register";
  if (authPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  // 登录、刷新和会话探测本身就是未认证请求；它们必须放行，否则会形成死锁：
  // 客户端没有令牌就登不进去，登不进去就永远没有令牌。
  if (PUBLIC_PATHS(pathname)) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.trim().split(/\s+/);
  const token =
    scheme && scheme.toLowerCase() === "bearer" ? rest.join(" ").trim() : "";
  if (!token) {
    return authRequired(request, "请先登录。");
  }
  const user = await getGoUser(token);
  if (!user.ok) {
    return authRequired(request, "登录会话已失效，请重新登录。");
  }
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(ACCESS_TOKEN_HEADER, token);
  let workspaceId: string | null = null;
  try {
    workspaceId = request.nextUrl.searchParams.get(WORKSPACE_ID_HEADER);
  } catch {
    workspaceId = null;
  }
  if (workspaceId) requestHeaders.set(WORKSPACE_ID_HEADER, workspaceId);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authPage = pathname === "/login" || pathname === "/register";
  if (!isAuthEnabled()) {
    return authPage
      ? NextResponse.redirect(new URL("/", request.url))
      : NextResponse.next();
  }
  if (isNativeClientRequest(request)) {
    return nativeRequest(request);
  }
  // 原生分支已在上方返回，剩下的都是 Cookie 客户端。
  if (PUBLIC_PATHS(pathname)) return NextResponse.next();

  if (pathname === "/register" && !isRegistrationEnabled()) {
    return NextResponse.redirect(new URL("/login?registration=disabled", request.url));
  }

  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const [user, authorization] = accessToken
    ? await Promise.all([
        getGoUser(accessToken),
        getGoAuthorization(accessToken),
      ])
    : [null, null];

  if (authPage) {
    if (user?.ok && authorization?.ok) return NextResponse.redirect(new URL("/", request.url));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-knowtrace-user-id");
    requestHeaders.delete("x-knowtrace-username");
    requestHeaders.delete("x-knowtrace-nickname");
    requestHeaders.set("x-knowtrace-auth-page", "1");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  if (!user?.ok || !authorization?.ok) {
    const response = authRequired(
      request,
      accessToken ? "登录会话已失效，请重新登录。" : "请先登录。",
    );
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-knowtrace-user-id", String(user.data.id));
  requestHeaders.set("x-knowtrace-username", encodeURIComponent(user.data.username));
  requestHeaders.set("x-knowtrace-nickname", encodeURIComponent(user.data.nickname));
  requestHeaders.set("x-knowtrace-role-codes", authorization.data.role_codes.join(","));
  requestHeaders.delete("x-knowtrace-auth-page");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
