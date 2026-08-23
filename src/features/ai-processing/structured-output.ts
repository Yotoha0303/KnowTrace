import type { ZodType } from "zod";

import { AppError } from "@/shared/errors/app-error";

function JSONCandidates(raw: string): string[] {
  const trimmed = raw.trim().replace(/^\uFEFF/, "");
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = unfenced.indexOf("{");
  const lastBrace = unfenced.lastIndexOf("}");

  return [
    unfenced,
    firstBrace >= 0 && lastBrace > firstBrace
      ? unfenced.slice(firstBrace, lastBrace + 1)
      : "",
  ].filter((candidate, index, candidates) =>
    Boolean(candidate) && candidates.indexOf(candidate) === index,
  );
}

export function parseStructuredAIText<T>(raw: string, schema: ZodType<T>): T {
  for (const candidate of JSONCandidates(raw)) {
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // Try the next safely bounded JSON candidate.
    }
  }

  throw new AppError(
    "AI_OUTPUT_INVALID",
    "当前模型已响应，但返回内容不符合整理所需的结构。请重试，或在 CC-Switch 中切换其他模型。",
  );
}
