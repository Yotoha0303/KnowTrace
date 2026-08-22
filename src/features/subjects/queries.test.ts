import { describe, expect, it } from "vitest";

import { normalizeSubjectPath } from "./utils";

describe("normalizeSubjectPath", () => {
  it("normalizes compatibility characters and surrounding whitespace", () => {
    expect(normalizeSubjectPath("  ＡＩ 公司  ")).toBe("AI 公司");
    expect(normalizeSubjectPath(encodeURIComponent("某公司"))).toBe("某公司");
  });

  it("bounds object paths to the stored field limit", () => {
    expect(normalizeSubjectPath("对".repeat(260))).toHaveLength(200);
  });
});
