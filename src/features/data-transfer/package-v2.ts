import { createHash } from "node:crypto";

import JSZip, { type JSZipObject } from "jszip";
import { z } from "zod";

import { MAX_EVIDENCE_IMAGE_BYTES } from "@/features/claims/image-validation";
import { AppError } from "@/shared/errors/app-error";

import { type ImportIssue } from "./contracts";
import {
  DATA_TRANSFER_V2_FORMAT_VERSION,
  DATA_TRANSFER_V2_MAX_ATTACHMENTS,
  DATA_TRANSFER_V2_TRUST_POLICY,
  type PortableAttachmentManifestEntryV2,
  type PortablePayloadV2,
  portableAttachmentManifestEntryV2Schema,
  portablePayloadV2Schema,
} from "./contracts-v2";
import {
  createPortableWorkbookV2,
  parsePortableWorkbookV2,
} from "./workbook-v2";

export const PORTABLE_PACKAGE_V2_FORMAT = "knowtrace-portable-package" as const;
export const PORTABLE_PACKAGE_V2_VERSION = "1" as const;
export const PORTABLE_PACKAGE_V2_MANIFEST_PATH = "manifest.json" as const;
export const PORTABLE_PACKAGE_V2_WORKBOOK_PATH = "knowtrace.xlsx" as const;

export const PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
export const PORTABLE_PACKAGE_V2_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
export const PORTABLE_PACKAGE_V2_MAX_WORKBOOK_BYTES = 64 * 1024 * 1024;
export const PORTABLE_PACKAGE_V2_MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
export const PORTABLE_PACKAGE_V2_MAX_ENTRIES = DATA_TRANSFER_V2_MAX_ATTACHMENTS + 32;

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const packageManifestV2Schema = z
  .object({
    packageFormat: z.literal(PORTABLE_PACKAGE_V2_FORMAT),
    packageVersion: z.literal(PORTABLE_PACKAGE_V2_VERSION),
    dataFormatVersion: z.literal(DATA_TRANSFER_V2_FORMAT_VERSION),
    trustPolicy: z.literal(DATA_TRANSFER_V2_TRUST_POLICY),
    workbook: z
      .object({
        path: z.literal(PORTABLE_PACKAGE_V2_WORKBOOK_PATH),
        byteSize: z.number().int().positive().max(PORTABLE_PACKAGE_V2_MAX_WORKBOOK_BYTES),
        sha256: hashSchema,
      })
      .strict(),
    attachments: z
      .array(portableAttachmentManifestEntryV2Schema)
      .max(DATA_TRANSFER_V2_MAX_ATTACHMENTS),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const keys = new Set<string>();
    const paths = new Set<string>();
    manifest.attachments.forEach((attachment, index) => {
      if (keys.has(attachment.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["attachments", index, "key"],
          message: `附件标识重复：${attachment.key}`,
        });
      }
      keys.add(attachment.key);

      const normalizedPath = attachment.relativePath.toLowerCase();
      if (paths.has(normalizedPath)) {
        ctx.addIssue({
          code: "custom",
          path: ["attachments", index, "relativePath"],
          message: `附件相对路径重复：${attachment.relativePath}`,
        });
      }
      paths.add(normalizedPath);
    });
  });

export type PortablePackageManifestV2 = z.infer<typeof packageManifestV2Schema>;

export type ParsedPortablePackageV2 = {
  payload: PortablePayloadV2 | null;
  attachments: Map<string, Buffer>;
  issues: ImportIssue[];
};

type ZipObjectWithMetadata = JSZipObject & {
  unsafeOriginalName?: string;
  _data?: {
    uncompressedSize?: number;
  };
};

