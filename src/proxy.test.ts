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
