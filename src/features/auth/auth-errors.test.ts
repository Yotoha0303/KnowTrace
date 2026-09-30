import { describe, expect, it } from "vitest";

import { AUTH_ERROR_CODES, classifyAuthError } from "./auth-errors";

describe("auth error classification", () => {
  it("distinguishes rate limiting from a wrong password", () => {
    // 修复前两者都会渲染成「账号或密码错误」，用户无法知道该等一会还是该重输密码。
    expect(classifyAuthError(2008, 429).code).toBe(
      AUTH_ERROR_CODES.loginRateLimited,
    );
    expect(classifyAuthError(2005, 401).code).toBe(
      AUTH_ERROR_CODES.invalidCredentials,
    );
  });

  it("reports a disabled account instead of a credential failure", () => {
    expect(classifyAuthError(2004, 403)).toEqual({
      code: AUTH_ERROR_CODES.accountDisabled,
      message: "该账号已被停用，请联系管理员。",
    });
  });

  it("reports a missing account separately", () => {
    expect(classifyAuthError(2003, 404).code).toBe(
      AUTH_ERROR_CODES.accountNotFound,
    );
  });

  it("treats upstream outages as retryable rather than as bad credentials", () => {
    expect(classifyAuthError(6001, 500).code).toBe(
      AUTH_ERROR_CODES.serviceUnavailable,
    );
    expect(classifyAuthError(6002, 504).code).toBe(
      AUTH_ERROR_CODES.serviceUnavailable,
    );
    expect(classifyAuthError(null, 503).code).toBe(
      AUTH_ERROR_CODES.serviceUnavailable,
    );
  });

  it("maps refresh-token rejections to an expired session", () => {
    for (const code of [3011, 3012, 3013]) {
      expect(classifyAuthError(code, 401).code).toBe(
        AUTH_ERROR_CODES.refreshRejected,
      );
    }
  });

  it("fails closed on unknown upstream codes", () => {
    expect(classifyAuthError(9999, 400).code).toBe(
      AUTH_ERROR_CODES.contractInvalid,
    );
    expect(classifyAuthError(null, 400).code).toBe(
      AUTH_ERROR_CODES.contractInvalid,
    );
  });
});