function packageIssue(field: string, message: string): ImportIssue {
  return {
    sheet: "交换包",
    row: 0,
    field,
    message,
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizePackagePath(path: string, allowDirectory = false): string | null {
  if (!path || path.includes("\0") || path.includes("\\")) return null;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;

  const candidate = allowDirectory && path.endsWith("/") ? path.slice(0, -1) : path;
  if (!candidate) return null;
  const segments = candidate.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  return candidate;
}

function detectImageMimeType(bytes: Uint8Array): PortableAttachmentManifestEntryV2["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    )
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6) {
    const header = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  return null;
}

function validateAttachmentBytes(
  attachment: PortableAttachmentManifestEntryV2,
  bytes: Uint8Array,
): string[] {
  const errors: string[] = [];
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_EVIDENCE_IMAGE_BYTES) {
    errors.push(`附件大小必须在 1 到 ${MAX_EVIDENCE_IMAGE_BYTES} 字节之间`);
  }
  if (bytes.byteLength !== attachment.byteSize) {
    errors.push(`附件大小不一致：声明 ${attachment.byteSize}，实际 ${bytes.byteLength}`);
  }
  const actualHash = sha256(bytes);
  if (actualHash !== attachment.sha256) {
    errors.push(`附件 SHA-256 不一致：声明 ${attachment.sha256}，实际 ${actualHash}`);
  }
  const actualMime = detectImageMimeType(bytes);
  if (!actualMime) {
    errors.push("附件实际内容不是支持的 JPEG、PNG、WebP 或 GIF 图片");
  } else if (actualMime !== attachment.mimeType) {
    errors.push(`附件 MIME 不一致：声明 ${attachment.mimeType}，实际 ${actualMime}`);
  }
  return errors;
}

function attachmentEntriesEqual(
  left: PortableAttachmentManifestEntryV2,
  right: PortableAttachmentManifestEntryV2,
): boolean {
  return (
    left.key === right.key &&
    left.evidenceKey === right.evidenceKey &&
    left.relativePath === right.relativePath &&
    left.originalName === right.originalName &&
    left.mimeType === right.mimeType &&
    left.byteSize === right.byteSize &&
    left.sha256 === right.sha256
  );
}

function validateLoadedZipEntryPaths(zip: JSZip): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const entry of Object.values(zip.files)) {
    const metadata = entry as ZipObjectWithMetadata;
    const originalName = metadata.unsafeOriginalName ?? entry.name;
    if (!normalizePackagePath(originalName, entry.dir)) {
      issues.push(packageIssue(entry.name || "ZIP entry", `ZIP 条目路径不安全：${originalName}`));
    }
    if (!normalizePackagePath(entry.name, entry.dir)) {
      issues.push(packageIssue(entry.name || "ZIP entry", `ZIP 条目规范化路径不安全：${entry.name}`));
    }
  }
  return issues;
}

function preflightUncompressedSizes(zip: JSZip): ImportIssue[] {
  const issues: ImportIssue[] = [];
  let knownTotal = 0;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const metadata = entry as ZipObjectWithMetadata;
    const size = metadata._data?.uncompressedSize;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) continue;

    knownTotal += size;
    if (entry.name === PORTABLE_PACKAGE_V2_MANIFEST_PATH && size > PORTABLE_PACKAGE_V2_MAX_MANIFEST_BYTES) {
      issues.push(packageIssue(entry.name, "manifest.json 超过允许大小。"));
    }
    if (entry.name === PORTABLE_PACKAGE_V2_WORKBOOK_PATH && size > PORTABLE_PACKAGE_V2_MAX_WORKBOOK_BYTES) {
      issues.push(packageIssue(entry.name, "knowtrace.xlsx 超过允许大小。"));
    }
    if (entry.name.startsWith("attachments/") && size > MAX_EVIDENCE_IMAGE_BYTES) {
      issues.push(packageIssue(entry.name, "单个附件超过 10 MiB 限制。"));
    }
  }

  if (knownTotal > PORTABLE_PACKAGE_V2_MAX_UNCOMPRESSED_BYTES) {
    issues.push(packageIssue("ZIP", "ZIP 解压后已知总大小超过 256 MiB 限制。"));
  }
  return issues;
}

