import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { isAuthEnabled } from "./go-user-system";
import { currentAuthContext } from "./session";
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
import type { DataAccessScope } from "./access-policy";
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
}): DataAccessScope {
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
          eq(captures.createdById, scope.actorId),
          eq(captures.visibility, "private"),
        ),
      );
  }
  return scope;
}

export const currentDataAccessScope = cache(async (): Promise<DataAccessScope> => {
  if (!isAuthEnabled()) {
    return applyAdminSharingPolicy({
      actorId: "local-owner",
      actorName: "本地使用者",
      isAdmin: true,
    });
  }

  const requestHeaders = await headers();
  const userId = Number(requestHeaders.get("x-knowtrace-user-id"));
  if (Number.isInteger(userId) && userId > 0) {
    return applyAdminSharingPolicy(scopeFromIdentity({
      id: userId,
      username: decodeURIComponent(requestHeaders.get("x-knowtrace-username") ?? ""),
      nickname: decodeURIComponent(requestHeaders.get("x-knowtrace-nickname") ?? ""),
      roleCodes: (requestHeaders.get("x-knowtrace-role-codes") ?? "")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean),
    }));
  }

  const context = await currentAuthContext();
  if (!context) {
    throw new AppError("AUTH_REQUIRED", "登录会话已失效，请重新登录。");
  }
  return applyAdminSharingPolicy(scopeFromIdentity({
    id: context.user.id,
    username: context.user.username,
    nickname: context.user.nickname,
    roleCodes: context.authorization.role_codes,
  }));
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
