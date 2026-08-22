import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/shared/errors/app-error";

function uploadRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */
    process.env.EVIDENCE_UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads", "evidence"),
  );
}

function resolveStoredPath(storagePath: string): string {
  if (!/^[0-9a-f-]+\.(?:jpg|png|webp|gif)$/.test(storagePath)) {
    throw new AppError("EVIDENCE_IMAGE_PATH_INVALID", "图片存储路径无效。");
  }
  const root = uploadRoot();
  const resolved = path.resolve(root, storagePath);
  if (path.dirname(resolved) !== root) {
    throw new AppError("EVIDENCE_IMAGE_PATH_INVALID", "图片存储路径无效。");
  }
  return resolved;
}

export async function writeEvidenceImage(storagePath: string, bytes: Uint8Array) {
  const root = uploadRoot();
  await mkdir(root, { recursive: true });
  const target = resolveStoredPath(storagePath);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readEvidenceImage(storagePath: string) {
  return readFile(/* turbopackIgnore: true */ resolveStoredPath(storagePath));
}

export async function removeEvidenceImage(storagePath: string) {
  await unlink(resolveStoredPath(storagePath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
