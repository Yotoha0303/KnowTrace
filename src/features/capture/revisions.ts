import { and, eq } from "drizzle-orm";

import type { db } from "@/server/db/client";
import { captureRevisions } from "@/server/db/schema";
import { AppError } from "@/shared/errors/app-error";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type CaptureRevisionSnapshot = {
  id: string;
  version: number;
  title: string | null;
  subject: string | null;
  content: string;
  contentType: typeof captureRevisions.$inferInsert.contentType;
  occurredAt: Date;
};

function sameSnapshot(
  revision: typeof captureRevisions.$inferSelect,
  capture: CaptureRevisionSnapshot,
): boolean {
  return (
    revision.title === capture.title &&
    revision.subject === capture.subject &&
    revision.content === capture.content &&
    revision.contentType === capture.contentType &&
    revision.occurredAt.getTime() === capture.occurredAt.getTime()
  );
}

export async function ensureCaptureRevision(
  transaction: Transaction,
  capture: CaptureRevisionSnapshot,
): Promise<void> {
  const [existing] = await transaction
    .select()
    .from(captureRevisions)
    .where(
      and(
        eq(captureRevisions.captureId, capture.id),
        eq(captureRevisions.version, capture.version),
      ),
    )
    .limit(1);

  if (existing) {
    if (!sameSnapshot(existing, capture)) {
      throw new AppError(
        "CAPTURE_REVISION_CONFLICT",
        "当前记录与同版本历史快照不一致。为避免覆盖版本历史，本次修改已停止。",
      );
    }
    return;
  }

  await transaction.insert(captureRevisions).values({
    captureId: capture.id,
    version: capture.version,
    title: capture.title,
    subject: capture.subject,
    content: capture.content,
    contentType: capture.contentType,
    occurredAt: capture.occurredAt,
  });
}
