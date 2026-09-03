import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import type { ActorAccessIdentity } from "@/features/auth/access-policy";
import { db } from "@/server/db/client";
import {
  aiProcessingRuns,
  captures,
  categories,
  dataImportObjects,
  dataImportRuns,
  topicSyntheses,
  workspaceMemberships,
  workspaces,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";
import { LEGACY_DEFAULT_WORKSPACE_ID } from "@/shared/workspace";

import { selectWorkspaceMembership } from "./policy";

export type WorkspaceAccess = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  actorId: string;
  actorName: string;
  role: "owner" | "member";
};

export async function listActorWorkspaces(actorId: string): Promise<WorkspaceAccess[]> {
  return db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      actorId: workspaceMemberships.actorId,
      actorName: workspaceMemberships.actorName,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(eq(workspaceMemberships.actorId, actorId))
    .orderBy(asc(workspaces.name), asc(workspaces.id));
}

export async function requireWorkspaceMembership(
  actorId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const [membership] = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
      actorId: workspaceMemberships.actorId,
      actorName: workspaceMemberships.actorName,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.actorId, actorId),
        eq(workspaceMemberships.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new AppError("WORKSPACE_ACCESS_DENIED", "当前账号无权访问该 Workspace。");
  }
  return membership;
}

export async function createWorkspaceForActor(input: {
  actorId: string;
  actorName: string;
  name: string;
}): Promise<WorkspaceAccess> {
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new AppError(
      "WORKSPACE_NAME_INVALID",
      "Workspace 名称不能为空，且最多 100 个字符。",
    );
  }

  return db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(workspaces)
      .values({
        name,
        slug: `workspace-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        createdById: input.actorId,
        createdByName: input.actorName,
      })
      .returning({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
      });

    await transaction.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      actorId: input.actorId,
      actorName: input.actorName,
      role: "owner",
    });

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      actorId: input.actorId,
      actorName: input.actorName,
      role: "owner" as const,
    };
  });
}

export async function deleteEmptyWorkspaceForActor(input: {
  actorId: string;
  workspaceId: string;
  confirmationName: string;
}) {
  if (input.workspaceId === LEGACY_DEFAULT_WORKSPACE_ID) {
    throw new AppError(
      "WORKSPACE_DEFAULT_DELETE_FORBIDDEN",
      "默认 Workspace 不能删除。",
    );
  }

  return db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .select({
        id: workspaces.id,
        name: workspaces.name,
        role: workspaceMemberships.role,
      })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(
        and(
          eq(workspaceMemberships.actorId, input.actorId),
          eq(workspaceMemberships.workspaceId, input.workspaceId),
        ),
      )
      .for("update")
      .limit(1);

    if (!workspace) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace 不存在。 ");
    }
    if (workspace.role !== "owner") {
      throw new AppError(
        "WORKSPACE_DELETE_FORBIDDEN",
        "只有 Workspace 所有者可以删除该空间。",
      );
    }
    if (input.confirmationName.trim() !== workspace.name) {
      throw new AppError(
        "WORKSPACE_DELETE_CONFIRMATION_MISMATCH",
        "请输入完整的 Workspace 名称以确认删除。",
      );
    }

    const [capture, category, aiRun, topicSynthesis, importRun, importObject] =
      await Promise.all([
        transaction
          .select({ id: captures.id })
          .from(captures)
          .where(eq(captures.workspaceId, workspace.id))
          .limit(1),
        transaction
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.workspaceId, workspace.id))
          .limit(1),
        transaction
          .select({ id: aiProcessingRuns.id })
          .from(aiProcessingRuns)
          .where(eq(aiProcessingRuns.workspaceId, workspace.id))
          .limit(1),
        transaction
          .select({ id: topicSyntheses.id })
          .from(topicSyntheses)
          .where(eq(topicSyntheses.workspaceId, workspace.id))
          .limit(1),
        transaction
          .select({ id: dataImportRuns.id })
          .from(dataImportRuns)
          .where(eq(dataImportRuns.workspaceId, workspace.id))
          .limit(1),
        transaction
          .select({ id: dataImportObjects.id })
          .from(dataImportObjects)
          .where(eq(dataImportObjects.workspaceId, workspace.id))
          .limit(1),
      ]);

    if (
      capture.length ||
      category.length ||
      aiRun.length ||
      topicSynthesis.length ||
      importRun.length ||
      importObject.length
    ) {
      throw new AppError(
        "WORKSPACE_NOT_EMPTY",
        "Workspace 中仍有数据，当前只允许删除空 Workspace。",
      );
    }

    const [deleted] = await transaction
      .delete(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .returning({ id: workspaces.id });
    if (!deleted) {
      throw new AppError("WORKSPACE_NOT_FOUND", "Workspace 不存在。 ");
    }

    return { deletedWorkspaceId: deleted.id };
  });
}

/** Compatibility bridge for actors that first appear after migration 0020. */
export async function ensureLegacyWorkspaceMembership(
  identity: ActorAccessIdentity,
): Promise<WorkspaceAccess> {
  await db
    .insert(workspaceMemberships)
    .values({
      workspaceId: LEGACY_DEFAULT_WORKSPACE_ID,
      actorId: identity.actorId,
      actorName: identity.actorName,
      role: identity.isAdmin ? "owner" : "member",
    })
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.actorId],
      set: { actorName: identity.actorName },
    });

  return requireWorkspaceMembership(identity.actorId, LEGACY_DEFAULT_WORKSPACE_ID);
}

export async function resolveActorWorkspace(
  identity: ActorAccessIdentity,
  preferredWorkspaceId?: string | null,
): Promise<WorkspaceAccess> {
  await ensureLegacyWorkspaceMembership(identity);
  const workspacesForActor = await listActorWorkspaces(identity.actorId);
  const selected =
    (preferredWorkspaceId
      ? selectWorkspaceMembership(
          workspacesForActor,
          identity.actorId,
          preferredWorkspaceId,
        )
      : null) ??
    selectWorkspaceMembership(
      workspacesForActor,
      identity.actorId,
      LEGACY_DEFAULT_WORKSPACE_ID,
    ) ??
    selectWorkspaceMembership(workspacesForActor, identity.actorId);

  if (!selected) {
    throw new AppError("WORKSPACE_ACCESS_DENIED", "当前账号没有可访问的 Workspace。");
  }

  return requireWorkspaceMembership(identity.actorId, selected.workspaceId);
}
