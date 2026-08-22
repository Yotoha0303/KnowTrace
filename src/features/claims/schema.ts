import { z } from "zod";

export const CLAIM_STATUSES = [
  "candidate",
  "investigating",
  "ready_for_review",
  "concluded",
  "withdrawn",
] as const;

export const CLAIM_ASSESSMENTS = [
  "supported",
  "refuted",
  "inconclusive",
] as const;

export const EVIDENCE_STANCES = [
  "supports",
  "contradicts",
  "context",
] as const;

export const claimStatusSchema = z.enum(CLAIM_STATUSES);

const optionalEvidenceSourceUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .superRefine((value, context) => {
    if (!value) return;

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "请输入有效的来源 URL。",
      });
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "来源仅支持 HTTP(S) URL。",
      });
    }
  });

export const transitionClaimSchema = z.object({
  claimId: z.uuid(),
  expectedStatus: claimStatusSchema,
  targetStatus: claimStatusSchema,
});

export const addClaimEvidenceSchema = z.object({
  claimId: z.uuid(),
  sourceUrl: optionalEvidenceSourceUrlSchema,
  sourceTitle: z.string().trim().min(1, "来源标题不能为空。").max(300),
  excerpt: z.string().trim().min(1, "证据摘录不能为空。").max(2_000),
  stance: z.enum(EVIDENCE_STANCES),
  note: z.string().trim().max(1_000).optional(),
});

export const updateClaimEvidenceSchema = addClaimEvidenceSchema
  .omit({ claimId: true })
  .extend({
    evidenceId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  });

export const uploadEvidenceImageSchema = z.object({
  evidenceId: z.uuid(),
  file: z
    .file("请选择图片文件。")
    .min(1, "图片不能为空。")
    .max(10 * 1024 * 1024, "单张图片不能超过 10 MB。")
    .mime(
      ["image/jpeg", "image/png", "image/webp", "image/gif"],
      "仅支持 JPEG、PNG、WebP 或 GIF 图片。",
    ),
});

export const reviewClaimEvidenceSchema = z.object({
  evidenceId: z.uuid(),
  decision: z.enum(["accepted", "rejected"]),
});

export const checkClaimEvidenceSourceSchema = z.object({
  evidenceId: z.uuid(),
  manualConfirmation: z.boolean().optional(),
});

export const concludeClaimSchema = z.object({
  claimId: z.uuid(),
  assessment: z.enum(CLAIM_ASSESSMENTS),
  rationale: z.string().trim().min(10, "结论依据至少需要 10 个字符。").max(2_000),
  limitations: z.string().trim().max(2_000).optional(),
});

export type ClaimStatus = z.infer<typeof claimStatusSchema>;
