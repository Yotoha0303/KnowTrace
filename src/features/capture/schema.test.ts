import { describe, expect, it } from "vitest";

import { createCaptureSchema, updateCaptureSchema } from "./schema";

const validCreate = {
  title: null,
  subject: "示例公司",
  content: "记录一段与描述对象有关的内容",
  occurredAt: "2026-08-22T07:30:00.000Z",
  contentType: "observation" as const,
  categoryIds: [],
  idempotencyKey: "fixture-key-001",
};

describe("capture metadata schemas", () => {
  it("accepts an ISO occurrence time and a free-text subject", () => {
    expect(createCaptureSchema.safeParse(validCreate).success).toBe(true);
    expect(
      updateCaptureSchema.safeParse({
        ...validCreate,
        id: "d92f5b20-52d0-4b3e-b9ad-3b1fd759bd6a",
        expectedVersion: 1,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid occurrence times and oversized subjects", () => {
    expect(
      createCaptureSchema.safeParse({ ...validCreate, occurredAt: "2026-08-22 15:30" }).success,
    ).toBe(false);
    expect(
      createCaptureSchema.safeParse({ ...validCreate, subject: "人".repeat(201) }).success,
    ).toBe(false);
  });
});
