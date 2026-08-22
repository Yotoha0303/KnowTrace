import { describe, expect, it } from "vitest";

import { deleteCategorySchema, normalizeCategoryName } from "./schema";

describe("normalizeCategoryName", () => {
  it("normalizes width, whitespace and casing", () => {
    expect(normalizeCategoryName("  AI　Knowledge   BASE ")).toBe(
      "ai knowledge base",
    );
  });

  it("preserves Chinese category names", () => {
    expect(normalizeCategoryName("  AI 知识管理  ")).toBe("ai 知识管理");
  });

  it("requires a UUID when deleting a category", () => {
    expect(
      deleteCategorySchema.safeParse({
        id: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
      }).success,
    ).toBe(true);
    expect(deleteCategorySchema.safeParse({ id: "not-an-id" }).success).toBe(
      false,
    );
  });
});
