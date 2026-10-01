// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManualClaimForm } from "./claim-workflow-panel";

/**
 * 2026-10-01 的回归测试：手动主张表单的**文案**与**提交后的按钮状态**。
 *
 * 背景（docs/changes/2026-10-01-手动主张流程与按钮动画.md）：
 * 用户报告两条 —— ①流程不清晰 ②按钮出现「循环刷新的动画」。
 * ② 的成因是 `router.refresh()` 原先写在 `startTransition` 回调**里面**。
 *
 * ---
 * ⚠️ **本文件对 ② 的覆盖是有限的，已证伪**
 *
 * 把代码还原成旧写法后实测：「按钮等待态」那条**仍然通过**——
 * 因为原版里 `router.refresh()` 并未被 await，它保持 pending 靠的是
 * **Next 路由自身的状态**，而 mock 的 router 复现不了。
 *
 * 所以：**②「按钮转不停」没有自动化测试覆盖，只能靠浏览器确认。**
 *
 * 有效的是 ①：文案那条在旧代码上**确实失败**（实测），是真回归测试。
 */

const createManualClaimAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions", () => ({
  createManualClaimAction: (input: unknown) => createManualClaimAction(input),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

describe("manual claim form", () => {
  const props = {
    captureId: "11111111-1111-4111-8111-111111111111",
    captureVersion: 1,
    // 摘录必须能在原文里找到，否则 canSubmit 恒为 false
    captureContent: "这是一段用于测试的原文内容，摘录要能在这里完整找到。",
  };

  function fillValidForm() {
    fireEvent.change(screen.getByLabelText(/主张/), {
      target: { value: "这是一个可以被证据支持或反驳的明确陈述" },
    });
    fireEvent.change(screen.getByLabelText(/原文来源摘录/), {
      target: { value: "这是一段用于测试的原文内容" },
    });
    fireEvent.change(screen.getByLabelText(/证伪条件/), {
      target: { value: "如果出现相反的证据，这个主张就不成立" },
    });
  }

  beforeEach(() => {
    createManualClaimAction.mockReset();
    refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ⚠️ 这条测试**抓不到它名义上要守的那个 bug**。
  //
  // 已证伪：把代码还原成「refresh 在 startTransition 里」的旧写法后，
  // 这条测试**仍然通过**。原因是原版里 `router.refresh()` 并未被 await，
  // 它保持 pending 靠的是 **Next 路由自身的状态**，而 mock 的 router 复现不了。
  //
  // 保留它只因为它仍验证一件有用的事：**提交结束后按钮回到正常态**。
  // 「按钮转不停」那条缺陷**没有自动化测试覆盖**，只能靠浏览器确认 ——
  // 这一点已写进 docs/changes/2026-10-01-手动主张流程与按钮动画.md。
  it("returns the button to its normal state after a successful submit", async () => {
    createManualClaimAction.mockResolvedValue({ ok: true, data: { id: "claim-1" } });
    let refreshResolve: () => void = () => {};
    refresh.mockImplementation(
      () => new Promise<void>((resolve) => { refreshResolve = resolve; }),
    );

    render(<ManualClaimForm {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /保存为候选主张/ }));

    // 关键：refresh 还没返回时，按钮就该回到正常文案
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /保存为候选主张/ })).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /正在保存/ })).toBeNull();

    // 收尾，避免悬挂的 promise
    refreshResolve();
  });

  it("tells the user the next step instead of listing two parallel options", async () => {
    createManualClaimAction.mockResolvedValue({ ok: true, data: { id: "claim-1" } });
    refresh.mockImplementation(() => Promise.resolve());

    render(<ManualClaimForm {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /保存为候选主张/ }));

    await waitFor(() => {
      // 承重：必须点明「开始调查」是添加证据的前置
      expect(screen.getByText(/开始调查/)).toBeTruthy();
    });
    // 且不能是原来那种把两件事并列的说法
    expect(screen.queryByText(/可继续开始调查和补充证据/)).toBeNull();
  });

  it("re-enables the button after a failed submit", async () => {
    createManualClaimAction.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "请检查输入内容。" },
    });

    render(<ManualClaimForm {...props} />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: /保存为候选主张/ }));

    await waitFor(() => {
      expect(screen.getByText("请检查输入内容。")).toBeTruthy();
    });
    // 失败后按钮必须可用，否则用户改了也提交不了
    const button = screen.getByRole("button", { name: /保存为候选主张/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    // 失败时不该触发刷新
    expect(refresh).not.toHaveBeenCalled();
  });
});
