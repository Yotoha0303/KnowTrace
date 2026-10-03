import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";

import { isAuthEnabled, getGoAuthorization, getGoUser } from "./go-user-system";
import { currentAuthContext } from "./session";
import { ACCESS_TOKEN_HEADER, WORKSPACE_ID_HEADER } from "./client-mode";
import { AppError } from "@/shared/errors/app-error";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  aiSuggestions,
  captureCategories,
  captures,
  categories,
  claimEvidence,
  claims,
  evidenceAttachments,
  topicSyntheses,
} from "@/server/db/schema";
import type { ActorAccessIdentity, DataAccessScope } from "./access-policy";
import { resolveActorWorkspace } from "@/features/workspace/service";
import { CURRENT_WORKSPACE_COOKIE } from "@/shared/workspace";
import {
  captureReadCondition,
  captureWriteCondition,
} from "./resource-scope";

export { canAccessOwner, type DataAccessScope } from "./access-policy";

function scopeFromIdentity(input: {
  id: number;
  username: string;
  nickname: string;
  roleCodes: string[];
}): ActorAccessIdentity {
  return {
    actorId: `go-user:${input.id}`,
    actorName: input.nickname.trim() || input.username,
    isAdmin: input.roleCodes.includes("admin"),
  };
}

async function applyAdminSharingPolicy(
  scope: DataAccessScope,
): Promise<DataAccessScope> {
  if (scope.isAdmin) {
    await db
      .update(captures)
      .set({ visibility: "shared" })
      .where(
        and(
          eq(captures.workspaceId, scope.workspaceId),
          eq(captures.createdById, scope.actorId),
          eq(captures.visibility, "private"),
        ),
      );
  }
  return scope;
}

async function resolveDataAccessScope(
  identity: ActorAccessIdentity,
  workspaceContext?: { preferredWorkspaceId: string | null; trusted: boolean },
): Promise<DataAccessScope> {
  // 客户端显式提交的 Workspace 只是“优先项”，服务端始终回落到该身份真实拥有的成员关系。
  const preferredWorkspaceId =
    workspaceContext?.preferredWorkspaceId ??
    (workspaceContext?.trusted === false
      ? null
      : ((await cookies()).get(CURRENT_WORKSPACE_COOKIE)?.value ?? null));
  const workspace = await resolveActorWorkspace(identity, preferredWorkspaceId);
  return applyAdminSharingPolicy({
    ...identity,
    workspaceId: workspace.workspaceId,
    workspaceName: workspace.workspaceName,
    workspaceSlug: workspace.workspaceSlug,
    workspaceRole: workspace.role,
  });
}

async function resolveNativeDataAccessScope(): Promise<DataAccessScope> {
  // 浏览器客户端由 proxy 注入可信身份头；原生 App 不能注入请求头，改为回带自己的访问令牌，
  // 由服务端重新向认证后端校验，并重新取角色，不信任任何客户端提交的身份或 Workspace。
  const requestHeaders = await headers();
  const accessToken = requestHeaders.get(ACCESS_TOKEN_HEADER);
  if (!accessToken) {
    throw new AppError("AUTH_REQUIRED", "请先登录。");
  }
  const [user, authorization] = await Promise.all([
    getGoUser(accessToken),
    getGoAuthorization(accessToken),
  ]);
  if (!user.ok || !authorization.ok) {
    throw new AppError("AUTH_REQUIRED", "登录会话已失效，请重新登录。");
  }
  return resolveDataAccessScope(
    scopeFromIdentity({
      id: user.data.id,
      username: user.data.username,
      nickname: user.data.nickname,
      roleCodes: authorization.data.role_codes,
    }),
    {
      preferredWorkspaceId: requestHeaders.get(WORKSPACE_ID_HEADER),
      trusted: false,
    },
  );
}

