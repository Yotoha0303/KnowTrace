import type { UpdateCaptureInput } from "./schema";

export type PersistedCaptureFields = {
  title: string | null;
  subject: string | null;
  content: string;
  contentType: UpdateCaptureInput["contentType"];
  occurredAt: Date;
};

function normalizedNullableText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export function captureHasPersistedChanges(
  current: PersistedCaptureFields,
  input: UpdateCaptureInput,
): boolean {
  return (
    current.title !== normalizedNullableText(input.title) ||
    current.subject !== normalizedNullableText(input.subject) ||
    current.content !== input.content ||
    current.contentType !== input.contentType ||
    current.occurredAt.getTime() !== new Date(input.occurredAt).getTime()
  );
}
