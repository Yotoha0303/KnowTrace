import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assignGoUserRoles,
  authServiceBaseURL,
  listGoPermissions,
  listGoRoles,
  loginWithGoUserSystem,
  registerWithGoUserSystem,
  updateGoUserPassword,
  updateGoUserProfile,
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

  it("maps the complete account and RBAC contract to go-user-system", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const data = url.endsWith("/admin/roles")
        ? [{ id: 1, code: "user", name: "普通用户" }]
        : url.endsWith("/admin/permissions")
          ? [{ id: 1, code: "profile:read", name: "读取资料", method: "GET", path: "/api/v1/users/me" }]
          : null;
      return new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerWithGoUserSystem({ username: "new-user", password: "long-password" })).resolves.toMatchObject({ ok: true });
    await expect(updateGoUserProfile("access.jwt", { nickname: "新昵称" })).resolves.toMatchObject({ ok: true });
    await expect(updateGoUserPassword("access.jwt", { old_password: "old-password", new_password: "new-password" })).resolves.toMatchObject({ ok: true });
    await expect(listGoRoles("access.jwt")).resolves.toMatchObject({ ok: true, data: [{ code: "user" }] });
    await expect(listGoPermissions("access.jwt")).resolves.toMatchObject({ ok: true, data: [{ code: "profile:read" }] });
    await expect(assignGoUserRoles("access.jwt", 12, ["user", "admin"])).resolves.toMatchObject({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/users/me/profile",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ nickname: "新昵称" }),
        headers: expect.objectContaining({ authorization: "Bearer access.jwt" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/users/me/update/password",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8082/api/v1/admin/users/12/roles",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ role_codes: ["user", "admin"] }),
      }),
    );
  });
});
