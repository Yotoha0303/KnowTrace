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

describe("authentication proxy", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_ENABLED", "true");
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

  it("allows health endpoints without calling the auth service", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxy(new NextRequest("http://localhost/api/health/ready"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates the access token and replaces spoofed identity headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(validUserEnvelope), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("http://localhost/", {
      headers: {
        cookie: "knowtrace_access_token=access.jwt",
        "x-knowtrace-username": "attacker",
      },
    });

    const response = await proxy(request);

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-knowtrace-user-id")).toBe("7");
    expect(response.headers.get("x-middleware-request-x-knowtrace-username")).toBe("yotoha");
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
});
