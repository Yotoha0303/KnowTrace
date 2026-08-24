import { and, desc, eq, inArray } from "drizzle-orm";

import {
  captureCategories,
  captureRevisions,
  captures,
  categories,
  claimEvidence,
  claims,
  evidenceAttachments,
} from "@/server/db/schema";
import { db } from "@/server/db/client";
import { AppError } from "@/shared/errors/app-error";
import { sha256, stableStringify } from "@/shared/hash";

import type { CreateCaptureInput, UpdateCaptureInput } from "./schema";
import { removeEvidenceImage } from "@/features/claims/image-storage";
import { ensureCaptureRevision } from "./revisions";
import { captureHasPersistedChanges } from "./changes";
import {
  currentDataAccessScope,
  type DataAccessScope,
} from "@/features/auth/access";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function createRequestHash(input: CreateCaptureInput): string {
  return sha256(
    stableStringify({
      title: input.title ?? null,
      subject: input.subject ?? null,
      content: input.content,
      occurredAt: input.occurredAt,
      contentType: input.contentType,
      categoryIds: [...input.categoryIds].sort(),
    }),
  );
}

async function validateActiveCategories(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  categoryIds: string[],
  scope: DataAccessScope,
) {
  if (categoryIds.length === 0) return;

  const uniqueIds = [...new Set(categoryIds)];
  const rows = await transaction
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        inArray(categories.id, uniqueIds),
        eq(categories.status, "active"),
        scope.isAdmin ? undefined : eq(categories.createdById, scope.actorId),
      ),
    );

  if (rows.length !== uniqueIds.length) {
    throw new AppError(
      "CATEGORY_NOT_FOUND",
      "部分分类不存在或已经归档。",
    );
  }
}

