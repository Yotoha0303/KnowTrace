import "server-only";

import { createHash } from "node:crypto";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { normalizeCategoryName } from "@/features/classification/schema";
import { db } from "@/server/db/client";
import {
  captureCategories,
  captureRevisions,
  captures,
  categories,
  dataImportRuns,
} from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";
import { sha256, stableStringify } from "@/shared/hash";

import {
  DATA_TRANSFER_FORMAT_VERSION,
  type ImportIssue,
  type ImportPreviewSummary,
  type ImportResultSummary,
  type PortablePayload,
  portablePayloadSchema,
} from "./contracts";
import { currentTransferActor, type TransferActor } from "./auth";
import { createPortableWorkbook, parsePortableWorkbook } from "./workbook";

type ExistingCapture = typeof captures.$inferSelect;

function importKey(sourceKey: string): string {
  return `xlsx:capture:${sha256(sourceKey).slice(0, 40)}`;
}

function recordHash(record: PortablePayload["records"][number]): string {
  return sha256(stableStringify({
    title: record.title,
    subject: record.subject,
    content: record.content,
    occurredAt: record.occurredAt,
    contentType: record.contentType,
    categoryKeys: [...record.categoryKeys].sort(),
    status: record.status,
  }));
}

function sameCapture(existing: ExistingCapture, record: PortablePayload["records"][number]): boolean {
  return existing.title === record.title &&
    existing.subject === record.subject &&
    existing.content === record.content &&
    existing.occurredAt.toISOString() === record.occurredAt &&
    existing.contentType === record.contentType &&
    existing.status === record.status;
}

async function analyzeImport(payload: PortablePayload, actor: TransferActor): Promise<{
  summary: ImportPreviewSummary;
  skippedKeys: Set<string>;
}> {
  const issues: ImportIssue[] = [];
  const categoryNormalizedNames = payload.categories.map((category) => normalizeCategoryName(category.name));
  const categoryUuids = payload.categories.map((category) => category.key).filter((key) => z.uuid().safeParse(key).success);
  const existingCategories = payload.categories.length
    ? await db.select().from(categories).where(and(
        eq(categories.createdById, actor.id),
        or(
          categoryNormalizedNames.length ? inArray(categories.normalizedName, categoryNormalizedNames) : undefined,
          categoryUuids.length ? inArray(categories.id, categoryUuids) : undefined,
        ),
      ))
    : [];
  const existingCategoryByName = new Map(existingCategories.map((category) => [category.normalizedName, category]));
  const existingCategoryById = new Map(existingCategories.map((category) => [category.id, category]));
  let categoriesToCreate = 0;
  let categoriesToReuse = 0;
  for (const category of payload.categories) {
    const byId = existingCategoryById.get(category.key);
    const byName = existingCategoryByName.get(normalizeCategoryName(category.name));
    if (byId && byId.normalizedName !== normalizeCategoryName(category.name)) {
      issues.push({ sheet: "分类", row: 0, field: category.key, message: "分类标识已存在，但名称不一致" });
    } else if (byId || byName) categoriesToReuse += 1;
    else categoriesToCreate += 1;
  }

  const keys = payload.records.map((record) => importKey(record.key));
  const recordUuids = payload.records.map((record) => record.key).filter((key) => z.uuid().safeParse(key).success);
  const existingCaptures = payload.records.length
    ? await db.select().from(captures).where(and(
        eq(captures.createdById, actor.id),
        or(
          keys.length ? inArray(captures.idempotencyKey, keys) : undefined,
          recordUuids.length ? inArray(captures.id, recordUuids) : undefined,
        ),
      ))
    : [];
  const byImportKey = new Map(existingCaptures.map((capture) => [capture.idempotencyKey, capture]));
  const byId = new Map(existingCaptures.map((capture) => [capture.id, capture]));
  const existingRelationshipRows = recordUuids.length
    ? await db.select({ captureId: captureCategories.captureId, normalizedName: categories.normalizedName })
        .from(captureCategories)
        .innerJoin(categories, eq(captureCategories.categoryId, categories.id))
        .where(inArray(captureCategories.captureId, recordUuids))
    : [];
  const existingCategoryNamesByCapture = new Map<string, string[]>();
  for (const relationship of existingRelationshipRows) {
    const values = existingCategoryNamesByCapture.get(relationship.captureId) ?? [];
    values.push(relationship.normalizedName);
    existingCategoryNamesByCapture.set(relationship.captureId, values);
  }
  const categoryNameByKey = new Map(payload.categories.map((category) => [category.key, normalizeCategoryName(category.name)]));
  const skippedKeys = new Set<string>();
  for (const record of payload.records) {
    const imported = byImportKey.get(importKey(record.key));
    const sameId = byId.get(record.key);
    if (imported) {
      if (imported.idempotencyHash === recordHash(record)) skippedKeys.add(record.key);
      else issues.push({ sheet: "记录", row: 0, field: record.key, message: "该记录标识已导入过，但本次内容不同" });
    } else if (sameId) {
      const expectedCategories = record.categoryKeys.map((key) => categoryNameByKey.get(key) ?? "").sort();
      const actualCategories = [...(existingCategoryNamesByCapture.get(sameId.id) ?? [])].sort();
      if (sameCapture(sameId, record) && stableStringify(expectedCategories) === stableStringify(actualCategories)) skippedKeys.add(record.key);
      else issues.push({ sheet: "记录", row: 0, field: record.key, message: "记录标识与现有记录冲突" });
    }
  }

  const relationshipsTotal = payload.records.reduce((total, record) => total + record.categoryKeys.length, 0);
  return {
    skippedKeys,
    summary: {
      valid: issues.length === 0,
      recordsTotal: payload.records.length,
      recordsToCreate: payload.records.length - skippedKeys.size,
      recordsToSkip: skippedKeys.size,
      categoriesTotal: payload.categories.length,
      categoriesToCreate,
      categoriesToReuse,
      relationshipsTotal,
      issues,
    },
  };
}

