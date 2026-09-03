import { describe, expect, it } from "vitest";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import { portableV2ConfirmationSnapshotMatches } from "./confirmation-v2";

function payload(): PortablePayloadV2 {
  return {
    formatVersion: "2",
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    records: [
      {
        key: "record-1",
        title: null,
        content: "原文",
        contentType: "observation",
        subject: null,
        occurredAt: "2026-08-27T00:00:00.000Z",
        status: "active",
        categoryKeys: [],
      },
    ],
    categories: [],
    claims: [],
    evidence: [],
    sourceChecks: [],
    attachmentChecks: [],
    attachmentCheckImages: [],
    reviews: [],
    reviewEvidence: [],
    attachments: [],
  };
}

describe("v2 confirmation snapshot", () => {
  it("accepts the same parsed payload and preview regardless of JSON key order", () => {
    const source = payload();
    expect(
      portableV2ConfirmationSnapshotMatches({
        stagedPayload: source,
        stagedPreview: { valid: true, base: { recordsToCreate: 1 } },
        parsedPayload: source,
        currentPreview: { base: { recordsToCreate: 1 }, valid: true },
      }),
    ).toBe(true);
  });

  it("rejects a payload that differs from the staged preview payload", () => {
    const source = payload();
    const changed = payload();
    changed.records[0]!.content = "被修改的原文";

    expect(
      portableV2ConfirmationSnapshotMatches({
        stagedPayload: source,
        stagedPreview: { valid: true },
        parsedPayload: changed,
        currentPreview: { valid: true },
      }),
    ).toBe(false);
  });

  it("rejects when database reanalysis changes the preview plan", () => {
    const source = payload();
    expect(
      portableV2ConfirmationSnapshotMatches({
        stagedPayload: source,
        stagedPreview: { valid: true, knowledge: { claims: { toCreate: 1 } } },
        parsedPayload: source,
        currentPreview: { valid: true, knowledge: { claims: { toCreate: 0, toSkip: 1 } } },
      }),
    ).toBe(false);
  });

  it("rejects an invalid staged payload", () => {
    expect(
      portableV2ConfirmationSnapshotMatches({
        stagedPayload: { formatVersion: "2" },
        stagedPreview: { valid: true },
        parsedPayload: payload(),
        currentPreview: { valid: true },
      }),
    ).toBe(false);
  });
});