export async function createCapture(input: CreateCaptureInput) {
  const scope = await currentDataAccessScope();
  const requestHash = createRequestHash(input);
  const [existing] = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.createdById, scope.actorId),
        eq(captures.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.idempotencyHash !== requestHash) {
      throw new AppError(
        "CAPTURE_IDEMPOTENCY_CONFLICT",
        "这个请求标识已经用于另一条内容，请重新提交。",
      );
    }
    return existing;
  }

  try {
    return await db.transaction(async (transaction) => {
      await validateActiveCategories(transaction, input.categoryIds, scope);
      const [created] = await transaction
        .insert(captures)
        .values({
          title: input.title?.trim() || null,
          subject: input.subject?.trim() || null,
          content: input.content,
          occurredAt: new Date(input.occurredAt),
          contentType: input.contentType,
          idempotencyKey: input.idempotencyKey,
          idempotencyHash: requestHash,
          visibility: scope.isAdmin ? "shared" : "private",
          createdById: scope.actorId,
          createdByName: scope.actorName,
        })
        .returning();

      if (input.categoryIds.length > 0) {
        await transaction.insert(captureCategories).values(
          [...new Set(input.categoryIds)].map((categoryId) => ({
            captureId: created.id,
            categoryId,
            assignedBy: "manual" as const,
          })),
        );
      }

      return created;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const [concurrent] = await db
      .select()
      .from(captures)
      .where(
        and(
          eq(captures.createdById, scope.actorId),
          eq(captures.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (concurrent?.idempotencyHash === requestHash) return concurrent;
    throw new AppError(
      "CAPTURE_IDEMPOTENCY_CONFLICT",
      "这个请求标识已经用于另一条内容，请重新提交。",
    );
  }
}

export async function updateCapture(input: UpdateCaptureInput) {
  const scope = await currentDataAccessScope();
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(captures)
      .where(
        and(
          eq(captures.id, input.id),
          scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
        ),
      )
      .for("update")
      .limit(1);

    if (!current) {
      throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
    }

    if (current.version !== input.expectedVersion) {
      throw new AppError(
        "CAPTURE_VERSION_CONFLICT",
        "记录已经更新，请刷新后重试。",
        { currentVersion: current.version },
      );
    }


    if (!captureHasPersistedChanges(current, input)) {
      return { ...current, changed: false };
    }

    await ensureCaptureRevision(transaction, current);

    const [updated] = await transaction
      .update(captures)
      .set({
        title: input.title?.trim() || null,
        subject: input.subject?.trim() || null,
        content: input.content,
        contentType: input.contentType,
        occurredAt: new Date(input.occurredAt),
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(captures.id, current.id),
          eq(captures.version, current.version),
        ),
      )
      .returning();

    if (!updated) {
      throw new AppError(
        "CAPTURE_VERSION_CONFLICT",
        "记录已经更新，请刷新后重试。",
      );
    }

    return { ...updated, changed: true };
  });
}

export async function setCaptureStatus(
  id: string,
  status: "active" | "archived",
) {
  const scope = await currentDataAccessScope();
  const [updated] = await db
    .update(captures)
    .set({
      status,
      archivedAt: status === "archived" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(captures.id, id),
        scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
      ),
    )
    .returning();

  if (!updated) {
    throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
  }
  return updated;
}

export async function deleteCapture(id: string, expectedVersion?: number) {
  const scope = await currentDataAccessScope();
  const ownerCondition = scope.isAdmin
    ? undefined
    : eq(captures.createdById, scope.actorId);
  const attachmentRows = await db
    .select({ storagePath: evidenceAttachments.storagePath })
    .from(evidenceAttachments)
    .innerJoin(claimEvidence, eq(evidenceAttachments.evidenceId, claimEvidence.id))
    .innerJoin(claims, eq(claimEvidence.claimId, claims.id))
    .innerJoin(captures, eq(claims.captureId, captures.id))
    .where(and(eq(claims.captureId, id), ownerCondition));
  const [deleted] = await db
    .delete(captures)
    .where(
      expectedVersion === undefined
        ? and(eq(captures.id, id), ownerCondition)
        : and(
            eq(captures.id, id),
            eq(captures.version, expectedVersion),
            ownerCondition,
          ),
    )
    .returning({ id: captures.id });
  if (!deleted) {
    if (expectedVersion !== undefined) {
      const [current] = await db
        .select({ version: captures.version })
        .from(captures)
        .where(and(eq(captures.id, id), ownerCondition))
        .limit(1);
      if (current) {
        throw new AppError(
          "CAPTURE_VERSION_CONFLICT",
          "记录已经更新，请刷新后重试。",
          { currentVersion: current.version },
        );
      }
    }
    throw new AppError("CAPTURE_NOT_FOUND", "记录不存在或已经被删除。");
  }
  await Promise.allSettled(
    attachmentRows.map((attachment) => removeEvidenceImage(attachment.storagePath)),
  );
  return deleted;
}

export async function setCaptureCategories(
  captureId: string,
  categoryIds: string[],
) {
  const scope = await currentDataAccessScope();
  return db.transaction(async (transaction) => {
    const [capture] = await transaction
      .select({ id: captures.id })
      .from(captures)
      .where(
        and(
          eq(captures.id, captureId),
          scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
        ),
      )
      .for("update")
      .limit(1);

    if (!capture) {
      throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
    }

    const uniqueIds = [...new Set(categoryIds)];
    await validateActiveCategories(transaction, uniqueIds, scope);
    const existingRows = await transaction
      .select({
        categoryId: captureCategories.categoryId,
        createdById: categories.createdById,
      })
      .from(captureCategories)
      .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
      .where(eq(captureCategories.captureId, captureId));
    const preservedIds = scope.isAdmin
      ? []
      : existingRows
          .filter(({ createdById }) => createdById !== scope.actorId)
          .map(({ categoryId }) => categoryId);
    const effectiveIds = [...new Set([...uniqueIds, ...preservedIds])];
    const existingKey = existingRows
      .map(({ categoryId }) => categoryId)
      .sort()
      .join("|");
    const requestedKey = [...effectiveIds].sort().join("|");
    if (existingKey === requestedKey) return { changed: false };

    await transaction
      .delete(captureCategories)
      .where(eq(captureCategories.captureId, captureId));

    if (effectiveIds.length > 0) {
      await transaction.insert(captureCategories).values(
        effectiveIds.map((categoryId) => ({
          captureId,
          categoryId,
          assignedBy: "manual" as const,
        })),
      );
    }

    await transaction
      .update(captures)
      .set({ updatedAt: new Date() })
      .where(eq(captures.id, captureId));
    return { changed: true };
  });
}

export async function getCaptureRow(id: string) {
  const scope = await currentDataAccessScope();
  const [capture] = await db
    .select()
    .from(captures)
    .where(
      and(
        eq(captures.id, id),
        scope.isAdmin ? undefined : eq(captures.createdById, scope.actorId),
      ),
    )
    .limit(1);
  if (!capture) {
    throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");
  }
  return capture;
}

export async function getActiveCategoryRows() {
  const scope = await currentDataAccessScope();
  return db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.status, "active"),
        scope.isAdmin ? undefined : eq(categories.createdById, scope.actorId),
      ),
    )
    .orderBy(categories.name);
}

export async function getCaptureCategoryIds(captureId: string) {
  await getCaptureRow(captureId);
  const rows = await db
    .select({ categoryId: captureCategories.categoryId })
    .from(captureCategories)
    .where(eq(captureCategories.captureId, captureId));
  return rows.map((row) => row.categoryId);
}

export async function getRecentRevisionRows(captureId: string) {
  await getCaptureRow(captureId);
  return db
    .select()
    .from(captureRevisions)
    .where(eq(captureRevisions.captureId, captureId))
    .orderBy(desc(captureRevisions.version))
    .limit(20);
}
