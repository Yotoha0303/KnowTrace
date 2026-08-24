import { describe, expect, it } from "vitest";

import { captureHasPersistedChanges } from "./changes";

const current = {
  title: "测试记录",
  subject: "某公司",
  content: "原始内容\n第二行",
  contentType: "observation" as const,
  occurredAt: new Date("2026-08-24T02:00:00.000Z"),
};

const unchangedInput = {
  id: "1d68a734-a079-4420-8207-bb0c0d599c28",
  expectedVersion: 3,
  title: "测试记录",
  subject: "某公司",
  content: "原始内容\n第二行",
  contentType: "observation" as const,
  occurredAt: "2026-08-24T10:00:00+08:00",
};

describe("captureHasPersistedChanges", () => {
  it("does not create a change for equivalent persisted values", () => {
    expect(captureHasPersistedChanges(current, unchangedInput)).toBe(false);
  });

  it("normalizes nullable title and subject whitespace", () => {
    expect(captureHasPersistedChanges(current, {
      ...unchangedInput,
      title: "  测试记录  ",
      subject: " 某公司 ",
    })).toBe(false);
  });

  it("detects a real managed-field change", () => {
    expect(captureHasPersistedChanges(current, {
      ...unchangedInput,
      content: "原始内容\n已修改",
    })).toBe(true);
  });
});