export async function exportPortableData(): Promise<Buffer> {
  const actor = await currentTransferActor();
  if (!actor) throw new AppError("AUTH_REQUIRED", "请先登录。");
  const captureFilter = actor.isAdmin ? undefined : eq(captures.createdById, actor.id);
  const categoryFilter = actor.isAdmin ? undefined : eq(categories.createdById, actor.id);
  const [captureRows, categoryRows] = await Promise.all([
    db.select().from(captures).where(captureFilter).orderBy(asc(captures.createdAt), asc(captures.id)),
    db.select().from(categories).where(categoryFilter).orderBy(asc(categories.createdAt), asc(categories.id)),
  ]);
  const captureIds = captureRows.map((capture) => capture.id);
  const relationshipRows = captureIds.length
    ? await db.select().from(captureCategories)
        .where(inArray(captureCategories.captureId, captureIds))
        .orderBy(asc(captureCategories.captureId), asc(captureCategories.categoryId))
    : [];
  const categoryKeysByCapture = new Map<string, string[]>();
  for (const relationship of relationshipRows) {
    const values = categoryKeysByCapture.get(relationship.captureId) ?? [];
    values.push(relationship.categoryId);
    categoryKeysByCapture.set(relationship.captureId, values);
  }
  return createPortableWorkbook({
    formatVersion: DATA_TRANSFER_FORMAT_VERSION,
    records: captureRows.map((capture) => ({
      key: capture.id,
      title: capture.title,
      content: capture.content,
      contentType: capture.contentType,
      subject: capture.subject,
      occurredAt: capture.occurredAt.toISOString(),
      status: capture.status,
      categoryKeys: categoryKeysByCapture.get(capture.id) ?? [],
    })),
    categories: categoryRows.map((category) => ({
      key: category.id,
      name: category.name,
      description: category.description,
      status: category.status,
    })),
  });
}

export async function previewPortableImport(input: {
  actor: TransferActor;
  fileName: string;
  buffer: Buffer;
}) {
  const fileSha256 = createHash("sha256").update(input.buffer).digest("hex");
  let parsed: Awaited<ReturnType<typeof parsePortableWorkbook>>;
  try {
    parsed = await parsePortableWorkbook(input.buffer);
  } catch {
    throw new AppError("INVALID_WORKBOOK", "无法读取该 Excel 文件，请使用 KnowTrace 导出的 .xlsx 文件。");
  }
  const analysis = await analyzeImport(parsed.payload, input.actor);
  const issues = [...parsed.issues, ...analysis.summary.issues].slice(0, 100);
  const summary: ImportPreviewSummary = { ...analysis.summary, valid: issues.length === 0, issues };
  const [run] = await db.insert(dataImportRuns).values({
    actorId: input.actor.id,
    actorName: input.actor.name,
    fileName: input.fileName.slice(0, 255),
    fileSha256,
    formatVersion: DATA_TRANSFER_FORMAT_VERSION,
    status: summary.valid ? "previewed" : "failed",
    stagedPayload: parsed.payload,
    previewSummary: summary,
    errorCode: summary.valid ? null : "IMPORT_VALIDATION_FAILED",
    errorMessage: summary.valid ? null : "导入预检未通过，请修正文件中的问题后重试。",
    completedAt: summary.valid ? null : new Date(),
  }).returning({ id: dataImportRuns.id, status: dataImportRuns.status });
  return { runId: run.id, status: run.status, summary };
}

