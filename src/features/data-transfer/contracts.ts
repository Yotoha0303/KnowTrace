import { z } from "zod";

import { CONTENT_TYPES } from "@/features/capture/schema";

export const DATA_TRANSFER_FORMAT_VERSION = "1";
export const DATA_TRANSFER_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const DATA_TRANSFER_MAX_RECORDS = 5_000;
export const DATA_TRANSFER_MAX_CATEGORIES = 500;
export const DATA_TRANSFER_MAX_RELATIONSHIPS = 20_000;

const portableKeySchema = z
  .string()
  .trim()
  .min(1, "标识不能为空")
  .max(100, "标识不能超过 100 个字符");

export const portableCategorySchema = z.object({
  key: portableKeySchema,
  name: z.string().trim().min(1, "分类名称不能为空").max(60, "分类名称不能超过 60 个字符"),
  description: z.string().trim().max(500, "分类说明不能超过 500 个字符").nullable(),
  status: z.enum(["active", "archived"]),
});

export const portableRecordSchema = z.object({
  key: portableKeySchema,
  title: z.string().trim().max(200, "标题不能超过 200 个字符").nullable(),
  content: z.string().min(1, "原文不能为空").max(20_000, "原文不能超过 20,000 个字符"),
  contentType: z.enum(CONTENT_TYPES),
  subject: z.string().trim().max(200, "描述对象不能超过 200 个字符").nullable(),
  occurredAt: z.iso.datetime({ message: "发生时间必须是有效日期时间" }),
  status: z.enum(["active", "archived"]),
  categoryKeys: z.array(portableKeySchema).max(20, "每条记录最多关联 20 个分类"),
});

export const portablePayloadSchema = z.object({
  formatVersion: z.literal(DATA_TRANSFER_FORMAT_VERSION),
  records: z.array(portableRecordSchema).max(DATA_TRANSFER_MAX_RECORDS),
  categories: z.array(portableCategorySchema).max(DATA_TRANSFER_MAX_CATEGORIES),
});

export type PortableCategory = z.infer<typeof portableCategorySchema>;
export type PortableRecord = z.infer<typeof portableRecordSchema>;
export type PortablePayload = z.infer<typeof portablePayloadSchema>;

export type ImportIssue = {
  sheet: string;
  row: number;
  field: string;
  message: string;
};

export type ImportPreviewSummary = {
  valid: boolean;
  recordsTotal: number;
  recordsToCreate: number;
  recordsToSkip: number;
  categoriesTotal: number;
  categoriesToCreate: number;
  categoriesToReuse: number;
  relationshipsTotal: number;
  issues: ImportIssue[];
};

export type ImportResultSummary = {
  recordsCreated: number;
  recordsSkipped: number;
  categoriesCreated: number;
  categoriesReused: number;
  relationshipsCreated: number;
};
