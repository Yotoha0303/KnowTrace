import { z } from "zod";

export function normalizeCategoryName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export const createCategorySchema = z.object({
  name: z
    .string()
    .min(1, "请输入分类名称")
    .max(60, "分类名称不能超过 60 个字符")
    .refine((value) => value.trim().length > 0, "请输入分类名称"),
  description: z.string().max(500).nullable().optional(),
});

export const renameCategorySchema = z.object({
  id: z.uuid(),
  name: createCategorySchema.shape.name,
});

export const deleteCategorySchema = z.object({
  id: z.uuid(),
});

export const setCaptureCategoriesSchema = z.object({
  captureId: z.uuid(),
  categoryIds: z.array(z.uuid()).max(20, "每条记录最多选择 20 个分类"),
});
