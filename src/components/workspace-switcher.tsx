"use client";

import { Building2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import type { WorkspaceAccess } from "@/features/workspace/service";
import { LEGACY_DEFAULT_WORKSPACE_ID } from "@/shared/workspace";

type WorkspaceSwitcherProps = Readonly<{
  currentWorkspaceId: string;
  workspaces: WorkspaceAccess[];
  variant?: "sidebar" | "mobile";
}>;

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error?: { message?: string } };

export function WorkspaceSwitcher({
  currentWorkspaceId,
  workspaces,
  variant = "sidebar",
}: WorkspaceSwitcherProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const [message, setMessage] = useState("");
  const current = useMemo(
    () => workspaces.find((workspace) => workspace.workspaceId === currentWorkspaceId),
    [currentWorkspaceId, workspaces],
  );

  async function selectWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === currentWorkspaceId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/workspaces/current", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const body = (await response.json()) as ApiEnvelope<WorkspaceAccess>;
      if (!response.ok || !body.ok) {
        setMessage(!body.ok ? body.error?.message || "Workspace 切换失败。" : "Workspace 切换失败。");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setMessage("Workspace 切换失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const createResponse = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: workspaceName }),
      });
      const createBody = (await createResponse.json()) as ApiEnvelope<WorkspaceAccess>;
      if (!createResponse.ok || !createBody.ok) {
        setMessage(!createBody.ok ? createBody.error?.message || "Workspace 创建失败。" : "Workspace 创建失败。");
        return;
      }

      const switchResponse = await fetch("/api/v1/workspaces/current", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: createBody.data.workspaceId }),
      });
      const switchBody = (await switchResponse.json()) as ApiEnvelope<WorkspaceAccess>;
      if (!switchResponse.ok || !switchBody.ok) {
        setMessage("Workspace 已创建，但自动切换失败，请手动切换。");
        return;
      }

      setName("");
      setCreating(false);
      router.push("/");
      router.refresh();
    } catch {
      setMessage("Workspace 创建失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function deleteWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || current.role !== "owner" || busy) return;
    const confirmedName = confirmationName.trim();
    if (!confirmedName) return;

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/workspaces", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: current.workspaceId,
          confirmationName: confirmedName,
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{
        deletedWorkspaceId: string;
        currentWorkspaceId: string;
      }>;
      if (!response.ok || !body.ok) {
        setMessage(!body.ok ? body.error?.message || "Workspace 删除失败。" : "Workspace 删除失败。");
        return;
      }

      setConfirmationName("");
      setDeleting(false);
      router.push("/");
      router.refresh();
    } catch {
      setMessage("Workspace 删除失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`workspace-switcher is-${variant}`} aria-label="Workspace 切换">
      <div className="workspace-switcher-heading">
        <Building2 size={14} />
        <span>Workspace</span>
        {busy ? <LoaderCircle className="spin" size={12} /> : null}
      </div>
      <select
        aria-label="当前 Workspace"
        disabled={busy}
        onChange={(event) => void selectWorkspace(event.target.value)}
        value={currentWorkspaceId}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.workspaceId} value={workspace.workspaceId}>
            {workspace.workspaceName}
          </option>
        ))}
      </select>
      <div className="workspace-switcher-meta">
        <small>{current?.role === "owner" ? "所有者" : "成员"}</small>
        <div className="workspace-switcher-actions">
          {current?.role === "owner" && current.workspaceId !== LEGACY_DEFAULT_WORKSPACE_ID ? (
            <button
              aria-expanded={deleting}
              disabled={busy}
              onClick={() => {
                setDeleting((value) => !value);
                setCreating(false);
                setConfirmationName("");
                setMessage("");
              }}
              type="button"
            >
              <Trash2 size={11} /> 删除
            </button>
          ) : null}
          <button
            aria-expanded={creating}
            disabled={busy}
            onClick={() => {
              setCreating((value) => !value);
              setDeleting(false);
              setConfirmationName("");
              setMessage("");
            }}
            type="button"
          >
            <Plus size={11} /> 新建
          </button>
        </div>
      </div>
      {creating ? (
        <form className="workspace-create-form" onSubmit={createWorkspace}>
          <input
            aria-label="新 Workspace 名称"
            autoComplete="off"
            disabled={busy}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：KnowTrace 研发"
            required
            value={name}
          />
          <button disabled={busy || !name.trim()} type="submit">
            {busy ? <LoaderCircle className="spin" size={12} /> : "创建并切换"}
          </button>
        </form>
      ) : null}
      {deleting && current ? (
        <form className="workspace-delete-form" onSubmit={deleteWorkspace}>
          <small>仅空 Workspace 可删除。请输入“{current.workspaceName}”确认。</small>
          <input
            aria-label="删除 Workspace 确认名称"
            autoComplete="off"
            disabled={busy}
            maxLength={100}
            onChange={(event) => setConfirmationName(event.target.value)}
            placeholder={current.workspaceName}
            required
            value={confirmationName}
          />
          <button
            disabled={busy || confirmationName.trim() !== current.workspaceName}
            type="submit"
          >
            {busy ? <LoaderCircle className="spin" size={12} /> : "确认删除"}
          </button>
        </form>
      ) : null}
      {message ? <p className="workspace-switcher-message" role="status">{message}</p> : null}
    </section>
  );
}
