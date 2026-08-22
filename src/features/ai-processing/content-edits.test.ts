import { describe, expect, it } from "vitest";

import { applySelectedContentSuggestions } from "./content-edits";

describe("applySelectedContentSuggestions", () => {
  const suggestions = [
    {
      type: "clarify" as const,
      source_excerpt: "软件/程序",
      suggested_text: "软件与程序",
      reason: "连接关系更明确",
      confidence: 0.9,
    },
    {
      type: "rewrite" as const,
      source_excerpt: "输出结构化内容",
      suggested_text: "将输出整理为结构化内容",
      reason: "补足动作主体",
      confidence: 0.8,
    },
  ];

  it("only applies explicitly selected local suggestions", () => {
    expect(
      applySelectedContentSuggestions(
        "软件/程序；输出结构化内容",
        suggestions,
        [0],
      ),
    ).toBe("软件与程序；输出结构化内容");
  });

  it("applies multiple edits without shifting later positions", () => {
    expect(
      applySelectedContentSuggestions(
        "软件/程序；输出结构化内容",
        suggestions,
        [0, 1],
      ),
    ).toBe("软件与程序；将输出整理为结构化内容");
  });
});
