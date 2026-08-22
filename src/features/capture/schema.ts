import { z } from "zod";

export const CONTENT_TYPES = [
  "keyword_set",
  "thought_fragment",
  "experience",
  "observation",
  "question",
  "source_note",
  "mixed",
  "unknown",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  keyword_set: "关键词",
  thought_fragment: "想法片段",
  experience: "经历",
  observation: "观察",
  question: "问题",
  source_note: "资料摘录",
  mixed: "混合内容",
  unknown: "未判断",
};

const titleSchema = z
  .string()
  .max(200, "标题不能超过 200 个字符")
  .nullable()
  .optional();

const contentSchema = z
  .string()
  .min(1)
  .max(20_000, "内容不能超过 20,000 个字符")
  .refine((value) => value.trim().length > 0, "请输入记录内容");

export const createCaptureSchema = z.object({
  title: titleSchema,
  content: contentSchema,
  contentType: z.enum(CONTENT_TYPES).default("unknown"),
  categoryIds: z.array(z.uuid()).max(20).default([]),
  idempotencyKey: z.string().min(8).max(128),
});

export const updateCaptureSchema = z.object({
  id: z.uuid(),
  title: titleSchema,
  content: contentSchema,
  contentType: z.enum(CONTENT_TYPES),
  expectedVersion: z.number().int().positive(),
});

export const captureIdSchema = z.object({
  id: z.uuid(),
});

export type CreateCaptureInput = z.infer<typeof createCaptureSchema>;
export type UpdateCaptureInput = z.infer<typeof updateCaptureSchema>;
