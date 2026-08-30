import { z } from "zod";

import {
  portableCategorySchema,
  portableRecordSchema,
} from "./contracts";

export const DATA_TRANSFER_V2_FORMAT_VERSION = "2" as const;
export const DATA_TRANSFER_V2_TRUST_POLICY = "editable_untrusted_downgrade" as const;

export const DATA_TRANSFER_V2_MAX_CLAIMS = 10_000;
export const DATA_TRANSFER_V2_MAX_EVIDENCE = 20_000;
export const DATA_TRANSFER_V2_MAX_CHECKS = 40_000;
export const DATA_TRANSFER_V2_MAX_REVIEWS = 10_000;
export const DATA_TRANSFER_V2_MAX_ATTACHMENTS = 20_000;
export const DATA_TRANSFER_V2_MAX_RELATIONSHIPS = 40_000;

const portableKeySchema = z
  .string()
  .trim()
  .min(1, "标识不能为空")
  .max(100, "标识不能超过 100 个字符");

const sha256Schema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, "SHA-256 必须是 64 位十六进制字符串");

const nullableUrlSchema = z
  .string()
  .trim()
  .max(2_000, "URL 不能超过 2,000 个字符")
  .nullable();

const nullableShortTextSchema = (max: number, message: string) =>
  z.string().trim().max(max, message).nullable();

export const portableClaimV2Schema = z.object({
  key: portableKeySchema,
  recordKey: portableKeySchema,
  sourceCaptureVersion: z.number().int().positive("来源记录版本必须大于 0"),
  statement: z.string().trim().min(1, "主张陈述不能为空").max(1_000, "主张陈述不能超过 1,000 个字符"),
  sourceExcerpt: z.string().trim().min(1, "来源摘录不能为空").max(1_000, "来源摘录不能超过 1,000 个字符"),
  falsificationCriteria: z.string().trim().min(1, "证伪条件不能为空").max(1_000, "证伪条件不能超过 1,000 个字符"),
  originalStatus: z.enum(["candidate", "investigating", "ready_for_review", "concluded", "withdrawn"]),
});

export const portableEvidenceV2Schema = z.object({
  key: portableKeySchema,
  claimKey: portableKeySchema,
  sourceUrl: z.string().trim().max(2_000, "来源 URL 不能超过 2,000 个字符"),
  sourceTitle: z.string().trim().min(1, "来源标题不能为空").max(300, "来源标题不能超过 300 个字符"),
  excerpt: z.string().trim().min(1, "证据摘录不能为空").max(2_000, "证据摘录不能超过 2,000 个字符"),
  stance: z.enum(["supports", "contradicts", "context"]),
  note: nullableShortTextSchema(1_000, "备注不能超过 1,000 个字符"),
  version: z.number().int().positive("证据版本必须大于 0"),
  originalReviewStatus: z.enum(["unreviewed", "accepted", "rejected"]),
  originalSourceCheckStatus: z.enum(["unchecked", "passed", "failed"]),
  originalSourceExcerptMatch: z.boolean().nullable(),
  latestCheckKey: portableKeySchema.nullable(),
});