async function applyImport(payload: PortablePayload, skippedKeys: Set<string>, runId: string, actor: TransferActor): Promise<ImportResultSummary> {
  return db.transaction(async (transaction) => {
    const normalizedNames = payload.categories.map((category) => normalizeCategoryName(category.name));
    const existing = normalizedNames.length
      ? await transaction.select().from(categories).where(
          and(
            eq(categories.createdById, actor.id),
            inArray(categories.normalizedName, normalizedNames),
          ),
        )
      : [];
    const categoryIdByKey = new Map<string, string>();
    const byName = new Map(existing.map((category) => [category.normalizedName, category]));
    let categoriesCreated = 0;
    let categoriesReused = 0;
    for (const category of payload.categories) {
      const found = byName.get(normalizeCategoryName(category.name));
      if (found) {
        categoryIdByKey.set(category.key, found.id);
        categoriesReused += 1;
        continue;
      }
      const [created] = await transaction.insert(categories).values({
        name: category.name,
        normalizedName: normalizeCategoryName(category.name),
        description: category.description,
        status: "active",
        createdById: actor.id,
        createdByName: actor.name,
      }).returning();
      categoryIdByKey.set(category.key, created.id);
      byName.set(created.normalizedName, created);
      categoriesCreated += 1;
    }

    let recordsCreated = 0;
    let relationshipsCreated = 0;
    for (const record of payload.records) {
      if (skippedKeys.has(record.key)) continue;
      const [created] = await transaction.insert(captures).values({
        title: record.title,
        subject: record.subject,
        content: record.content,
        occurredAt: new Date(record.occurredAt),
        contentType: record.contentType,
        status: "active",
        idempotencyKey: importKey(record.key),
        idempotencyHash: recordHash(record),
        createdById: actor.id,
        createdByName: actor.name,
      }).returning();
      await transaction.insert(captureRevisions).values({
        captureId: created.id,
        version: 1,
        title: created.title,
        subject: created.subject,
        content: created.content,
        contentType: created.contentType,
        occurredAt: created.occurredAt,
      });
      const categoryIds = record.categoryKeys.map((key) => categoryIdByKey.get(key)).filter((id): id is string => Boolean(id));
      if (categoryIds.length) {
        await transaction.insert(captureCategories).values(categoryIds.map((categoryId) => ({ captureId: created.id, categoryId, assignedBy: "manual" as const })));
        relationshipsCreated += categoryIds.length;
      }
      if (record.status === "archived") {
        await transaction.update(captures).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() }).where(eq(captures.id, created.id));
      }
      recordsCreated += 1;
    }
    for (const category of payload.categories) {
      if (category.status === "archived" && !byName.has(normalizeCategoryName(category.name))) continue;
      if (category.status === "archived" && !existing.some((item) => item.normalizedName === normalizeCategoryName(category.name))) {
        const categoryId = categoryIdByKey.get(category.key);
        if (categoryId) await transaction.update(categories).set({ status: "archived", updatedAt: new Date() }).where(eq(categories.id, categoryId));
      }
    }
    const result = {
      recordsCreated,
      recordsSkipped: skippedKeys.size,
      categoriesCreated,
      categoriesReused,
      relationshipsCreated,
    };
    await transaction.update(dataImportRuns).set({
      status: "completed",
      resultSummary: result,
      completedAt: new Date(),
    }).where(and(eq(dataImportRuns.id, runId), eq(dataImportRuns.status, "importing")));
    return result;
  });
}

export async function confirmPortableImport(runId: string, actor: TransferActor) {
  const [run] = await db.select().from(dataImportRuns).where(and(eq(dataImportRuns.id, runId), eq(dataImportRuns.actorId, actor.id))).limit(1);
  if (!run) throw new AppError("IMPORT_RUN_NOT_FOUND", "找不到这次导入预检记录。");
  if (run.status !== "previewed") throw new AppError("IMPORT_RUN_NOT_READY", "只有预检通过且尚未导入的文件才能确认导入。");
  const payload = portablePayloadSchema.parse(run.stagedPayload);
  const analysis = await analyzeImport(payload, actor);
  if (!analysis.summary.valid) {
    await db.update(dataImportRuns).set({ status: "failed", errorCode: "IMPORT_STATE_CHANGED", errorMessage: "数据库内容已变化，请重新上传文件预检。", completedAt: new Date() }).where(eq(dataImportRuns.id, run.id));
    throw new AppError("IMPORT_STATE_CHANGED", "数据库内容已变化，请重新上传文件预检。");
  }
  const [claimedRun] = await db.update(dataImportRuns)
    .set({ status: "importing", startedAt: new Date(), errorCode: null, errorMessage: null })
    .where(and(eq(dataImportRuns.id, run.id), eq(dataImportRuns.status, "previewed")))
    .returning({ id: dataImportRuns.id });
  if (!claimedRun) throw new AppError("IMPORT_RUN_NOT_READY", "这次导入已经被处理，请重新上传文件预检。");
  try {
    const result = await applyImport(payload, analysis.skippedKeys, run.id, actor);
    return { runId: run.id, status: "completed" as const, result };
  } catch (error) {
    await db.update(dataImportRuns).set({ status: "failed", errorCode: "IMPORT_TRANSACTION_FAILED", errorMessage: "导入事务失败，未写入部分数据。", completedAt: new Date() }).where(eq(dataImportRuns.id, run.id));
    throw error;
  }
}
