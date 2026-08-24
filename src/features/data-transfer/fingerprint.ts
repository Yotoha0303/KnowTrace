import type { PortablePayload } from "./contracts";
import { sha256, stableStringify } from "@/shared/hash";

function normalizeFingerprintText(value: string | null): string | null {
  return value
    ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") || null
    : null;
}

export function importRecordFingerprint(
  record: Pick<
    PortablePayload["records"][number],
    "title" | "subject" | "content" | "occurredAt" | "contentType"
  >,
): string {
  return sha256(
    stableStringify({
      schemaVersion: "capture-import-fingerprint-v1",
      title: normalizeFingerprintText(record.title),
      subject: normalizeFingerprintText(record.subject),
      content: record.content.normalize("NFKC").replace(/\r\n?/gu, "\n").trim(),
      occurredAt: new Date(record.occurredAt).toISOString(),
      contentType: record.contentType,
    }),
  );
}