export const portableWebSourceCheckV2Schema = z.object({
  key: portableKeySchema,
  evidenceKey: portableKeySchema,
  evidenceVersion: z.number().int().positive("证据版本必须大于 0").nullable(),
  requestedUrl: z.string().trim().min(1, "请求 URL 不能为空").max(2_000, "请求 URL 不能超过 2,000 个字符"),
  finalUrl: nullableUrlSchema,
  status: z.enum(["passed", "failed"]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  contentType: nullableShortTextSchema(120, "内容类型不能超过 120 个字符"),
  contentHash: sha256Schema.nullable(),
  fetchedTitle: nullableShortTextSchema(300, "抓取标题不能超过 300 个字符"),
  excerptMatch: z.boolean().nullable(),
  responseBytes: z.number().int().nonnegative().nullable(),
  errorCode: nullableShortTextSchema(80, "错误码不能超过 80 个字符"),
  checkedAt: z.iso.datetime({ message: "核验时间必须是有效日期时间" }),
});

export const portableAttachmentCheckV2Schema = z.object({
  key: portableKeySchema,
  evidenceKey: portableKeySchema,
  evidenceVersion: z.number().int().positive("证据版本必须大于 0").nullable(),
  contentHash: sha256Schema,
  responseBytes: z.number().int().positive("附件核验字节数必须大于 0"),
  verificationNote: z.string().trim().min(1, "附件核验说明不能为空").max(1_000, "附件核验说明不能超过 1,000 个字符"),
  checkedAt: z.iso.datetime({ message: "核验时间必须是有效日期时间" }),
});

export const portableAttachmentCheckImageV2Schema = z.object({
  checkKey: portableKeySchema,
  attachmentKey: portableKeySchema,
});

export const portableClaimReviewV2Schema = z.object({
  key: portableKeySchema,
  claimKey: portableKeySchema,
  reviewNumber: z.number().int().positive("结论序号必须大于 0"),
  assessment: z.enum(["supported", "refuted", "inconclusive"]),
  rationale: z.string().trim().min(1, "判断依据不能为空").max(2_000, "判断依据不能超过 2,000 个字符"),
  limitations: nullableShortTextSchema(2_000, "局限不能超过 2,000 个字符"),
  reviewerId: z.string().trim().min(1, "审核者标识不能为空").max(100, "审核者标识不能超过 100 个字符"),
  reviewerName: z.string().trim().min(1, "审核者名称不能为空").max(255, "审核者名称不能超过 255 个字符"),
  createdAt: z.iso.datetime({ message: "结论时间必须是有效日期时间" }),
});

export const portableClaimReviewEvidenceV2Schema = z.object({
  reviewKey: portableKeySchema,
  evidenceKey: portableKeySchema,
  checkKey: portableKeySchema,
  stance: z.enum(["supports", "contradicts", "context"]),
  sourceUrl: z.string().trim().max(2_000, "来源 URL 不能超过 2,000 个字符"),
  sourceTitle: z.string().trim().min(1, "来源标题不能为空").max(300, "来源标题不能超过 300 个字符"),
  excerpt: z.string().trim().min(1, "证据摘录不能为空").max(2_000, "证据摘录不能超过 2,000 个字符"),
  finalUrl: z.string().trim().min(1, "最终 URL 不能为空").max(2_000, "最终 URL 不能超过 2,000 个字符"),
  sourceContentHash: sha256Schema,
  sourceCheckedAt: z.iso.datetime({ message: "来源核验时间必须是有效日期时间" }),
});

export const portableAttachmentManifestEntryV2Schema = z.object({
  key: portableKeySchema,
  evidenceKey: portableKeySchema,
  relativePath: z
    .string()
    .trim()
    .min(1, "附件相对路径不能为空")
    .max(255, "附件相对路径不能超过 255 个字符")
    .refine((value) => !value.startsWith("/") && !value.startsWith("\\") && !/^[a-zA-Z]:/.test(value), "附件路径必须是相对路径")
    .refine((value) => !value.split(/[\\/]+/).includes(".."), "附件路径不能包含目录穿越"),
  originalName: z.string().trim().min(1, "原文件名不能为空").max(255, "原文件名不能超过 255 个字符"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024, "单个附件不能超过 10 MB"),
  sha256: sha256Schema,
});

export const portablePayloadV2Schema = z.object({
  formatVersion: z.literal(DATA_TRANSFER_V2_FORMAT_VERSION),
  trustPolicy: z.literal(DATA_TRANSFER_V2_TRUST_POLICY),
  records: z.array(portableRecordSchema),
  categories: z.array(portableCategorySchema),
  claims: z.array(portableClaimV2Schema).max(DATA_TRANSFER_V2_MAX_CLAIMS),
  evidence: z.array(portableEvidenceV2Schema).max(DATA_TRANSFER_V2_MAX_EVIDENCE),
  sourceChecks: z.array(portableWebSourceCheckV2Schema).max(DATA_TRANSFER_V2_MAX_CHECKS),
  attachmentChecks: z.array(portableAttachmentCheckV2Schema).max(DATA_TRANSFER_V2_MAX_CHECKS),
  attachmentCheckImages: z.array(portableAttachmentCheckImageV2Schema).max(DATA_TRANSFER_V2_MAX_RELATIONSHIPS),
  reviews: z.array(portableClaimReviewV2Schema).max(DATA_TRANSFER_V2_MAX_REVIEWS),
  reviewEvidence: z.array(portableClaimReviewEvidenceV2Schema).max(DATA_TRANSFER_V2_MAX_RELATIONSHIPS),
  attachments: z.array(portableAttachmentManifestEntryV2Schema).max(DATA_TRANSFER_V2_MAX_ATTACHMENTS),
});

export type PortablePayloadV2 = z.infer<typeof portablePayloadV2Schema>;
export type PortableClaimV2 = z.infer<typeof portableClaimV2Schema>;
export type PortableEvidenceV2 = z.infer<typeof portableEvidenceV2Schema>;
export type PortableWebSourceCheckV2 = z.infer<typeof portableWebSourceCheckV2Schema>;
export type PortableAttachmentCheckV2 = z.infer<typeof portableAttachmentCheckV2Schema>;
export type PortableAttachmentCheckImageV2 = z.infer<typeof portableAttachmentCheckImageV2Schema>;
export type PortableClaimReviewV2 = z.infer<typeof portableClaimReviewV2Schema>;
export type PortableClaimReviewEvidenceV2 = z.infer<typeof portableClaimReviewEvidenceV2Schema>;
export type PortableAttachmentManifestEntryV2 = z.infer<typeof portableAttachmentManifestEntryV2Schema>;
