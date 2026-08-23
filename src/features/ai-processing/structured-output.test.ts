import { describe, expect, it } from "vitest";
import { z } from "zod";

import { parseStructuredAIText } from "./structured-output";

const testSchema = z.object({ ok: z.literal(true) });

describe("parseStructuredAIText", () => {
  it("accepts a plain JSON object", () => {
    expect(parseStructuredAIText('{"ok":true}', testSchema)).toEqual({ ok: true });
  });

  it("accepts a fenced JSON object returned by a compatible provider", () => {
    expect(
      parseStructuredAIText('```json\n{"ok":true}\n```', testSchema),
    ).toEqual({ ok: true });
  });

  it("rejects JSON that does not satisfy the application schema", () => {
    expect(() => parseStructuredAIText('{"ok":false}', testSchema)).toThrow(
      /不符合整理所需的结构/,
    );
  });
});
