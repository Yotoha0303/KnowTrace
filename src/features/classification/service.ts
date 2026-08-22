import { and, count, eq, inArray } from "drizzle-orm";

import { categories, captureCategories, captures } from "@/server/db/schema";
import { db } from "@/server/db/client";
import { AppError } from "@/shared/errors/app-error";

import { normalizeCategoryName } from "./schema";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export async function createCategory(input: {
  name: string;
  description?: string | null;
}) {
  const name = input.name.normalize("NFKC").trim().replace(/\s+/g, " ");
  try {
    const [created] = await db
      .insert(categories)
      .values({
        name,
        normalizedName: normalizeCategoryName(name),
        description: input.description?.trim() || null,
      })
      .returning();
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CATEGORY_NAME_CONFLICT", "这个分类已经存在。");
    }
    throw error;
  }
}

export async function renameCategory(id: string, newName: string) {
  const name = newName.normalize("NFKC").trim().replace(/\s+/g, " ");
  try {
    const [updated] = await db
      .update(categories)
      .set({
        name,
        normalizedName: normalizeCategoryName(name),
        updatedAt: new Date(),
      })
      .where(eq(categories.id, id))
      .returning();
    if (!updated) {
      throw new AppError("CATEGORY_NOT_FOUND", "分类不存在。");
    }
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CATEGORY_NAME_CONFLICT", "这个分类已经存在。");
    }
    throw error;
  }
}

export async function setCategoryStatus(
  id: string,
  status: "active" | "archived",
) {
  const [updated] = await db
    .update(categories)
    .set({ status, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning();
  if (!updated) {
    throw new AppError("CATEGORY_NOT_FOUND", "分类不存在。");
  }
  return updated;
}

export async function deleteCategory(id: string) {
  return db.transaction(async (transaction) => {
    const [category] = await transaction
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1)
      .for("update");
    if (!category) {
      throw new AppError("CATEGORY_NOT_FOUND", "分类不存在或已经被删除。");
    }

    const [usage] = await transaction
      .select({ count: count() })
      .from(captureCategories)
      .where(eq(captureCategories.categoryId, category.id));
    if (Number(usage?.count ?? 0) > 0) {
      throw new AppError(
        "CATEGORY_IN_USE",
        "这个分类仍有关联记录，请先移除所有记录上的分类关联。",
      );
    }

    const [deleted] = await transaction
      .delete(categories)
      .where(eq(categories.id, category.id))
      .returning({ id: categories.id, name: categories.name });
    if (!deleted) {
      throw new AppError("CATEGORY_NOT_FOUND", "分类不存在或已经被删除。");
    }
    return deleted;
  });
}

export async function addCategoriesToCapture(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  captureId: string,
  categoryIds: string[],
  assignedBy: "manual" | "ai_accepted",
) {
  const uniqueIds = [...new Set(categoryIds)];
  if (uniqueIds.length === 0) return;

  const [capture] = await transaction
    .select({ id: captures.id })
    .from(captures)
    .where(eq(captures.id, captureId))
    .limit(1);
  if (!capture) throw new AppError("CAPTURE_NOT_FOUND", "记录不存在。");

  const active = await transaction
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(inArray(categories.id, uniqueIds), eq(categories.status, "active")),
    );
  if (active.length !== uniqueIds.length) {
    throw new AppError("CATEGORY_NOT_FOUND", "部分分类不存在或已经归档。");
  }

  await transaction
    .insert(captureCategories)
    .values(
      uniqueIds.map((categoryId) => ({
        captureId,
        categoryId,
        assignedBy,
      })),
    )
    .onConflictDoNothing();
}
