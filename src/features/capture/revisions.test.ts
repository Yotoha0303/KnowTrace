import { describe, expect, it, vi } from "vitest";

import { ensureCaptureRevision } from "./revisions";

const capture = {
  id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  title: "标题",
  subject: "主题",
  content: "正文",
  contentType: "thought_fragment" as const,
  occurredAt: new Date("2026-08-23T10:00:00.000Z"),
};

function transactionWith(existing: null | {
  id: string;
  captureId: string;
  version: number;
  title: string | null;
  subject: string | null;
  content: string;
  contentType: typeof capture.contentType;
  occurredAt: Date;
  createdAt: Date;
}) {
  const limit = vi.fn(async () => (existing ? [existing] : []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  const values = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values }));
  return {
    transaction: { select, insert } as unknown as Parameters<
      typeof ensureCaptureRevision
    >[0],
    insert,
    values,
  };
}

describe("ensureCaptureRevision", () => {
  it("reuses an identical imported current-version snapshot", async () => {
    const mock = transactionWith({
      id: "22222222-2222-4222-8222-222222222222",
      captureId: capture.id,
      version: capture.version,
      title: capture.title,
      subject: capture.subject,
      content: capture.content,
      contentType: capture.contentType,
      occurredAt: capture.occurredAt,
      createdAt: new Date("2026-08-23T10:00:01.000Z"),
    });

    await expect(ensureCaptureRevision(mock.transaction, capture)).resolves.toBeUndefined();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("rejects a conflicting snapshot for the same version", async () => {
    const mock = transactionWith({
      id: "22222222-2222-4222-8222-222222222222",
      captureId: capture.id,
      version: capture.version,
      title: capture.title,
      subject: capture.subject,
      content: "另一份正文",
      contentType: capture.contentType,
      occurredAt: capture.occurredAt,
      createdAt: new Date("2026-08-23T10:00:01.000Z"),
    });

    await expect(ensureCaptureRevision(mock.transaction, capture)).rejects.toMatchObject({
      code: "CAPTURE_REVISION_CONFLICT",
    });
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("creates the revision when the current version has no snapshot", async () => {
    const mock = transactionWith(null);

    await expect(ensureCaptureRevision(mock.transaction, capture)).resolves.toBeUndefined();
    expect(mock.values).toHaveBeenCalledWith({
      captureId: capture.id,
      version: capture.version,
      title: capture.title,
      subject: capture.subject,
      content: capture.content,
      contentType: capture.contentType,
      occurredAt: capture.occurredAt,
    });
  });
});
