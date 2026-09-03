import { stableStringify } from "@/shared/hash";

import {
  portablePayloadV2Schema,
  type PortablePayloadV2,
} from "./contracts-v2";

export function portableV2ConfirmationSnapshotMatches(input: {
  stagedPayload: unknown;
  stagedPreview: unknown;
  parsedPayload: PortablePayloadV2;
  currentPreview: unknown;
}): boolean {
  const stagedPayload = portablePayloadV2Schema.safeParse(input.stagedPayload);
  if (!stagedPayload.success) return false;

  return (
    stableStringify(stagedPayload.data) === stableStringify(input.parsedPayload) &&
    stableStringify(input.stagedPreview) === stableStringify(input.currentPreview)
  );
}
