import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authServiceBaseURL,
  loginWithGoUserSystem,
} from "./go-user-system";

const loginData = {
  access_token: "access.jwt",
  access_token_expires_in: 900,
  refresh_token_expires_in: 604800,
  user: {
    id: 7,
    username: "yotoha",
    nickname: "Yotoha",
    status: 1,
  },
};

describe("go-user-system client", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SERVICE_URL", "http://127.0.0.1:8082/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes the configured service root", () => {
    expect(authServiceBaseURL()).toBe("http://127.0.0.1:8082");
  });

  it("rejects credential-bearing service URLs", () => {
    vi.stubEnv("AUTH_SERVICE_URL", "http://user:secret@127.0.0.1:8082");
    expect(() => authServiceBaseURL()).toThrow(/无凭据/);
  });

  it("parses the access session and rotated refresh cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: "ok", data: loginData }), {
        status: 200,
        headers: { "set-cookie": "refresh_token=refresh.jwt; Path=/api/v1/auth; HttpOnly" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await loginWithGoUserSystem({ username: "yotoha", password: "secret" });

    expect(result).toEqual({ ok: true, data: loginData, refreshToken: "refresh.jwt" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/auth/login",
      expect.objectContaining({ method: "POST", cache: "no-store", redirect: "error" }),
    );
  });

  it("fails closed on malformed upstream responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ));

    await expect(loginWithGoUserSystem({ username: "u", password: "p" })).resolves.toMatchObject({
      ok: false,
      status: 502,
    });
  });

  it("reports an unavailable upstream without leaking the network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private upstream detail")));

    await expect(loginWithGoUserSystem({ username: "u", password: "p" })).resolves.toEqual({
      ok: false,
      status: 503,
      code: null,
      message: "登录服务暂时不可用，请稍后重试。",
    });
  });
});
