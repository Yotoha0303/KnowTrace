import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";

const validUserEnvelope = {
  code: 0,
  msg: "ok",
  data: {
    id: 7,
    username: "yotoha",
    nickname: "Yotoha",
    status: 1,
  },
};

const validAuthorizationEnvelope = {
  code: 0,
  msg: "ok",
  data: {
    role_codes: ["user"],
    permission_codes: ["profile:read"],
  },
};

describe("authentication proxy", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_ENABLED", "true");
    vi.stubEnv("AUTH_REGISTRATION_ENABLED", "true");
    vi.stubEnv("AUTH_SERVICE_URL", "http://127.0.0.1:8082");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("redirects an anonymous page request to login and preserves its destination", async () => {
    const response = await proxy(new NextRequest("http://localhost/search?q=ai"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login?next=%2Fsearch%3Fq%3Dai");
  });

  it("returns JSON 401 for an anonymous protected API request", async () => {
    const response = await proxy(new NextRequest("http://localhost/api/evidence-images/test"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("distinguishes a missing session from an expired one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 3007, msg: "token expired", data: null }), {
          status: 401,
        }),
      ),
    );
    const request = new NextRequest("http://localhost/api/v1/captures", {
      headers: { cookie: "knowtrace_access_token=expired.jwt" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED", message: "登录会话已失效，请重新登录。" },
    });
  });

  it("allows health endpoints without calling the auth service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxy(new NextRequest("http://localhost/api/health/ready"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the token-protected metrics endpoint without a user session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxy(new NextRequest("http://localhost/api/metrics"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the registration page only when upstream registration is enabled", async () => {
    const enabled = await proxy(new NextRequest("http://localhost/register"));
    expect(enabled.headers.get("x-middleware-next")).toBe("1");
    expect(enabled.headers.get("x-middleware-request-x-knowtrace-auth-page")).toBe("1");

    vi.stubEnv("AUTH_REGISTRATION_ENABLED", "false");
    const disabled = await proxy(new NextRequest("http://localhost/register"));
    expect(disabled.status).toBe(307);
    expect(disabled.headers.get("location")).toBe("http://localhost/login?registration=disabled");
  });

  it("validates the access token and replaces spoofed identity headers", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/authorization")
              ? validAuthorizationEnvelope
              : validUserEnvelope,
          ),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost/", {
      headers: {
        cookie: "knowtrace_access_token=access.jwt",
        "x-knowtrace-username": "attacker",
        "x-knowtrace-role-codes": "admin",
      },
    });

    const response = await proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-knowtrace-user-id")).toBe("7");
    expect(response.headers.get("x-middleware-request-x-knowtrace-username")).toBe("yotoha");
    expect(response.headers.get("x-middleware-request-x-knowtrace-role-codes")).toBe("user");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/users/me",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer access.jwt" }) }),
    );
  });

  // ---- 2026-10-01 新增：会话续期与 Server Action 不再收 HTML ----
  // 依据 docs/changes/2026-10-01-体验三项修复.md 的 1.1。
  // 改前：Access Token 一过期就直接判未认证，而用户看到的却是「数据库未启动」。

  it("renews an expired access token with the refresh token instead of rejecting", async () => {
    const expired = new Response(JSON.stringify({ code: 3007, msg: "expired", data: null }), {
      status: 401,
    });
    const okUser = new Response(JSON.stringify(validUserEnvelope), { status: 200 });
    const okAuth = new Response(JSON.stringify(validAuthorizationEnvelope), { status: 200 });
    const refreshed = new Response(
      JSON.stringify({
        code: 0,
        msg: "ok",
        data: {
          access_token: "renewed.jwt",
          access_token_expires_in: 900,
          refresh_token_expires_in: 604800,
        },
      }),
      { status: 200, headers: { "set-cookie": "refresh_token=rotated.jwt; Path=/" } },
    );

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call += 1;
        // 1: getGoUser(旧令牌) → 过期；2: getGoAuthorization(旧) → 过期
        if (call <= 2) return Promise.resolve(expired);
        // 3: refresh → 成功；4/5: getGoUser/getGoAuthorization(新令牌) → 成功
        if (call === 3) return Promise.resolve(refreshed);
        return Promise.resolve(call === 4 ? okUser : okAuth);
      }),
    );

    const request = new NextRequest("http://localhost/search", {
      headers: {
        cookie:
          "knowtrace_access_token=expired.jwt; refresh_token=valid-refresh.jwt",
      },
    });

    const response = await proxy(request);

    // 续期成功 → 放行，并把新的 access token 写回 Cookie
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("knowtrace_access_token=renewed.jwt");
    // 身份头由**服务端重新校验**后的结果写入，不是从客户端抄来的
    expect(response.headers.get("x-middleware-request-x-knowtrace-username")).toBe("yotoha");
  });

  // ---- 2026-10-01 新增：状态 A（**只有 refresh cookie**）----
  //
  // 这是**真实场景**：access cookie 的 maxAge 就是它的有效期（900 秒），
  // 15 分钟一到浏览器**直接删掉它**，于是请求里只有 refresh cookie。
  //
  // 早先的守卫写的是 `if (accessToken)`，状态 A 下不成立 → 续期从不触发
  // → 用户在线一会儿就被踢到登录页。而原有测试只覆盖了「access 在但失效」，
  // **恰恰掩盖了这个 bug**。见 docs/changes/2026-10-01-会话续期回归与hover转圈.md。
  it("renews when only the refresh cookie is present (the real 15-minute state)", async () => {
    const okUser = new Response(JSON.stringify(validUserEnvelope), { status: 200 });
    const okAuth = new Response(JSON.stringify(validAuthorizationEnvelope), { status: 200 });
    const refreshed = new Response(
      JSON.stringify({
        code: 0,
        msg: "ok",
        data: {
          access_token: "renewed.jwt",
          access_token_expires_in: 900,
          refresh_token_expires_in: 604800,
        },
      }),
      { status: 200, headers: { "set-cookie": "refresh_token=rotated.jwt; Path=/" } },
    );

    // 注意：这里**没有** getGoUser(旧令牌) 那两次调用 ——
    // 状态 A 下 access cookie 根本不存在，所以不会先去校验它。
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call += 1;
        if (call === 1) return Promise.resolve(refreshed);
        return Promise.resolve(call === 2 ? okUser : okAuth);
      }),
    );

    // 关键：**没有** knowtrace_access_token
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: "refresh_token=valid-refresh.jwt" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie") ?? "").toContain("knowtrace_access_token=renewed.jwt");
  });

  it("falls back to rejecting when the refresh token is also invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 3007, msg: "expired", data: null }), {
          status: 401,
        }),
      ),
    );
    const request = new NextRequest("http://localhost/api/v1/captures", {
      headers: {
        cookie:
          "knowtrace_access_token=expired.jwt; refresh_token=dead.jwt",
      },
    });

    const response = await proxy(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("lets an unauthenticated server action through with identity headers stripped", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 3007, msg: "expired", data: null }), {
          status: 401,
        }),
      ),
    );

    const request = new NextRequest("http://localhost/", {
      method: "POST",
      headers: {
        "next-action": "abc123",
        // 伪造的身份头必须被清掉，否则下游可能误信
        "x-knowtrace-user-id": "999",
        "x-knowtrace-role-codes": "admin",
        cookie: "knowtrace_access_token=expired.jwt",
      },
    });

    const response = await proxy(request);

    // 不再 307 成登录页 HTML —— Server Action 才能拿到结构化结果
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    // 伪造身份已被清除（Next 用 x-middleware-request-* 传递改写后的头）
    const spoofed = response.headers.get("x-middleware-request-x-knowtrace-user-id");
    expect(spoofed === null || spoofed === "").toBe(true);
  });

  it("keeps the application open when auth is explicitly disabled", async () => {
    vi.stubEnv("AUTH_ENABLED", "false");

    const response = await proxy(new NextRequest("http://localhost/"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns JSON 401 instead of a redirect when a native request has no token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost/api/v1/captures", {
      headers: { "x-client": "native" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
    // 没有令牌就不该打扰认证后端。
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns JSON 401 when a native bearer token is rejected upstream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 3007, msg: "token expired", data: null }), {
          status: 401,
        }),
      ),
    );
    const request = new NextRequest("http://localhost/api/v1/captures", {
      headers: { authorization: "Bearer expired.jwt", "x-client": "native" },
    });

    const response = await proxy(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
  });

  it("forwards a valid native bearer token downstream for server-side revalidation", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/authorization") ? validAuthorizationEnvelope : validUserEnvelope,
          ),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest(
      "http://localhost/api/v1/captures?x-knowtrace-workspace-id=ws-1",
      { headers: { authorization: "Bearer access.jwt", "x-client": "native" } },
    );

    const response = await proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    // 不做 Cookie 身份注入；令牌由下游重新校验并重新取角色。
    expect(response.headers.get("x-middleware-request-x-knowtrace-user-id")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/users/me",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access.jwt" }),
      }),
    );
    // 登录请求本身是公开路径，客户端登录时还没有令牌。
    const login = await proxy(
      new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { "x-client": "native" },
      }),
    );
    expect(login.headers.get("x-middleware-next")).toBe("1");
  });
});
