import { NextRequest, NextResponse } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  getGoAuthorization,
  getGoUser,
  isAuthEnabled,
  isRegistrationEnabled,
  refreshWithGoUserSystem,
  REFRESH_TOKEN_COOKIE,
} from "@/features/auth/go-user-system";
import { clearSessionCookies, setSessionCookies } from "@/features/auth/response";
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
 * Server Action 请求带 `Next-Action` 头。
 *
 * 为什么需要它：Server Action 期待**结构化结果**，而 Proxy 对未认证的非 API 请求
 * 会 307 到登录页 HTML —— Server Action 拿到 HTML 就解析失败，客户端反而看不到
 * `runAction` 本来准备好的 `{ ok:false, error:{ code:"AUTH_REQUIRED" } }`。
 * 那个结构化错误是**可读的**；HTML 不是。
 */
function isServerActionRequest(request: NextRequest) {
  return request.headers.has("next-action");
}

/** 把已经确认可用的身份写进下游请求头。 */
function withIdentityHeaders(
  request: NextRequest,
  identity: {
    id: number;
    username: string;
    nickname: string;
    roleCodes: string[];
  },
) {
  const headers = new Headers(request.headers);
  headers.set("x-knowtrace-workflow-user-id", String(identity.id));
  headers.set("x-knowtrace-workflow-username", encodeURIComponent(identity.username));
  headers.set("x-knowtrace-workflow-nickname", encodeURIComponent(identity.nickname));
  headers.set("x-knowtrace-workflow-role-codes", identity.roleCodes.join(","));
  headers.delete("x-knowtrace-workflow-auth-page");
  return headers;
}

/** 清除一切身份头。用于「未认证但必须放行」的路径——伪造的头绝不能存活。 */
function withoutIdentityHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete("x-knowtrace-workflow-user-id");
  headers.delete("x-knowtrace-workflow-username");
  headers.delete("x-knowtrace-workflow-nickname");
  headers.delete("x-knowtrace-workflow-role-codes");
  headers.delete(ACCESS_TOKEN_HEADER);
  headers.delete(WORKSPACE_ID_HEADER);
  return headers;
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

/**
 * Cookie 客户端的 Access Token 失效时，用 Refresh Token 换一枚新的。
 *
 * 成功：返回一个已带上新 Cookie 与身份头的响应。
 * 失败：返回 null，调用方走未认证分支。
 *
 * 为什么放在 Proxy 而不是客户端定时续期：
 *   客户端的定时器在标签页休眠、多标签页、长时间不操作时都不可靠；
 *   而「令牌失效的那一刻按需续期」只有服务端知道。
 *   Access Token 只有 15 分钟，而用户完全可能开着页面想很久再保存——
 *   这正是 2026-10-01 之前「保存后报数据库错误」根因链的第 2、3 环。
 */
async function renewSession(request: NextRequest): Promise<NextResponse | null> {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return null;

  const refreshed = await refreshWithGoUserSystem(refreshToken);
  if (!refreshed.ok || !refreshed.refreshToken) return null;

  const accessToken = refreshed.data.access_token;
  const [user, authorization] = await Promise.all([
    getGoUser(accessToken),
    getGoAuthorization(accessToken),
  ]);
  if (!user.ok || !authorization.ok) return null;

  // 重新校验通过后才下发新 Cookie —— 避免把一枚换来了却不可用的令牌写进浏览器。
  const response = NextResponse.next({
    request: {
      headers: withIdentityHeaders(request, {
        id: user.data.id,
        username: user.data.username,
        nickname: user.data.nickname,
        roleCodes: authorization.data.role_codes,
      }),
    },
  });
  setSessionCookies(response, refreshed.data, refreshed.refreshToken);
  return response;
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
    requestHeaders.delete("x-knowtrace-workflow-user-id");
    requestHeaders.delete("x-knowtrace-workflow-username");
    requestHeaders.delete("x-knowtrace-workflow-nickname");
    requestHeaders.set("x-knowtrace-workflow-auth-page", "1");
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  if (!user?.ok || !authorization?.ok) {
    // ① Access Token 失效时，先尝试用 Refresh Token 续期。
    //
    // ⚠️ 守卫必须看 **refresh token**，不能看 access token。
    //
    // 「access 过期」在浏览器里有**两种表现**：
    //   (a) cookie 还在、但令牌已失效
    //   (b) **cookie 已被浏览器删掉** —— access cookie 的 maxAge 就是
    //       access_token_expires_in（900 秒），15 分钟一到它直接消失
    //
    // (b) 才是**真实场景**。早先这里写的是 `if (accessToken)`，
    // 于是 (b) 下守卫不成立、**续期从不触发** —— 用户在线一会儿就被踢到登录页。
    // 而 `renewSession` 本身根本不用 access token（它只读 refresh cookie），
    // 那个守卫写错了对象。见 docs/changes/2026-10-01-会话续期回归与hover转圈.md。
    //
    // `renewSession` 内部会自己读 refresh cookie，读不到就返回 null，
    // 所以这里只负责决定「要不要尝试」。
    if (request.cookies.get(REFRESH_TOKEN_COOKIE)?.value) {
      const renewed = await renewSession(request);
      if (renewed) return renewed;
    }

    // ② Server Action 不能被 307 成登录页 HTML，否则它拿不到结构化结果。
    //    放行并**显式清除上游身份头**——伪造的头绝不能存活；
    //    下游会用 Cookie 里的令牌重新校验，拿不到有效身份就返回 AUTH_REQUIRED。
    if (isServerActionRequest(request)) {
      const response = NextResponse.next({
        request: { headers: withoutIdentityHeaders(request) },
      });
      if (accessToken) clearSessionCookies(response);
      return response;
    }

    const response = authRequired(
      request,
      accessToken ? "登录会话已失效，请重新登录。" : "请先登录。",
    );
    if (accessToken) clearSessionCookies(response);
    return response;
  }

  return NextResponse.next({
    request: {
      headers: withIdentityHeaders(request, {
        id: user.data.id,
        username: user.data.username,
        nickname: user.data.nickname,
        roleCodes: authorization.data.role_codes,
      }),
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
