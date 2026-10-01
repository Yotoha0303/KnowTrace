// @vitest-environment jsdom
// 全局环境是 node（既有测试依赖它），这里按文件切到 jsdom——组件需要 DOM。

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ErrorPage from "./error";

/**
 * 2026-10-01 的回归测试：错误边界**不得**再把会话过期说成数据库故障。
 *
 * 背景（docs/changes/2026-10-01-体验三项修复.md 第 1.1 节）：
 * 改前文案是固定的一句「请确认数据库已经启动，然后重试。」，
 * 而实际最常命中的原因是 Access Token 15 分钟过期。
 * 把「你重登一下」说成「你的数据库可能挂了」，损伤的是**信任**。
 *
 * 这两条断言的价值在于它们会**在有人把文案改回去时失败**。
 */
describe("global error page", () => {
  const reset = vi.fn();

  // globals 未开启，@testing-library/react 不会自动 cleanup，这里显式注册。
  afterEach(() => {
    cleanup();
    reset.mockClear();
  });

  function renderError(error: Error & { digest?: string }) {
    return render(<ErrorPage error={error} reset={reset} />);
  }

  it("classifies an expired session as an auth problem, never as a database problem", () => {
    renderError(new Error("unauthorized"));

    expect(screen.getByRole("heading").textContent).toBe("登录已过期");
    // 承重断言：不许出现「数据库」
    expect(screen.queryByText(/数据库/)).toBeNull();
    // 且要给出可执行的下一步
    expect(screen.getByRole("link", { name: "重新登录" })).toBeTruthy();
  });

  it("treats a server-action HTML response as an auth problem, not a crash", () => {
    // 这正是旧代码踩中的那条：Server Action 收到登录页 HTML 后解析失败，
    // 抛出的就是这句附言。
    renderError(
      new Error("Unexpected response was received from the server."),
    );

    expect(screen.getByRole("heading").textContent).toBe("登录已过期");
    expect(screen.queryByText(/数据库/)).toBeNull();
  });

  it("reports a network failure as retryable without naming a cause", () => {
    renderError(new Error("Failed to fetch"));

    expect(screen.getByRole("heading").textContent).toBe("连接出了点问题");
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.queryByText(/数据库/)).toBeNull();
  });

  it("stays neutral for an unknown error and surfaces the digest", () => {
    renderError(Object.assign(new Error("kaboom"), { digest: "abc123" }));

    expect(screen.getByRole("heading").textContent).toBe("出了点问题");
    // 不做没有依据的病因断言
    expect(screen.queryByText(/数据库/)).toBeNull();
    // digest 要给出来，让用户能贴给维护者
    expect(screen.getByText(/abc123/)).toBeTruthy();
  });
});
