import { z } from "zod";

export const SOURCE_AUTHORITY_LEVELS = [
  "primary",
  "official",
  "expert",
  "secondary",
  "community",
  "unknown",
] as const;

export const assessSourceAuthoritySchema = z.object({
  evidenceId: z.uuid(),
  level: z.enum(SOURCE_AUTHORITY_LEVELS),
  publisher: z.string().trim().min(2, "发布者或来源机构至少需要 2 个字符。").max(300),
  rationale: z.string().trim().min(10, "权威性依据至少需要 10 个字符。").max(1_000),
});

export const independentReviewSchema = z.object({
  claimReviewId: z.uuid(),
  decision: z.enum(["approved", "changes_requested"]),
  rationale: z.string().trim().min(10, "独立复核依据至少需要 10 个字符。").max(2_000),
});

export const publishKnowledgeSchema = z.object({
  claimId: z.uuid(),
});

export type SourceAuthorityLevel = (typeof SOURCE_AUTHORITY_LEVELS)[number];
