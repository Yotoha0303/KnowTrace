import { describe, expect, it } from "vitest";

import { sha256, stableStringify } from "./hash";

describe("stableStringify", () => {
  it("sorts object keys recursively", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it("produces stable hashes", () => {
    expect(sha256(stableStringify({ b: 2, a: 1 }))).toBe(
      sha256(stableStringify({ a: 1, b: 2 })),
    );
  });
});
