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

  // ---- 2026-10-01 新增：锁定要说明「这是锁定」并给出剩余时间 ----
  // 依据 docs/changes/2026-10-01-登录锁定可辨别性.md：
  // 原先锁定文案只说「请稍后再试」，读起来像「慢一点」而不是「你被锁了」，
  // 用户于是反复重试 —— **每次重试都在延长自己的锁**。

  it("says the login is locked (not merely 'too frequent') and includes the wait", () => {
    const withWait = classifyAuthError(2008, 429, 900);
    expect(withWait.code).toBe(AUTH_ERROR_CODES.loginRateLimited);
    expect(withWait.message).toContain("锁定");
    expect(withWait.message).toContain("15 分钟");

    // 不足一分钟时给秒，避免「约 1 分钟」这种虚假精度
    expect(classifyAuthError(2008, 429, 45).message).toContain("45 秒");

    // 上游没给 Retry-After 时仍要说明是锁定，只是不带时间
    const withoutWait = classifyAuthError(2008, 429);
    expect(withoutWait.message).toContain("锁定");
    expect(withoutWait.message).not.toMatch(/\d+ (秒|分钟)/);
  });

  it("keeps the wrong-password message free of any lockout wording", () => {
    // 承重：不能把「密码错」和「被锁定」混成同一句话 —— 那正是用户困惑的来源
    const wrong = classifyAuthError(2005, 401, 900);
    expect(wrong.code).toBe(AUTH_ERROR_CODES.invalidCredentials);
    expect(wrong.message).not.toContain("锁定");
    expect(wrong.message).not.toMatch(/\d+ (秒|分钟)/);
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