function manifestParseIssues(error: z.ZodError): ImportIssue[] {
  return error.issues.map((issue) =>
    packageIssue(
      issue.path.length > 0 ? `manifest.${issue.path.join(".")}` : "manifest.json",
      issue.message,
    ),
  );
}

export async function createPortablePackageV2(
  input: PortablePayloadV2,
  attachmentBytesByKey: ReadonlyMap<string, Uint8Array>,
): Promise<Buffer> {
  const payload = portablePayloadV2Schema.parse(input);
  const declaredKeys = new Set(payload.attachments.map((attachment) => attachment.key));

  for (const attachment of payload.attachments) {
    const bytes = attachmentBytesByKey.get(attachment.key);
    if (!bytes) {
      throw new AppError(
        "DATA_TRANSFER_V2_ATTACHMENT_MISSING",
        `导出附件缺失：${attachment.key}`,
      );
    }
    const errors = validateAttachmentBytes(attachment, bytes);
    if (errors.length > 0) {
      throw new AppError(
        "DATA_TRANSFER_V2_ATTACHMENT_INVALID",
        `导出附件 ${attachment.key} 校验失败：${errors.join("；")}`,
      );
    }
  }

  for (const key of attachmentBytesByKey.keys()) {
    if (!declaredKeys.has(key)) {
      throw new AppError(
        "DATA_TRANSFER_V2_ATTACHMENT_UNDECLARED",
        `存在未声明的导出附件：${key}`,
      );
    }
  }

  const workbook = await createPortableWorkbookV2(payload);
  if (workbook.byteLength > PORTABLE_PACKAGE_V2_MAX_WORKBOOK_BYTES) {
    throw new AppError("DATA_TRANSFER_V2_WORKBOOK_TOO_LARGE", "v2 Excel 超过 64 MiB 限制。");
  }

  const manifest: PortablePackageManifestV2 = packageManifestV2Schema.parse({
    packageFormat: PORTABLE_PACKAGE_V2_FORMAT,
    packageVersion: PORTABLE_PACKAGE_V2_VERSION,
    dataFormatVersion: DATA_TRANSFER_V2_FORMAT_VERSION,
    trustPolicy: DATA_TRANSFER_V2_TRUST_POLICY,
    workbook: {
      path: PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
      byteSize: workbook.byteLength,
      sha256: sha256(workbook),
    },
    attachments: payload.attachments,
  });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  if (manifestBytes.byteLength > PORTABLE_PACKAGE_V2_MAX_MANIFEST_BYTES) {
    throw new AppError("DATA_TRANSFER_V2_MANIFEST_TOO_LARGE", "v2 manifest 超过 5 MiB 限制。");
  }

  const totalUncompressed =
    manifestBytes.byteLength +
    workbook.byteLength +
    payload.attachments.reduce(
      (sum, attachment) => sum + (attachmentBytesByKey.get(attachment.key)?.byteLength ?? 0),
      0,
    );
  if (totalUncompressed > PORTABLE_PACKAGE_V2_MAX_UNCOMPRESSED_BYTES) {
    throw new AppError("DATA_TRANSFER_V2_PACKAGE_TOO_LARGE", "v2 交换包解压后超过 256 MiB 限制。");
  }

  const zip = new JSZip();
  zip.file(PORTABLE_PACKAGE_V2_MANIFEST_PATH, manifestBytes);
  zip.file(PORTABLE_PACKAGE_V2_WORKBOOK_PATH, workbook);
  for (const attachment of payload.attachments) {
    zip.file(attachment.relativePath, attachmentBytesByKey.get(attachment.key)!);
  }

  const packageBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  if (packageBuffer.byteLength > PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES) {
    throw new AppError("DATA_TRANSFER_V2_PACKAGE_TOO_LARGE", "v2 交换包压缩后超过 256 MiB 限制。");
  }
  return packageBuffer;
}

