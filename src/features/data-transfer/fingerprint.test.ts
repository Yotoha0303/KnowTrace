import { describe, expect, it } from "vitest";

import { importRecordFingerprint } from "./fingerprint";

const record = {
  title: "某个事件",
  subject: "某公司",
  content: "第一行\r\n第二行",
  occurredAt: "2026-08-24T02:00:00.000Z",
  contentType: "observation" as const,
};

describe("importRecordFingerprint", () => {
  it("is stable across harmless text and date representations", () => {
    expect(importRecordFingerprint(record)).toBe(importRecordFingerprint({
      ...record,
      title: "  某个事件 ",
      subject: "某公司 ",
      content: "第一行\n第二行",
      occurredAt: "2026-08-24T10:00:00+08:00",
    }));
  });

  it("keeps different subjects and event times distinct", () => {
    expect(importRecordFingerprint(record)).not.toBe(importRecordFingerprint({
      ...record,
      subject: "另一家公司",
    }));
    expect(importRecordFingerprint(record)).not.toBe(importRecordFingerprint({
      ...record,
      occurredAt: "2026-08-25T02:00:00.000Z",
    }));
  });
});
