import type { PortablePayloadV2 } from "./contracts-v2";
import { sha256, stableStringify } from "@/shared/hash";

export type PortableV2ImportObjectType = "claim" | "evidence" | "attachment";

export type PortableV2ImportObject = {
  objectType: PortableV2ImportObjectType;
  sourceKey: string;
  contentHash: string;
};

export type ExistingPortableV2ImportObject = PortableV2ImportObject & {
  localId: string;
  localExists?: boolean;
};

export type PortableV2ProvenanceConflict = {
  objectType: PortableV2ImportObjectType;
  sourceKey: string;
  existingHash: string;
  incomingHash: string;
};

export type PortableV2ProvenanceAnalysis = {
  objects: PortableV2ImportObject[];
  toCreate: Set<string>;
  toSkip: Set<string>;
  toRepair: Set<string>;
  conflicts: PortableV2ProvenanceConflict[];
};

function provenanceKey(objectType: PortableV2ImportObjectType, sourceKey: string) {
  return `${objectType}\u0000${sourceKey}`;
}

function portableObjectHash(value: unknown): string {
  return sha256(
    stableStringify({
      schema: "knowtrace-import-object-v2",
      value,
    }),
  );
}

export function portableV2ClaimHash(
  claim: PortablePayloadV2["claims"][number],
): string {
  return portableObjectHash({ type: "claim", ...claim });
}

export function portableV2EvidenceHash(
  evidence: PortablePayloadV2["evidence"][number],
): string {
  return portableObjectHash({ type: "evidence", ...evidence });
}

export function portableV2AttachmentHash(
  attachment: PortablePayloadV2["attachments"][number],
): string {
  return portableObjectHash({ type: "attachment", ...attachment });
}

export function listPortableV2ImportObjects(
  payload: PortablePayloadV2,
): PortableV2ImportObject[] {
  return [
    ...payload.claims.map((claim) => ({
      objectType: "claim" as const,
      sourceKey: claim.key,
      contentHash: portableV2ClaimHash(claim),
    })),
    ...payload.evidence.map((evidence) => ({
      objectType: "evidence" as const,
      sourceKey: evidence.key,
      contentHash: portableV2EvidenceHash(evidence),
    })),
    ...payload.attachments.map((attachment) => ({
      objectType: "attachment" as const,
      sourceKey: attachment.key,
      contentHash: portableV2AttachmentHash(attachment),
    })),
  ];
}

export function analyzePortableV2Provenance(
  payload: PortablePayloadV2,
  existing: ExistingPortableV2ImportObject[],
): PortableV2ProvenanceAnalysis {
  const existingByKey = new Map(
    existing.map((item) => [
      provenanceKey(item.objectType, item.sourceKey),
      item,
    ]),
  );
  const objects = listPortableV2ImportObjects(payload);
  const toCreate = new Set<string>();
  const toSkip = new Set<string>();
  const toRepair = new Set<string>();
  const conflicts: PortableV2ProvenanceConflict[] = [];

  for (const object of objects) {
    const key = provenanceKey(object.objectType, object.sourceKey);
    const found = existingByKey.get(key);
    if (!found) {
      toCreate.add(key);
      continue;
    }
    if (found.contentHash === object.contentHash) {
      if (found.localExists === false) toRepair.add(key);
      else toSkip.add(key);
      continue;
    }
    conflicts.push({
      objectType: object.objectType,
      sourceKey: object.sourceKey,
      existingHash: found.contentHash,
      incomingHash: object.contentHash,
    });
  }

  return { objects, toCreate, toSkip, toRepair, conflicts };
}

export function portableV2ProvenanceKey(
  objectType: PortableV2ImportObjectType,
  sourceKey: string,
) {
  return provenanceKey(objectType, sourceKey);
}