export async function parsePortablePackageV2(
  input: Buffer | Uint8Array | ArrayBuffer,
): Promise<ParsedPortablePackageV2> {
  const inputBytes = Buffer.isBuffer(input)
    ? input
    : input instanceof ArrayBuffer
      ? Buffer.from(input)
      : Buffer.from(input);
  const issues: ImportIssue[] = [];

  if (inputBytes.byteLength < 1) {
    return {
      payload: null,
      attachments: new Map(),
      issues: [packageIssue("ZIP", "交换包为空。")],
    };
  }
  if (inputBytes.byteLength > PORTABLE_PACKAGE_V2_MAX_COMPRESSED_BYTES) {
    return {
      payload: null,
      attachments: new Map(),
      issues: [packageIssue("ZIP", "交换包压缩后超过 256 MiB 限制。")],
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(inputBytes, { checkCRC32: true });
  } catch {
    return {
      payload: null,
      attachments: new Map(),
      issues: [packageIssue("ZIP", "无法解析 ZIP，或 ZIP 内容校验失败。")],
    };
  }

  const entries = Object.values(zip.files);
  if (entries.length > PORTABLE_PACKAGE_V2_MAX_ENTRIES) {
    issues.push(packageIssue("ZIP", `ZIP 条目数超过 ${PORTABLE_PACKAGE_V2_MAX_ENTRIES} 个限制。`));
  }
  issues.push(...validateLoadedZipEntryPaths(zip));
  issues.push(...preflightUncompressedSizes(zip));
  if (issues.length > 0) {
    return { payload: null, attachments: new Map(), issues };
  }

  const manifestEntry = zip.file(PORTABLE_PACKAGE_V2_MANIFEST_PATH);
  const workbookEntry = zip.file(PORTABLE_PACKAGE_V2_WORKBOOK_PATH);
  if (!manifestEntry) issues.push(packageIssue(PORTABLE_PACKAGE_V2_MANIFEST_PATH, "缺少 manifest.json。"));
  if (!workbookEntry) issues.push(packageIssue(PORTABLE_PACKAGE_V2_WORKBOOK_PATH, "缺少 knowtrace.xlsx。"));
  if (issues.length > 0 || !manifestEntry || !workbookEntry) {
    return { payload: null, attachments: new Map(), issues };
  }

  let actualTotal = 0;
  let manifestBytes: Buffer;
  try {
    manifestBytes = await manifestEntry.async("nodebuffer");
  } catch {
    return {
      payload: null,
      attachments: new Map(),
      issues: [packageIssue(PORTABLE_PACKAGE_V2_MANIFEST_PATH, "无法读取 manifest.json。")],
    };
  }
  actualTotal += manifestBytes.byteLength;
  if (manifestBytes.byteLength > PORTABLE_PACKAGE_V2_MAX_MANIFEST_BYTES) {
    issues.push(packageIssue(PORTABLE_PACKAGE_V2_MANIFEST_PATH, "manifest.json 超过 5 MiB 限制。"));
    return { payload: null, attachments: new Map(), issues };
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return {
      payload: null,
      attachments: new Map(),
      issues: [packageIssue(PORTABLE_PACKAGE_V2_MANIFEST_PATH, "manifest.json 不是有效 JSON。")],
    };
  }

  const manifestResult = packageManifestV2Schema.safeParse(manifestJson);
  if (!manifestResult.success) {
    return {
      payload: null,
      attachments: new Map(),
      issues: manifestParseIssues(manifestResult.error),
    };
  }
  const manifest = manifestResult.data;

  const allowedFiles = new Set<string>([
    PORTABLE_PACKAGE_V2_MANIFEST_PATH,
    PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
    ...manifest.attachments.map((attachment) => attachment.relativePath),
  ]);
  for (const entry of entries) {
    if (entry.dir) continue;
    if (!allowedFiles.has(entry.name)) {
      issues.push(packageIssue(entry.name, "ZIP 中存在 manifest 未声明的额外文件。"));
    }
  }

  let workbookBytes: Buffer;
  try {
    workbookBytes = await workbookEntry.async("nodebuffer");
  } catch {
    issues.push(packageIssue(PORTABLE_PACKAGE_V2_WORKBOOK_PATH, "无法读取 knowtrace.xlsx。"));
    return { payload: null, attachments: new Map(), issues };
  }
  actualTotal += workbookBytes.byteLength;
  if (workbookBytes.byteLength > PORTABLE_PACKAGE_V2_MAX_WORKBOOK_BYTES) {
    issues.push(packageIssue(PORTABLE_PACKAGE_V2_WORKBOOK_PATH, "knowtrace.xlsx 超过 64 MiB 限制。"));
  }
  if (workbookBytes.byteLength !== manifest.workbook.byteSize) {
    issues.push(
      packageIssue(
        PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
        `Excel 大小不一致：manifest 声明 ${manifest.workbook.byteSize}，实际 ${workbookBytes.byteLength}。`,
      ),
    );
  }
  const workbookHash = sha256(workbookBytes);
  if (workbookHash !== manifest.workbook.sha256) {
    issues.push(
      packageIssue(
        PORTABLE_PACKAGE_V2_WORKBOOK_PATH,
        `Excel SHA-256 不一致：manifest 声明 ${manifest.workbook.sha256}，实际 ${workbookHash}。`,
      ),
    );
  }

  const workbookResult = await parsePortableWorkbookV2(workbookBytes);
  issues.push(...workbookResult.issues);
  const payload = workbookResult.payload;
  if (!payload) {
    return { payload: null, attachments: new Map(), issues };
  }

  const workbookAttachmentsByKey = new Map(
    payload.attachments.map((attachment) => [attachment.key, attachment]),
  );
  const manifestAttachmentKeys = new Set<string>();
  for (const attachment of manifest.attachments) {
    manifestAttachmentKeys.add(attachment.key);
    const workbookAttachment = workbookAttachmentsByKey.get(attachment.key);
    if (!workbookAttachment) {
      issues.push(packageIssue(attachment.relativePath, `manifest 附件 ${attachment.key} 未出现在 Excel 图片清单中。`));
      continue;
    }
    if (!attachmentEntriesEqual(attachment, workbookAttachment)) {
      issues.push(packageIssue(attachment.relativePath, `manifest 附件 ${attachment.key} 与 Excel 图片清单不一致。`));
    }
  }
  for (const attachment of payload.attachments) {
    if (!manifestAttachmentKeys.has(attachment.key)) {
      issues.push(packageIssue(attachment.relativePath, `Excel 图片清单附件 ${attachment.key} 未出现在 manifest 中。`));
    }
  }

  const attachmentBytes = new Map<string, Buffer>();
  for (const attachment of manifest.attachments) {
    const entry = zip.file(attachment.relativePath);
    if (!entry) {
      issues.push(packageIssue(attachment.relativePath, `缺少附件文件：${attachment.relativePath}`));
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await entry.async("nodebuffer");
    } catch {
      issues.push(packageIssue(attachment.relativePath, "无法读取附件文件。"));
      continue;
    }
    actualTotal += bytes.byteLength;
    const errors = validateAttachmentBytes(attachment, bytes);
    errors.forEach((message) => issues.push(packageIssue(attachment.relativePath, message)));
    if (errors.length === 0) attachmentBytes.set(attachment.key, bytes);
  }

  if (actualTotal > PORTABLE_PACKAGE_V2_MAX_UNCOMPRESSED_BYTES) {
    issues.push(packageIssue("ZIP", "ZIP 实际解压总大小超过 256 MiB 限制。"));
  }

  if (issues.length > 0) {
    return { payload: null, attachments: new Map(), issues };
  }
  return { payload, attachments: attachmentBytes, issues: [] };
}
