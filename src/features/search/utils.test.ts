import { describe, expect, it } from "vitest";

import {
  buildSearchPattern,
  makeSearchSnippet,
  normalizeSearchQuery,
} from "./utils";

describe("search utilities", () => {
  it("normalizes whitespace and bounds user queries", () => {
    expect(normalizeSearchQuery("  AI\n  知识库  ")).toBe("AI 知识库");
    expect(normalizeSearchQuery("x".repeat(120))).toHaveLength(100);
  });

  it("treats SQL wildcard characters as literal input", () => {
    expect(buildSearchPattern("100%_ready\\now")).toBe(
      "%100\\%\\_ready\\\\now%",
    );
  });

  it("keeps the matching Chinese phrase in a bounded snippet", () => {
    const snippet = makeSearchSnippet(
      [`前置内容${"甲".repeat(120)}输入不确定性，输出结构化和系统化的内容${"乙".repeat(120)}`],
      "输入不确定性",
      80,
    );

    expect(snippet).toContain("输入不确定性");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(82);
  });
});
