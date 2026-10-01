// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuickCaptureForm } from "./quick-capture-form";

/**
 * 2026-10-01 新增：保存快捷键。
 *
 * 背景（docs/changes/2026-10-01-体验三项修复.md 第 1.3 节）：
 * docs/02-user-flows.md:20 一直写着「点击保存/使用快捷键」，
 * 但当时全仓库检索确认**没有任何快捷键实现**——文档名不副实。
 * 现在补了 Ctrl/⌘ + Enter，这两条测试就是它的验收。
 *
 * 断言的是「action 真的被调用」而不是「界面上出现了什么」：
 * 提交这件事的证据是副作用，不是文案。
 */
const createCaptureAction = vi.fn();

vi.mock("@/app/actions", () => ({
  createCaptureAction: (input: unknown) => createCaptureAction(input),
}));

describe("quick capture keyboard shortcut", () => {
  const defaultProps = {
    categories: [],
    defaultOccurredAt: "2026-10-01T12:00",
  };

  beforeEach(() => {
    // 返回失败以避免走到 window.location.replace（jsdom 里不可赋值）。
    // 这不影响断言——我们要证明的是「提交发生了」，不是「跳转了」。
    createCaptureAction.mockResolvedValue({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "测试占位错误" },
    });
  });

  afterEach(() => {
    cleanup();
    createCaptureAction.mockClear();
  });

  it("submits when Ctrl+Enter is pressed in the textarea", async () => {
    render(<QuickCaptureForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/输入关键词/);
    fireEvent.change(textarea, { target: { value: "一条真实的记录" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(createCaptureAction).toHaveBeenCalledTimes(1));
    expect(createCaptureAction.mock.calls[0][0]).toMatchObject({
      content: "一条真实的记录",
    });
  });

  it("submits on Cmd+Enter as well (macOS)", async () => {
    render(<QuickCaptureForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/输入关键词/);
    fireEvent.change(textarea, { target: { value: "mac 上的一次记录" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => expect(createCaptureAction).toHaveBeenCalledTimes(1));
  });

  it("does not submit on a plain Enter (newline is legal input)", async () => {
    render(<QuickCaptureForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/输入关键词/);
    fireEvent.change(textarea, { target: { value: "多行\n内容" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // 给它一点时间：如果错误地提交了，这里会捕捉到
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(createCaptureAction).not.toHaveBeenCalled();
  });

  it("does not submit a shortcut with empty content", async () => {
    render(<QuickCaptureForm {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(/输入关键词/);
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(createCaptureAction).not.toHaveBeenCalled();
  });

  it("mentions the shortcut in the hint so it is discoverable", () => {
    render(<QuickCaptureForm {...defaultProps} />);

    expect(screen.getByText(/Ctrl\/⌘ \+ Enter/)).toBeTruthy();
  });
});