export const currentDataAccessScope = cache(async (): Promise<DataAccessScope> => {
  if (!isAuthEnabled()) {
    return resolveDataAccessScope({
      actorId: "local-owner",
      actorName: "本地使用者",
      isAdmin: true,
    });
  }

  const requestHeaders = await headers();
  const userId = Number(requestHeaders.get("x-knowtrace-workflow-user-id"));
  if (Number.isInteger(userId) && userId > 0) {
    return resolveDataAccessScope(
      scopeFromIdentity({
        id: userId,
        username: decodeURIComponent(requestHeaders.get("x-knowtrace-workflow-username") ?? ""),
        nickname: decodeURIComponent(requestHeaders.get("x-knowtrace-workflow-nickname") ?? ""),
        roleCodes: (requestHeaders.get("x-knowtrace-workflow-role-codes") ?? "")
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean),
      }),
    );
  }

  if (requestHeaders.get(ACCESS_TOKEN_HEADER)) {
    return resolveNativeDataAccessScope();
  }

  // 服务端渲染的页面和 Server Action 从 Cookie 读取会话。
  const context = await currentAuthContext();
  if (!context) {
    throw new AppError("AUTH_REQUIRED", "登录会话已失效，请重新登录。");
  }
  return resolveDataAccessScope(
    scopeFromIdentity({
      id: context.user.id,
      username: context.user.username,
      nickname: context.user.nickname,
      roleCodes: context.authorization.role_codes,
    }),
  );
});

export async function requireCaptureReadAccess(
  captureId: string,
): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: captures.id })
    .from(captures)
    .where(and(eq(captures.id, captureId), captureReadCondition(scope)))
    .limit(1);
  if (!row) throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
  return scope;
}

export async function requireCaptureAccess(captureId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: captures.id })
    .from(captures)
    .where(
      and(
        eq(captures.id, captureId),
        captureWriteCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
  return scope;
}

export async function requireCategoryAccess(categoryId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.workspaceId, scope.workspaceId),
        scope.isAdmin ? undefined : eq(categories.createdById, scope.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在。");
  return scope;
}

export async function requireCategoryReadAccess(
  categoryId: string,
): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const readableCategoryIds = db
    .select({ categoryId: captureCategories.categoryId })
    .from(captureCategories)
    .innerJoin(captures, eq(captureCategories.captureId, captures.id))
    .where(captureReadCondition(scope));
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.workspaceId, scope.workspaceId),
        scope.isAdmin
          ? undefined
          : or(
              eq(categories.createdById, scope.actorId),
              inArray(categories.id, readableCategoryIds),
            ),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("CATEGORY_NOT_FOUND", "分类不存在。");
  return scope;
}

export async function requireClaimAccess(claimId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: claims.id })
    .from(claims)
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(
      and(
        eq(claims.id, claimId),
        captureWriteCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("CLAIM_NOT_FOUND", "主张不存在。");
  return scope;
}

export async function requireEvidenceAccess(evidenceId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: claimEvidence.id })
    .from(claimEvidence)
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(
      and(
        eq(claimEvidence.id, evidenceId),
        captureWriteCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("CLAIM_EVIDENCE_NOT_FOUND", "证据不存在。");
  return scope;
}

export async function requireSuggestionAccess(suggestionId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: aiSuggestions.id })
    .from(aiSuggestions)
    .innerJoin(captures, eq(aiSuggestions.captureId, captures.id))
    .where(
      and(
        eq(aiSuggestions.id, suggestionId),
        captureWriteCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("AI_SUGGESTION_NOT_FOUND", "AI 建议不存在。");
  return scope;
}

export async function requireTopicSynthesisAccess(synthesisId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: topicSyntheses.id })
    .from(topicSyntheses)
    .innerJoin(categories, eq(topicSyntheses.categoryId, categories.id))
    .where(
      and(
        eq(topicSyntheses.id, synthesisId),
        eq(categories.workspaceId, scope.workspaceId),
        scope.isAdmin ? undefined : eq(categories.createdById, scope.actorId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("TOPIC_SYNTHESIS_NOT_FOUND", "主题综合不存在。");
  return scope;
}

export async function requireAttachmentReadAccess(attachmentId: string): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: evidenceAttachments.id })
    .from(evidenceAttachments)
    .innerJoin(claimEvidence, eq(evidenceAttachments.evidenceId, claimEvidence.id))
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(
      and(
        eq(evidenceAttachments.id, attachmentId),
        captureReadCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("EVIDENCE_ATTACHMENT_NOT_FOUND", "图片不存在。");
  return scope;
}

export async function requireAttachmentAccess(
  attachmentId: string,
): Promise<DataAccessScope> {
  const scope = await currentDataAccessScope();
  const [row] = await db
    .select({ id: evidenceAttachments.id })
    .from(evidenceAttachments)
    .innerJoin(claimEvidence, eq(evidenceAttachments.evidenceId, claimEvidence.id))
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(
      and(
        eq(evidenceAttachments.id, attachmentId),
        captureWriteCondition(scope),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("EVIDENCE_ATTACHMENT_NOT_FOUND", "图片不存在。");
  return scope;
}
