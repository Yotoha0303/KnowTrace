// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSwitcher } from "./workspace-switcher";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

const defaultWorkspace = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  workspaceName: "默认空间",
  workspaceSlug: "legacy-default",
  actorId: "local-owner",
  actorName: "本地使用者",
  role: "owner" as const,
};
const secondaryWorkspace = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceName: "第二空间",
  workspaceSlug: "workspace-secondary",
  actorId: "local-owner",
  actorName: "本地使用者",
  role: "owner" as const,
};

function okResponse<T>(data: T, status = 200) {
  return {
    ok: true,
    status,
    json: async () => ({ ok: true, data }),
  } as Response;
}

afterEach(() => {
  cleanup();
  push.mockReset();
  refresh.mockReset();
  vi.restoreAllMocks();
});

describe("WorkspaceSwitcher", () => {
  it("switches through the server-validated current Workspace endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse(secondaryWorkspace));

    render(
      React.createElement(WorkspaceSwitcher, {
        currentWorkspaceId: defaultWorkspace.workspaceId,
        workspaces: [defaultWorkspace, secondaryWorkspace],
      }),
    );

    fireEvent.change(screen.getByLabelText("当前 Workspace"), {
      target: { value: secondaryWorkspace.workspaceId },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/workspaces/current");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body))).toEqual({
      workspaceId: secondaryWorkspace.workspaceId,
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("creates a Workspace first, then switches to the returned membership", async () => {
    const createdWorkspace = {
      ...secondaryWorkspace,
      workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspaceName: "新研发空间",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(okResponse(createdWorkspace, 201))
      .mockResolvedValueOnce(okResponse(createdWorkspace));

    render(
      React.createElement(WorkspaceSwitcher, {
        currentWorkspaceId: defaultWorkspace.workspaceId,
        workspaces: [defaultWorkspace],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /新建/ }));
    fireEvent.change(screen.getByLabelText("新 Workspace 名称"), {
      target: { value: "新研发空间" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并切换" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/workspaces");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body))).toEqual({
      name: "新研发空间",
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/workspaces/current");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit)?.body))).toEqual({
      workspaceId: createdWorkspace.workspaceId,
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never offers deletion for the protected default Workspace", () => {
    render(
      React.createElement(WorkspaceSwitcher, {
        currentWorkspaceId: defaultWorkspace.workspaceId,
        workspaces: [defaultWorkspace],
      }),
    );

    expect(screen.queryByRole("button", { name: /删除/ })).toBeNull();
  });

  it("requires the exact Workspace name before deleting the current empty Workspace", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okResponse({
        deletedWorkspaceId: secondaryWorkspace.workspaceId,
        currentWorkspaceId: defaultWorkspace.workspaceId,
      }),
    );

    render(
      React.createElement(WorkspaceSwitcher, {
        currentWorkspaceId: secondaryWorkspace.workspaceId,
        workspaces: [defaultWorkspace, secondaryWorkspace],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    const confirmButton = screen.getByRole("button", { name: "确认删除" }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("删除 Workspace 确认名称"), {
      target: { value: secondaryWorkspace.workspaceName },
    });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/workspaces");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit)?.method).toBe("DELETE");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit)?.body))).toEqual({
      workspaceId: secondaryWorkspace.workspaceId,
      confirmationName: secondaryWorkspace.workspaceName,
    });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
