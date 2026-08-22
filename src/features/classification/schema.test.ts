import { describe, expect, it } from "vitest";

import { normalizeCategoryName } from "./schema";

describe("normalizeCategoryName", () => {
  it("normalizes width, whitespace and casing", () => {
    expect(normalizeCategoryName("  AI　Knowledge   BASE ")).toBe(
      "ai knowledge base",
    );
  });

  it("preserves Chinese category names", () => {
    expect(normalizeCategoryName("  AI 知识管理  ")).toBe("ai 知识管理");
  });
});
