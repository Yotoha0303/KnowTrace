import { z } from "zod";

import { aiConnectionSchema } from "@/features/ai-processing/schema";

export const TOPIC_SYNTHESIS_BOUNDARY_NOTICE =
  "AI 档案只归纳当前项目中已有的记录、主张与人工审核，不会联网补证，也不代表事实已经被证实。";

const sourceIds = z.array(z.uuid()).max(5);

export const topicSynthesisPayloadSchema = z.object({
  overview: z.string().min(1).max(1_200),
  established_points: z
    .array(
      z.object({
        text: z.string().min(1).max(700),
        source_capture_ids: sourceIds,
        claim_ids: sourceIds,
        support_basis: z.enum(["human_review", "candidate_claim", "raw_record"]),
      }),
    )
    .max(6),
  tensions: z
    .array(
      z.object({
        text: z.string().min(1).max(700),
        source_capture_ids: sourceIds,
        claim_ids: sourceIds,
      }),
    )
    .max(5),
  chronology: z
    .array(
      z.object({
        occurred_at: z.iso.datetime(),
        text: z.string().min(1).max(500),
        source_capture_ids: sourceIds.min(1),
      }),
    )
    .max(8),
  open_questions: z.array(z.string().min(1).max(400)).max(5),
  next_steps: z.array(z.string().min(1).max(400)).max(5),
  boundary_notice: z.string().min(1).max(500),
});

export type TopicSynthesisPayload = z.infer<typeof topicSynthesisPayloadSchema>;

export const generateTopicSynthesisSchema = z
  .object({
    categoryId: z.uuid(),
    provider: z.enum(["mock", "openai", "deepseek"]).optional(),
    connection: aiConnectionSchema.optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.connection?.mode === "ccswitch" ||
        input.connection?.mode === "ccswitch_auto" ||
        input.connection?.mode === "ccswitch_codex_oauth") &&
      input.provider !== "openai"
    ) {
      context.addIssue({
        code: "custom",
        message: "CC-Switch 当前仅用于 OpenAI/Codex 连接。",
        path: ["connection"],
      });
    }
    if (
      input.provider === "mock" &&
      input.connection &&
      input.connection.mode !== "server"
    ) {
      context.addIssue({
        code: "custom",
        message: "本地规则不需要 API 凭据。",
        path: ["connection"],
      });
    }
  });

export const decideTopicSynthesisSchema = z.object({
  synthesisId: z.uuid(),
  decision: z.enum(["accepted", "rejected"]),
});
