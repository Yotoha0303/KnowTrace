import { createHash } from "node:crypto";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { MAX_EVIDENCE_IMAGE_BYTES } from "@/features/claims/image-validation";

import {
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortablePayloadV2,
} from "./contracts-v2";
import {
  PORTABLE_PACKAGE_V2_MANIFEST_PATH,
  PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
  createPortablePackageV2,
  parsePortablePackageV2,
} from "./package-v2";

const pngBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function payloadFor(bytes: Uint8Array = pngBytes): PortablePayloadV2 {
  return {
    formatVersion: "2",
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    records: [
      {
        key: "record-001",
        title: "测试记录",
        content: "用于验证 ZIP 交换包。",
        contentType: "observation",
        subject: "KnowTrace",
        occurredAt: "2026-08-27T08:00:00.000Z",
        status: "active",
        categoryKeys: [],
      },
    ],
    categories: [],
    claims: [
      {
        key: "claim-001",
        recordKey: "record-001",
        sourceCaptureVersion: 1,
        statement: "ZIP 中的图片必须与清单哈希一致。",
        sourceExcerpt: "用于验证 ZIP 交换包。",
        falsificationCriteria: "附件哈希或内容不一致。",
        originalStatus: "investigating",
      },
    ],
    evidence: [
      {
        key: "evidence-001",
        claimKey: "claim-001",
        sourceUrl: "",
        sourceTitle: "测试截图",
        excerpt: "截图内容",
        stance: "supports",
        note: null,
        version: 1,
        originalReviewStatus: "accepted",
        originalSourceCheckStatus: "unchecked",
        originalSourceExcerptMatch: null,
        latestCheckKey: null,
      },
    ],
    sourceChecks: [],
    attachmentChecks: [],
    attachmentCheckImages: [],
    reviews: [],
    reviewEvidence: [],
    attachments: [
      {
        key: "attachment-001",
        evidenceKey: "evidence-001",
        relativePath: "attachments/evidence-001/attachment-001.png",
        originalName: "测试截图.png",
        mimeType: "image/png",
        byteSize: bytes.byteLength,
        sha256: hash(bytes),
      },
    ],
  };
}

async function rewritePackage(
  source: Buffer,
  mutate: (zip: JSZip) => void | Promise<void>,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  await mutate(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("KnowTrace portable package v2", () => {
  it("round-trips workbook metadata and real attachment bytes", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const parsed = await parsePortablePackageV2(source);

    expect(parsed.issues).toEqual([]);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.attachments.get("attachment-001")).toEqual(pngBytes);
  });

  it("rejects an attachment whose bytes were tampered after export", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const tampered = await rewritePackage(source, (zip) => {
      zip.file(payload.attachments[0]!.relativePath, Buffer.concat([pngBytes, Buffer.from([0x01])]));
    });
    const parsed = await parsePortablePackageV2(tampered);

    expect(parsed.payload).toBeNull();
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: payload.attachments[0]!.relativePath,
          message: expect.stringMatching(/大小不一致|SHA-256 不一致/),
        }),
      ]),
    );
  });

  it("rejects a package with a declared attachment missing from the ZIP", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const missing = await rewritePackage(source, (zip) => {
      zip.remove(payload.attachments[0]!.relativePath);
    });
    const parsed = await parsePortablePackageV2(missing);

    expect(parsed.payload).toBeNull();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        field: payload.attachments[0]!.relativePath,
        message: expect.stringContaining("缺少附件文件"),
      }),
    );
  });

  it("rejects undeclared extra files", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const extra = await rewritePackage(source, (zip) => {
      zip.file("attachments/hidden.png", pngBytes);
    });
    const parsed = await parsePortablePackageV2(extra);

    expect(parsed.payload).toBeNull();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        field: "attachments/hidden.png",
        message: expect.stringContaining("未声明的额外文件"),
      }),
    );
  });

  it("rejects unsafe original ZIP paths even when JSZip sanitizes them", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const unsafe = await rewritePackage(source, (zip) => {
      zip.file("../escape.png", pngBytes);
    });
    const parsed = await parsePortablePackageV2(unsafe);

    expect(parsed.payload).toBeNull();
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("路径不安全") }),
      ]),
    );
  });

  it("rejects export when declared MIME does not match image magic bytes", async () => {
    const payload = payloadFor();
    payload.attachments[0] = {
      ...payload.attachments[0]!,
      mimeType: "image/jpeg",
    };

    await expect(
      createPortablePackageV2(payload, new Map([["attachment-001", pngBytes]])),
    ).rejects.toThrow(/MIME 不一致/);
  });

  it("rejects export when an attachment exceeds the 10 MiB limit", async () => {
    const oversized = Buffer.alloc(MAX_EVIDENCE_IMAGE_BYTES + 1);
    pngBytes.copy(oversized, 0);
    const payload = payloadFor();
    payload.attachments[0] = {
      ...payload.attachments[0]!,
      byteSize: MAX_EVIDENCE_IMAGE_BYTES,
      sha256: hash(oversized),
    };

    await expect(
      createPortablePackageV2(payload, new Map([["attachment-001", oversized]])),
    ).rejects.toThrow(/附件大小必须|附件大小不一致/);
  });

  it("rejects a workbook whose bytes no longer match manifest SHA-256", async () => {
    const payload = payloadFor();
    const source = await createPortablePackageV2(
      payload,
      new Map([["attachment-001", pngBytes]]),
    );
    const tampered = await rewritePackage(source, async (zip) => {
      const workbook = await zip.file(PORTABLE_PACKAGE_V2_WORKBOOK_PATH)!.async("nodebuffer");
      zip.file(PORTABLE_PACKAGE_V2_WORKBOOK_PATH, Buffer.concat([workbook, Buffer.from([0x00])]));
    });
    const parsed = await parsePortablePackageV2(tampered);

    expect(parsed.payload).toBeNull();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        field: PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
        message: expect.stringContaining("SHA-256 不一致"),
      }),
    );
  });

  it("creates exactly one top-level manifest and workbook", async () => {
    const source = await createPortablePackageV2(
      payloadFor(),
      new Map([["attachment-001", pngBytes]]),
    );
    const zip = await JSZip.loadAsync(source);

    expect(zip.file(PORTABLE_PACKAGE_V2_MANIFEST_PATH)).not.toBeNull();
    expect(zip.file(PORTABLE_PACKAGE_V2_WORKBOOK_PATH)).not.toBeNull();
  });
});
